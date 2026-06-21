/**
 * Git protocol cloud adapter — implements the Adapter interface using
 * isomorphic-git (pure TypeScript) with LightningFS (IndexedDB backend).
 *
 * Each `root` parameter corresponds to a git repository URL.
 * All operations work against a local clone managed by LightningFS.
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
import { GitCloneState, type GitFsBackend } from './types';
import { createGitFsBackend } from './fs';
import { GitTokenStore } from './auth';
import {
	repoUrlToDir,
	resolvePath,
	relativePath,
	errMsg,
	assertRoot,
} from './helpers';
import { debugLog } from '@core/utils/debug-logger';
import git from 'isomorphic-git';
import http from './http';

// ── Adapter ────────────────────────────────────────────────────────────────

export class GitAdapter implements Adapter {
	readonly id = 'git';
	readonly isLocal = false;

	private readonly repos = new Map<
		string,
		{
			cloneDir: string;
			fs: GitFsBackend;
			state: GitCloneState;
			error: string | null;
			branch: string;
			authorName: string;
			authorEmail: string;
		}
	>();

	private readonly tokenStore = new GitTokenStore();

	isAvailable(): boolean {
		return true;
	}

	pickWorkspaceFolder(): Promise<WorkspacePickResult | null> {
		return Promise.resolve(null);
	}

	private async ensureRepo(root: string): Promise<{
		cloneDir: string;
		fs: GitFsBackend;
		branch: string;
		authorName: string;
		authorEmail: string;
	}> {
		if (!root) {
			throw new Error('GitAdapter: root (repo URL) is required');
		}

		let repo = this.repos.get(root);
		if (!repo) {
			const cloneDir = `/__git_${repoUrlToDir(root)}`;
			const fs = await createGitFsBackend(cloneDir);
			repo = {
				cloneDir,
				fs,
				state: GitCloneState.NOT_CLONED,
				error: null,
				branch: 'main',
				authorName: 'Note App User',
				authorEmail: 'user@note-app.local',
			};
			this.repos.set(root, repo);
		}

		if (repo.state === GitCloneState.NOT_CLONED) {
			await this.#initRepo(repo, root);
		}

		if (repo.state === GitCloneState.ERROR) {
			throw new Error(
				`GitAdapter: repo "${root}" is in error state: ${String(repo.error)}`,
			);
		}

		return repo;
	}

	/** Initialise a new repo: mkdir, git init, configure remote, fetch. */
	async #initRepo(
		repo: {
			cloneDir: string;
			fs: GitFsBackend;
			branch: string;
			authorName: string;
			authorEmail: string;
		} & { state: GitCloneState; error: string | null },
		root: string,
	): Promise<void> {
		repo.state = GitCloneState.CLONING;
		try {
			await repo.fs.promises
				.mkdir(repo.cloneDir, { recursive: true })
				.catch((_e: unknown) => {
					/* dir may already exist */
				});

			await git.init({
				fs: repo.fs,
				dir: repo.cloneDir,
				defaultBranch: repo.branch,
			});

			await this.#configureRemote(repo, root);
			await this.#tryInitFetch(repo, root);
			await this.#initRepoCheckout(repo, root);

			repo.state = GitCloneState.READY;
		} catch (err: unknown) {
			repo.state = GitCloneState.ERROR;
			repo.error = errMsg(err, 'unknown init error');
			throw new Error(
				`GitAdapter: failed to initialise repo "${root}": ${errMsg(err, 'unknown error')}`,
				{ cause: err },
			);
		}
	}

	/**
	 * Checkout or merge branch after fetch.
	 *
	 * On page reload, LightningFS (IndexedDB) preserves commits, refs, and
	 * working tree from the last write. Without this guard, we'd always
	 * checkout origin/branch, which ABANDONS any unpushed local commits
	 * (e.g. a delete whose push was queued but never completed).
	 *
	 * When local commits exist: fast-forward merge from remote (if reachable),
	 * preserving local history.
	 * When no local commits (first init): checkout from remote so
	 * git.listFiles({ ref: 'HEAD' }) has content to return.
	 */
	async #initRepoCheckout(
		repo: {
			cloneDir: string;
			fs: GitFsBackend;
			branch: string;
		},
		_root: string,
	): Promise<void> {
		const localSha: string | null = await git
			.resolveRef({
				fs: repo.fs,
				dir: repo.cloneDir,
				ref: `refs/heads/${repo.branch}`,
			})
			.catch(() => null);
		const remoteSha: string | null = await git
			.resolveRef({
				fs: repo.fs,
				dir: repo.cloneDir,
				ref: `refs/remotes/origin/${repo.branch}`,
			})
			.catch(() => null);
		debugLog(
			`[GitAdapter] initRepo: local=${localSha?.slice(0, 8) ?? '—'} remote=${remoteSha?.slice(0, 8) ?? '—'}`,
		);

		// Local branch exists — preserve local commits, fast-forward
		// from remote if possible.
		if (localSha !== null && remoteSha !== null && localSha !== remoteSha) {
			await this.#initRepoMerge(repo);
		} else if (localSha === null) {
			// No local commits — checkout from remote so HEAD resolves.
			await this.#initRepoCheckoutRemote(repo);
		}
	}

	/** Fast-forward merge local branch from remote. */
	async #initRepoMerge(repo: {
		cloneDir: string;
		fs: GitFsBackend;
		branch: string;
	}): Promise<void> {
		try {
			await git.merge({
				fs: repo.fs,
				dir: repo.cloneDir,
				ours: `refs/heads/${repo.branch}`,
				theirs: `refs/remotes/origin/${repo.branch}`,
				fastForwardOnly: true,
			});
			debugLog(
				'[GitAdapter] initRepo: fast-forwarded local branch to match remote',
			);
		} catch {
			debugLog(
				'[GitAdapter] initRepo: local branch is ahead of remote — preserving local commits',
			);
		}
	}

	/** Checkout remote branch and create local tracking branch. */
	async #initRepoCheckoutRemote(repo: {
		cloneDir: string;
		fs: GitFsBackend;
		branch: string;
	}): Promise<void> {
		try {
			await git.checkout({
				fs: repo.fs,
				dir: repo.cloneDir,
				ref: `origin/${repo.branch}`,
			});
			await git.branch({
				fs: repo.fs,
				dir: repo.cloneDir,
				ref: repo.branch,
				checkout: true,
			});
			debugLog(
				`[GitAdapter] initRepo: checked out origin/${repo.branch} as local branch`,
			);
		} catch {
			debugLog(
				`[GitAdapter] initRepo: no commits on origin/${repo.branch} — empty repo`,
			);
		}
	}

	/** Add remote origin if not already configured. */
	async #configureRemote(
		repo: { cloneDir: string; fs: GitFsBackend },
		root: string,
	): Promise<void> {
		try {
			const remotes = await git.listRemotes({
				fs: repo.fs,
				dir: repo.cloneDir,
			});
			if (!remotes.some((r) => r.remote === 'origin')) {
				await git.addRemote({
					fs: repo.fs,
					dir: repo.cloneDir,
					remote: 'origin',
					url: root,
				});
			}
		} catch {
			/* remote config is best-effort */
		}
	}

	/** Attempt to fetch remote content (non-fatal — may fail on auth/network). */
	async #tryInitFetch(
		repo: { cloneDir: string; fs: GitFsBackend },
		root: string,
	): Promise<void> {
		try {
			const token = await this.tokenStore.getToken(root);
			await git.fetch({
				fs: repo.fs,
				dir: repo.cloneDir,
				http,
				remote: 'origin',
				...(token
					? { onAuth: () => ({ username: 'token', password: token }) }
					: {}),
			});
			debugLog(`[GitAdapter] tryInitFetch: fetch OK for "${root}"`);
		} catch {
			debugLog(
				`[GitAdapter] tryInitFetch: fetch skipped (no auth/network) for "${root}"`,
			);
		}
	}

	async read(path: string, root?: string): Promise<string> {
		const repo = await this.ensureRepo(assertRoot(root));
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
		const repo = await this.ensureRepo(assertRoot(root));
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
		const repo = await this.ensureRepo(assertRoot(root));

		debugLog(`[GitAdapter] delete("${path}") — committing remove + push`);

		try {
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
		const repo = await this.ensureRepo(assertRoot(root));

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
		const repo = await this.ensureRepo(assertRoot(root));

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

			return this.#groupNonRecursiveEntries(filtered, prefix);
		} catch (err: unknown) {
			throw new Error(
				`GitAdapter: failed to list "${path}": ${errMsg(err, 'unknown error')}`,
				{ cause: err },
			);
		}
	}
	/** Group files into a flat directory listing (non-recursive mode). */
	#groupNonRecursiveEntries(files: string[], prefix: string): FileEntry[] {
		const seen = new Set<string>();
		const entries: FileEntry[] = [];
		for (const f of files) {
			const rel = prefix ? f.slice(prefix.length).replace(/^\//, '') : f;
			const parts = rel.split('/');
			const name = parts[0];
			if (!name || seen.has(name)) continue;
			seen.add(name);
			entries.push({
				name,
				path: prefix ? `${prefix}/${name}` : name,
				isDirectory: parts.length > 1,
				lastModified: Date.now(),
			});
		}
		return entries;
	}

	async watch(
		callback: (events: WatchEvent[]) => void,
		root?: string,
	): Promise<() => void> {
		const repo = await this.ensureRepo(assertRoot(root));

		let intervalMs = 30_000;
		const MAX_INTERVAL = 15 * 60 * 1000;
		let lastKnownSha: string | null = null;

		try {
			lastKnownSha = await git.resolveRef({
				fs: repo.fs,
				dir: repo.cloneDir,
				ref: 'HEAD',
			});
		} catch {
			// No commits yet
		}

		let active = true;
		let timerId: ReturnType<typeof setInterval> | null = null;

		const poll = () => {
			if (!active || document.hidden) return;

			void (async () => {
				try {
					await git.fetch({
						fs: repo.fs,
						dir: repo.cloneDir,
						http,
						remote: 'origin',
					});

					intervalMs = 30_000;

					const currentSha = await git.resolveRef({
						fs: repo.fs,
						dir: repo.cloneDir,
						ref: 'HEAD',
					});

					if (lastKnownSha && lastKnownSha !== currentSha) {
						callback([{ type: 'modify', path: '/' }]);
					}
					lastKnownSha = currentSha;
				} catch {
					intervalMs = Math.min(intervalMs * 2, MAX_INTERVAL);
				}
			})();
		};

		timerId = setInterval(poll, intervalMs);

		const handleVisibility = () => {
			if (!document.hidden && timerId === null) {
				timerId = setInterval(poll, intervalMs);
				poll();
			} else if (document.hidden && timerId !== null) {
				clearInterval(timerId);
				timerId = null;
			}
		};
		document.addEventListener('visibilitychange', handleVisibility);

		return () => {
			active = false;
			if (timerId !== null) {
				clearInterval(timerId);
				timerId = null;
			}
			document.removeEventListener('visibilitychange', handleVisibility);
		};
	}

	async createDir(path: string, root?: string): Promise<void> {
		const repo = await this.ensureRepo(assertRoot(root));
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
			const repo = await this.ensureRepo(repoUrl);

			// If we already have auth, try a fetch to confirm reachability
			const token = await this.tokenStore.getToken(repoUrl);
			if (token || gitConfig.token) {
				// Ensure token is stored for this fetch
				if (gitConfig.token) {
					await this.tokenStore.setToken(repoUrl, gitConfig.token);
				}

				const authToken = await this.tokenStore.getToken(repoUrl);
				try {
					await git.fetch({
						fs: repo.fs,
						dir: repo.cloneDir,
						http,
						remote: 'origin',
						onAuth: () =>
							authToken
								? { username: 'token', password: authToken }
								: undefined,
					});

					// Check out fetched content so HEAD resolves for subsequent reads
					try {
						await git.checkout({
							fs: repo.fs,
							dir: repo.cloneDir,
							ref: `origin/${repo.branch}`,
						});
						// Create local tracking branch — same reason as initRepo
						await git.branch({
							fs: repo.fs,
							dir: repo.cloneDir,
							ref: repo.branch,
							checkout: true,
						});
					} catch {
						// No commits yet — still ok, connection works
					}

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
		repo: {
			cloneDir: string;
			fs: GitFsBackend;
			branch: string;
			authorName: string;
			authorEmail: string;
		},
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
			ref: repo.branch,
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
	private async tryPush(
		repo: {
			cloneDir: string;
			fs: GitFsBackend;
			branch: string;
			authorName: string;
			authorEmail: string;
		},
		root?: string,
	): Promise<void> {
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

			const onAuth = () => ({
				username: 'token' as const,
				password: token,
			});

			// Fetch latest remote state so the push is a fast-forward
			await git.fetch({
				fs: repo.fs,
				dir: repo.cloneDir,
				http,
				remote: 'origin',
				onAuth,
			});

			// Fast-forward local branch to match remote if it's ahead.
			// No-op when local is ahead (normal write-then-push).
			try {
				await git.merge({
					fs: repo.fs,
					dir: repo.cloneDir,
					ours: `refs/heads/${repo.branch}`,
					theirs: `refs/remotes/origin/${repo.branch}`,
					fastForwardOnly: true,
				});
			} catch {
				// No remote ref, or local is already ahead — no merge needed
			}

			await git.push({
				fs: repo.fs,
				dir: repo.cloneDir,
				http,
				remote: 'origin',
				ref: repo.branch,
				remoteRef: `refs/heads/${repo.branch}`,
				onAuth,
			});
			debugLog(`[GitAdapter] push OK: "${repo.branch}" → "${root}"`);
		} catch (err) {
			console.warn(
				`[GitAdapter] push FAILED for "${repo.branch}" on "${root}":`,
				err,
			);
		}
	}
}
