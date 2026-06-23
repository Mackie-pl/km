/**
 * Git write-path engine — commit → push → divergence recovery.
 *
 * Extracted from `GitAdapter` so the adapter stays focused on the `Adapter`
 * CRUD contract + filesystem work. This class owns everything between "a change
 * is staged in the working tree" and "it has reached the remote":
 * - serialized commit+push per repo (via {@link RepoEntry.commitLock}),
 * - non-fast-forward recovery (reset to remote + reconcile via the vault),
 * - the reconcile-sink registry that recovery emits remote changes to.
 *
 * It sits between the adapter and the low-level `git-ops` primitives.
 */

import type { WatchEvent } from '../../adapter.interface';
import { GitDivergenceError, type RepoEntry } from './types';
import type { GitTokenStore } from './auth';
import { resolvePath, relativePath } from './helpers';
import {
	fetchRemote,
	fastForwardFromRemote,
	pushBranch,
	isNonFastForwardError,
	mergeBaseOf,
	resetBranchToRemote,
	resolveRefSafe,
	diffCommitFiles,
} from './git-ops';
import { debugLog } from '@core/utils/debug-logger';
import git from 'isomorphic-git';

export class GitPushEngine {
	constructor(private readonly tokenStore: GitTokenStore) {}

	/**
	 * Reconcile sinks keyed by root (repo URL). Divergence recovery emits the
	 * precise remote changes here so they flow through the same reconcile
	 * pipeline as poll-detected changes — keeping the adapter "dumb" (it only
	 * emits file events; it never touches the vault).
	 */
	private readonly reconcileSinks = new Map<
		string,
		(events: WatchEvent[]) => void
	>();

	/** Register the sink that divergence recovery emits remote changes to. */
	registerReconcileSink(
		root: string,
		sink: (events: WatchEvent[]) => void,
	): void {
		this.reconcileSinks.set(root, sink);
	}

	/** Remove a previously-registered reconcile sink. */
	unregisterReconcileSink(root: string): void {
		this.reconcileSinks.delete(root);
	}

	/**
	 * Git add/remove + commit + push in one step.
	 *
	 * Serialized per repo via `repo.commitLock`: two concurrent commits would
	 * both read the current HEAD as their parent and fork the branch, which the
	 * remote then rejects as a non-fast-forward. Chaining onto the lock makes
	 * each commit observe the previous one's HEAD.
	 *
	 * @param action 'add' (default) or 'remove'
	 */
	commitAndPush(
		repo: RepoEntry,
		filepath: string,
		message: string,
		root?: string,
		action: 'add' | 'remove' = 'add',
	): Promise<void> {
		return this.runLocked(repo, () =>
			this.stageCommitPush(repo, filepath, message, root, action),
		);
	}

	/**
	 * Move a set of tracked files (a single file, or a whole directory subtree)
	 * to a new path prefix in one commit. Runs under `repo.commitLock`.
	 */
	renameCommitPush(
		repo: RepoEntry,
		sources: string[],
		oldPath: string,
		newPath: string,
		root?: string,
	): Promise<void> {
		return this.runLocked(repo, () =>
			this.stageRenameCommitPush(repo, sources, oldPath, newPath, root),
		);
	}

	/**
	 * Serialize `run` onto `repo.commitLock` so two concurrent commits can't
	 * read the same HEAD as their parent and diverge into a branch the remote
	 * rejects as non-fast-forward. The tail is kept non-rejecting so one failure
	 * doesn't wedge the chain; the caller still sees the real result via `next`.
	 */
	private runLocked(
		repo: RepoEntry,
		run: () => Promise<void>,
	): Promise<void> {
		const next = repo.commitLock.then(run, run);
		repo.commitLock = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	/** Stage + commit + push for a single path. Runs under `repo.commitLock`. */
	private async stageCommitPush(
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
			// Skip empty commits: when staging produces no change vs HEAD
			// (e.g. a directory whose .gitkeep already exists, or a save with
			// identical content) there is nothing to commit or push.
			const status = await git.status({
				fs: repo.fs,
				dir: repo.cloneDir,
				filepath,
			});
			if (status === 'unmodified') {
				debugLog(
					`[GitAdapter] skip commit: "${filepath}" unchanged (${message})`,
				);
				return;
			}
		}
		await this.commitPush(repo, message, root);
	}

	/**
	 * Move a set of tracked files (a single file, or a whole directory subtree)
	 * to a new path prefix in one commit. Git has no directory rename, so a
	 * folder move is expanded into a per-file copy-content + add-new + remove-old.
	 * Moving the subtree (including `.gitkeep`) in one commit is what prevents
	 * the old paths from lingering and being re-imported as duplicates.
	 * Runs under `repo.commitLock`.
	 */
	private async stageRenameCommitPush(
		repo: RepoEntry,
		sources: string[],
		oldPath: string,
		newPath: string,
		root?: string,
	): Promise<void> {
		const oldRel = relativePath(oldPath);
		const newRel = relativePath(newPath);
		const headOid = await git.resolveRef({
			fs: repo.fs,
			dir: repo.cloneDir,
			ref: 'HEAD',
		});

		for (const from of sources) {
			const to = newRel + from.slice(oldRel.length);
			const { blob } = await git.readBlob({
				fs: repo.fs,
				dir: repo.cloneDir,
				oid: headOid,
				filepath: from,
			});
			const destFull = resolvePath(repo.cloneDir, to);
			const parentDir = destFull.split('/').slice(0, -1).join('/');
			await repo.fs.promises
				.mkdir(parentDir, { recursive: true })
				.catch((_e: unknown) => {
					/* parent may already exist */
				});
			await repo.fs.promises.writeFile(destFull, blob);
			await git.add({ fs: repo.fs, dir: repo.cloneDir, filepath: to });
			await git.remove({ fs: repo.fs, dir: repo.cloneDir, filepath: from });
		}

		const message =
			sources.length === 1
				? `Rename ${oldPath} → ${newPath}`
				: `Rename ${oldPath}/ → ${newPath}/ (${String(sources.length)} files)`;
		await this.commitPush(repo, message, root);
	}

	/** Commit already-staged changes and push. Runs under `repo.commitLock`. */
	private async commitPush(
		repo: RepoEntry,
		message: string,
		root?: string,
	): Promise<void> {
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
		await this.pushToRemote(repo, root);
	}

	/**
	 * Push the local branch to the remote, recovering from divergence.
	 *
	 * This PROPAGATES failures: the caller (sync push phase) must not mark the
	 * entry synced unless the content actually reached the remote. A "no
	 * root"/"no token" situation is a soft skip (setup not complete yet); a real
	 * network/auth/push error throws.
	 */
	private async pushToRemote(repo: RepoEntry, root?: string): Promise<void> {
		if (!root) {
			debugLog('[GitAdapter] push: no root, skipping');
			return;
		}
		const token = await this.tokenStore.getToken(root);
		if (!token) {
			debugLog(`[GitAdapter] push: no token for "${root}", skipping`);
			return;
		}

		await this.pushWithRecovery(repo, token, root);
		debugLog(`[GitAdapter] push OK: "${repo.branch}" → "${root}"`);
	}

	/**
	 * Fetch + fast-forward + push. On a non-fast-forward rejection, retry once
	 * after a fresh fetch+FF (handles the benign "someone pushed between our
	 * fetch and push" race); if still diverged, reconcile via the vault.
	 */
	private async pushWithRecovery(
		repo: RepoEntry,
		token: string,
		root: string,
	): Promise<void> {
		await fetchRemote(repo, token);
		await fastForwardFromRemote(repo);
		if (await this.pushOrDetectDivergence(repo, token)) return;

		// Benign race: refetch, fast-forward over the new remote commit, retry.
		await fetchRemote(repo, token);
		await fastForwardFromRemote(repo);
		if (await this.pushOrDetectDivergence(repo, token)) return;

		// True divergence — the remote has commits we can't fast-forward over.
		await this.recoverFromDivergence(repo, root);
	}

	/**
	 * Push, classifying the outcome: `true` = pushed; `false` = rejected
	 * non-fast-forward (divergence). Any other error propagates.
	 */
	private async pushOrDetectDivergence(
		repo: RepoEntry,
		token: string,
	): Promise<boolean> {
		try {
			await pushBranch(repo, token);
			return true;
		} catch (err) {
			if (isNonFastForwardError(err)) return false;
			throw err;
		}
	}

	/**
	 * Recover from a diverged remote: compute the files the remote changed (since
	 * the merge-base), reset the local clone to the remote tip, emit those
	 * changes to the registered reconcile sink so the reconciler applies them
	 * (with `.conflict-git` copies for genuine overlaps), then throw so the entry
	 * stays pending and re-pushes cleanly on top of the reset branch.
	 */
	private async recoverFromDivergence(
		repo: RepoEntry,
		root: string,
	): Promise<never> {
		const local = await resolveRefSafe(repo, 'HEAD');
		const remote = await resolveRefSafe(
			repo,
			`refs/remotes/origin/${repo.branch}`,
		);

		let changed: WatchEvent[] = [];
		if (local !== null && remote !== null) {
			const base = await mergeBaseOf(repo, local, remote);
			changed = await diffCommitFiles(repo, base ?? local, remote);
		}

		await resetBranchToRemote(repo);
		debugLog(
			`[GitAdapter] divergence on "${repo.branch}" — reset to remote, ${String(changed.length)} remote change(s) to reconcile`,
		);

		if (changed.length > 0) {
			this.reconcileSinks.get(root)?.(changed);
		}
		throw new GitDivergenceError(repo.branch);
	}
}
