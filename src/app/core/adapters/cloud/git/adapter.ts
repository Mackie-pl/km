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
import { GitRepoManager } from './repo-manager';
import { GitPushEngine } from './push-engine';
import { createWatchPoller } from './watch-poller';
import { GitTokenStore } from './auth';
import { GitSettingsStore } from './settings-store';
import {
	resolvePath,
	relativePath,
	errMsg,
	assertRoot,
	groupNonRecursiveEntries,
} from './helpers';
import { fetchRemote, checkoutRemoteBranch } from './git-ops';
import { debugLog } from '@core/utils/debug-logger';
import git from 'isomorphic-git';

// ── Adapter ────────────────────────────────────────────────────────────────

export class GitAdapter implements Adapter {
	readonly id = 'git';
	readonly isLocal = false;

	private readonly tokenStore = new GitTokenStore();
	private readonly settingsStore = new GitSettingsStore();
	private readonly repoManager = new GitRepoManager(
		this.tokenStore,
		this.settingsStore,
	);

	/** Owns commit → push → divergence recovery for the write path. */
	private readonly pushEngine = new GitPushEngine(this.tokenStore);

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

			await this.pushEngine.commitAndPush(
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

			await this.pushEngine.commitAndPush(
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
			const oldRel = relativePath(oldPath);

			const tracked = await git
				.listFiles({ fs: repo.fs, dir: repo.cloneDir, ref: 'HEAD' })
				.catch(() => [] as string[]);

			// A rename moves either a single tracked file or — since git has no
			// first-class directories — every file under the old path's prefix.
			const sources = tracked.includes(oldRel)
				? [oldRel]
				: tracked.filter((f) => f.startsWith(oldRel + '/'));

			if (sources.length === 0) {
				// Nothing tracked at the old path on this remote. Throw so the
				// push phase can fall back appropriately (write the file, or
				// create the directory for an empty folder) instead of silently
				// dropping the entry or writing a placeholder at a folder path.
				throw new Error(`nothing tracked at "${oldPath}"`);
			}

			await this.pushEngine.renameCommitPush(
				repo,
				sources,
				oldPath,
				newPath,
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
		const resolvedRoot = assertRoot(root);
		const repo = await this.repoManager.ensureRepo(resolvedRoot);

		const { pollIntervalMs } = this.settingsStore.get(resolvedRoot);
		const poller = createWatchPoller(
			repo,
			() => this.tokenStore.getToken(resolvedRoot),
			pollIntervalMs,
		);
		// Register so divergence recovery can emit precise remote changes here.
		this.pushEngine.registerReconcileSink(resolvedRoot, callback);
		poller.start(callback);
		return () => {
			poller.stop();
			this.pushEngine.unregisterReconcileSink(resolvedRoot);
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
			await this.pushEngine.commitAndPush(
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

		try {
			// Persist non-secret settings (branch/author/poll) and the token
			// BEFORE building the repo, so the clone uses the configured branch
			// and author. `forget` drops any cached entry (e.g. from a previous
			// config) so it rebuilds from the freshly stored settings.
			this.settingsStore.set(repoUrl, gitConfig);
			if (gitConfig.token) {
				await this.tokenStore.setToken(repoUrl, gitConfig.token);
			}
			this.repoManager.forget(repoUrl);

			const repo = await this.repoManager.ensureRepo(repoUrl);

			// If we have auth, try a fetch to confirm reachability.
			const authToken = await this.tokenStore.getToken(repoUrl);
			if (authToken) {
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
}
