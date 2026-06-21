/**
 * Git repository clone lifecycle manager.
 *
 * Owns the in-memory map of managed repos and the clone state machine:
 * init → configure remote → fetch → checkout/merge. The adapter delegates to
 * `ensureRepo(root)` and otherwise stays out of the lifecycle.
 */

import { GitCloneState, type RepoEntry } from './types';
import { createGitFsBackend } from './fs';
import { repoUrlToDir, errMsg } from './helpers';
import {
	fetchRemote,
	checkoutRemoteBranch,
	fastForwardFromRemote,
	resolveRefSafe,
} from './git-ops';
import type { GitTokenStore } from './auth';
import { debugLog } from '@core/utils/debug-logger';
import git from 'isomorphic-git';

export class GitRepoManager {
	private readonly repos = new Map<string, RepoEntry>();

	constructor(private readonly tokenStore: GitTokenStore) {}

	/**
	 * Get a ready-to-use repo for `root`, initialising (and fetching) it on
	 * first access. Throws if the repo previously failed to initialise.
	 */
	async ensureRepo(root: string): Promise<RepoEntry> {
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
	async #initRepo(repo: RepoEntry, root: string): Promise<void> {
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
			await this.#initRepoCheckout(repo);

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
	async #initRepoCheckout(repo: RepoEntry): Promise<void> {
		const localSha = await resolveRefSafe(repo, `refs/heads/${repo.branch}`);
		const remoteSha = await resolveRefSafe(
			repo,
			`refs/remotes/origin/${repo.branch}`,
		);
		debugLog(
			`[GitAdapter] initRepo: local=${localSha?.slice(0, 8) ?? '—'} remote=${remoteSha?.slice(0, 8) ?? '—'}`,
		);

		// Local branch exists — preserve local commits, fast-forward
		// from remote if possible.
		if (localSha !== null && remoteSha !== null && localSha !== remoteSha) {
			const ff = await fastForwardFromRemote(repo);
			debugLog(
				ff
					? '[GitAdapter] initRepo: fast-forwarded local branch to match remote'
					: '[GitAdapter] initRepo: local branch is ahead of remote — preserving local commits',
			);
		} else if (localSha === null) {
			// No local commits — checkout from remote so HEAD resolves.
			const ok = await checkoutRemoteBranch(repo);
			debugLog(
				ok
					? `[GitAdapter] initRepo: checked out origin/${repo.branch} as local branch`
					: `[GitAdapter] initRepo: no commits on origin/${repo.branch} — empty repo`,
			);
		}
	}

	/** Add remote origin if not already configured. */
	async #configureRemote(repo: RepoEntry, root: string): Promise<void> {
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
	async #tryInitFetch(repo: RepoEntry, root: string): Promise<void> {
		try {
			const token = await this.tokenStore.getToken(root);
			await fetchRemote(repo, token);
			debugLog(`[GitAdapter] tryInitFetch: fetch OK for "${root}"`);
		} catch {
			debugLog(
				`[GitAdapter] tryInitFetch: fetch skipped (no auth/network) for "${root}"`,
			);
		}
	}
}
