/**
 * Git protocol cloud adapter — implements the Adapter interface using
 * isomorphic-git (pure TypeScript) with LightningFS (IndexedDB backend).
 *
 * Each `root` parameter corresponds to a git repository URL.
 * All operations work against a local clone managed by LightningFS.
 *
 * Responsibilities are split across the module:
 * - {@link GitRepoManager} owns the clone lifecycle (init/fetch/checkout).
 * - `git-ops` holds the low-level isomorphic-git remote primitives.
 * - This class implements the `Adapter` CRUD contract + write-path orchestration.
 */

import type {
	Adapter,
	AdapterConfig,
	ConnectionTestResult,
	FileEntry,
	GitAdapterConfig,
	WatchEvent,
	WorkspacePickResult,
} from '../../adapter.interface';
import type { RepoEntry } from './types';
import { GitRepoManager } from './repo-manager';
import { createWatchPoller } from './watch-poller';
import { GitTokenStore } from './auth';
import {
	resolvePath,
	relativePath,
	errMsg,
	assertRoot,
	groupNonRecursiveEntries,
} from './helpers';
import {
	fetchRemote,
	checkoutRemoteBranch,
	fastForwardFromRemote,
	pushBranch,
} from './git-ops';
import { debugLog } from '@core/utils/debug-logger';
import git from 'isomorphic-git';

// ── Adapter ────────────────────────────────────────────────────────────────

export class GitAdapter implements Adapter {
	readonly id = 'git';
	readonly isLocal = false;

	private readonly tokenStore = new GitTokenStore();
	private readonly repoManager = new GitRepoManager(this.tokenStore);

	isAvailable(): boolean {
		return true;
	}

	pickWorkspaceFolder(): Promise<WorkspacePickResult | null> {
		return Promise.resolve(null);
	}

	async read(path: string, root?: string): Promise<string> {
		const repo = await this.repoManager.ensureRepo(assertRoot(root));
		try {
			const oid = await git.resolveRef({
				fs: repo.fs,
				dir: repo.cloneDir,
				ref: 'HEAD',
			});
			const { blob } = await git.readBlob({
				fs: repo.fs,
				dir: repo.cloneDir,
				oid,
				filepath: relativePath(path),
			});
			return new TextDecoder().decode(blob);
		} catch (err: unknown) {
			throw new Error(
				`GitAdapter: failed to read "${path}": ${errMsg(err, 'unknown error')}`,
				{ cause: err },
			);
		}
	}

	async write(path: string, content: string, root?: string): Promise<void> {
		const repo = await this.repoManager.ensureRepo(assertRoot(root));
		const fullPath = resolvePath(repo.cloneDir, path);

		try {
			const parentDir = fullPath.split('/').slice(0, -1).join('/');
			await repo.fs.promises
				.mkdir(parentDir, { recursive: true })
				.catch((_e: unknown) => {
					/* parent may already exist */
				});

			await repo.fs.promises.writeFile(fullPath, content);

			await this.commitAndPush(
				repo,
				relativePath(path),
				`Update ${path}`,
				root,
			);
		} catch (err: unknown) {
			throw new Error(
				`GitAdapter: failed to write "${path}": ${errMsg(err, 'unknown error')}`,
				{ cause: err },
			);
		}
	}

	async delete(path: string, root?: string): Promise<void> {
		const repo = await this.repoManager.ensureRepo(assertRoot(root));

		debugLog(`[GitAdapter] delete("${path}") — committing remove + push`);

		try {
			const fullPath = resolvePath(repo.cloneDir, path);
			const exists = await repo.fs.promises
				.stat(fullPath)
				.then(() => true)
				.catch(() => false);
			if (!exists) {
				throw new Error(`no such file: "${path}"`);
			}

			await this.commitAndPush(
				repo,
				relativePath(path),
				`Delete ${path}`,
				root,
				'remove',
			);
		} catch (err: unknown) {
			throw new Error(
				`GitAdapter: failed to delete "${path}": ${errMsg(err, 'unknown error')}`,
				{ cause: err },
			);
		}
	}

	async rename(
		oldPath: string,
		newPath: string,
		root?: string,
	): Promise<void> {
		const repo = await this.repoManager.ensureRepo(assertRoot(root));

		try {
			const content = await this.read(oldPath, root);

			const newFullPath = resolvePath(repo.cloneDir, newPath);
			const parentDir = newFullPath.split('/').slice(0, -1).join('/');
			await repo.fs.promises
				.mkdir(parentDir, { recursive: true })
				.catch((_e: unknown) => {
					/* parent may already exist */
				});
			await repo.fs.promises.writeFile(newFullPath, content);

			await git.add({
				fs: repo.fs,
				dir: repo.cloneDir,
				filepath: relativePath(newPath),
			});
			await git.remove({
				fs: repo.fs,
				dir: repo.cloneDir,
				filepath: relativePath(oldPath),
			});
			await this.commitAndPush(
				repo,
				relativePath(newPath),
				`Rename ${oldPath} → ${newPath}`,
				root,
			);
		} catch (err: unknown) {
			throw new Error(
				`GitAdapter: failed to rename "${oldPath}" → "${newPath}": ${errMsg(err, 'unknown error')}`,
				{ cause: err },
			);
		}
	}

	async list(
		path: string,
		root?: string,
		recursive?: boolean,
	): Promise<FileEntry[]> {
		const repo = await this.repoManager.ensureRepo(assertRoot(root));

		try {
			let files: string[];
			try {
				files = await git.listFiles({
					fs: repo.fs,
					dir: repo.cloneDir,
					ref: 'HEAD',
				});
			} catch {
				files = [];
			}

			const prefix = relativePath(path);
			const filtered = prefix
				? files.filter(
						(f) => f.startsWith(prefix + '/') || f === prefix,
					)
				: files;
			debugLog(
				`[GitAdapter] list("${path}"): ${recursive ? 'recursive' : 'non-rec'} — ${String(filtered.length)} results (${String(files.length)} in HEAD)`,
			);

			if (recursive) {
				return filtered.map((f) => ({
					name: f,
					path: f,
					isDirectory: false,
					lastModified: Date.now(),
				}));
			}

			return groupNonRecursiveEntries(filtered, prefix);
		} catch (err: unknown) {
			throw new Error(
				`GitAdapter: failed to list "${path}": ${errMsg(err, 'unknown error')}`,
				{ cause: err },
			);
		}
	}

	async watch(
		callback: (events: WatchEvent[]) => void,
		root?: string,
	): Promise<() => void> {
		const repo = await this.repoManager.ensureRepo(assertRoot(root));

		const poller = createWatchPoller(repo.fs, repo.cloneDir);
		poller.start(callback);
		return () => {
			poller.stop();
		};
	}

	async createDir(path: string, root?: string): Promise<void> {
		const repo = await this.repoManager.ensureRepo(assertRoot(root));
		const fullPath = resolvePath(repo.cloneDir, path);

		try {
			await repo.fs.promises
				.mkdir(fullPath, { recursive: true })
				.catch((_e: unknown) => {
					/* dir may already exist */
				});

			const gitkeepPath = `${fullPath}/.gitkeep`;
			await repo.fs.promises.writeFile(gitkeepPath, '');
			await this.commitAndPush(
				repo,
				`${relativePath(path)}/.gitkeep`,
				`Create directory ${path}`,
				root,
			);
		} catch (err: unknown) {
			throw new Error(
				`GitAdapter: failed to create directory "${path}": ${errMsg(err, 'unknown error')}`,
				{ cause: err },
			);
		}
	}

	async testConnection(config: AdapterConfig): Promise<ConnectionTestResult> {
		const gitConfig = config as GitAdapterConfig;
		const repoUrl = gitConfig.repoUrl;

		// Initialise the repo (idempotent) and try to fetch
		try {
			const repo = await this.repoManager.ensureRepo(repoUrl);

			// If we already have auth, try a fetch to confirm reachability
			const token = await this.tokenStore.getToken(repoUrl);
			if (token || gitConfig.token) {
				// Ensure token is stored for this fetch
				if (gitConfig.token) {
					await this.tokenStore.setToken(repoUrl, gitConfig.token);
				}

				const authToken = await this.tokenStore.getToken(repoUrl);
				try {
					await fetchRemote(repo, authToken);
					// Check out fetched content so HEAD resolves for later reads.
					// No-op when the remote has no commits — connection still works.
					await checkoutRemoteBranch(repo);
					return { ok: true };
				} catch (fetchErr: unknown) {
					return {
						ok: false,
						error: `Cannot reach remote: ${errMsg(fetchErr, 'fetch failed')}`,
					};
				}
			}

			// No token stored yet — just verify the repo initialised without error
			return { ok: true };
		} catch (err: unknown) {
			return {
				ok: false,
				error: errMsg(err, 'unknown connection error'),
			};
		}
	}

	async registerScope(_root: string): Promise<void> {
		// No OS-level scope registration needed
	}

	// ── Private helpers ──────────────────────────────────────────────────

	/**
	 * Git add/remove + commit + push in one step.
	 * @param action 'add' (default) or 'remove'
	 */
	private async commitAndPush(
		repo: RepoEntry,
		filepath: string,
		message: string,
		root?: string,
		action: 'add' | 'remove' = 'add',
	): Promise<void> {
		if (action === 'remove') {
			await git.remove({ fs: repo.fs, dir: repo.cloneDir, filepath });
		} else {
			await git.add({ fs: repo.fs, dir: repo.cloneDir, filepath });
		}
		const commitResult = await git.commit({
			fs: repo.fs,
			dir: repo.cloneDir,
			author: { name: repo.authorName, email: repo.authorEmail },
			message,
			ref: `refs/heads/${repo.branch}`,
		});
		debugLog(
			`[GitAdapter] commit: "${message}" → ${commitResult.slice(0, 12)}`,
		);
		await this.tryPush(repo, root);
	}

	/**
	 * Attempt to push changes to the remote. Non-blocking.
	 * Fetches first so the push is a clean fast-forward over any remote
	 * commits (e.g. from another device or manual push).
	 * Logs warnings on failure — the sync engine will retry on next write.
	 */
	private async tryPush(repo: RepoEntry, root?: string): Promise<void> {
		if (!root) {
			debugLog('[GitAdapter] tryPush: no root, skipping push');
			return;
		}
		try {
			const token = await this.tokenStore.getToken(root);
			if (!token) {
				debugLog(
					`[GitAdapter] tryPush: no token for "${root}", skipping push`,
				);
				return;
			}

			// Fetch latest remote state, fast-forward if remote is ahead
			// (no-op when local is ahead), then push as a clean fast-forward.
			await fetchRemote(repo, token);
			await fastForwardFromRemote(repo);
			await pushBranch(repo, token);
			debugLog(`[GitAdapter] push OK: "${repo.branch}" → "${root}"`);
		} catch (err) {
			console.warn(
				`[GitAdapter] push FAILED for "${repo.branch}" on "${root}":`,
				err,
			);
		}
	}
}
