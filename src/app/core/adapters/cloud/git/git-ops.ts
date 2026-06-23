/**
 * Low-level isomorphic-git wrappers for the Git adapter.
 *
 * These are stateless primitives over a {@link RepoEntry} (they only read
 * `fs`/`cloneDir`/`branch`). Authentication is passed in as a token — this
 * layer never touches the token store. Higher layers (repo-manager, adapter)
 * resolve the token and decide what to log; git-ops just talks to the remote.
 */

import type { RepoEntry } from './types';
import type { WatchEvent } from '../../adapter.interface';
import git, { TREE, type WalkerEntry } from 'isomorphic-git';
import http from './http';

type OnAuth = () => { username: string; password: string };

/** Build the isomorphic-git `onAuth` callback for a token, if present. */
function buildAuth(token?: string | null): { onAuth: OnAuth } | undefined {
	return token
		? { onAuth: () => ({ username: 'token', password: token }) }
		: undefined;
}

/** Fetch from origin, optionally authenticated. Throws on network/auth error. */
export async function fetchRemote(
	repo: RepoEntry,
	token?: string | null,
): Promise<void> {
	await git.fetch({
		fs: repo.fs,
		dir: repo.cloneDir,
		http,
		remote: 'origin',
		...buildAuth(token),
	});
}

/**
 * Checkout `origin/<branch>` and create a local tracking branch so that
 * `HEAD` resolves for subsequent reads. Best-effort — swallows the error when
 * the remote has no commits (empty repo).
 */
export async function checkoutRemoteBranch(repo: RepoEntry): Promise<boolean> {
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
		return true;
	} catch {
		return false;
	}
}

/**
 * Fast-forward the local branch to match `origin/<branch>`.
 * No-op (swallowed) when there is no remote ref or the local branch is already
 * ahead — i.e. the normal write-then-push case.
 */
export async function fastForwardFromRemote(repo: RepoEntry): Promise<boolean> {
	try {
		await git.merge({
			fs: repo.fs,
			dir: repo.cloneDir,
			ours: `refs/heads/${repo.branch}`,
			theirs: `refs/remotes/origin/${repo.branch}`,
			fastForwardOnly: true,
		});
		return true;
	} catch {
		return false;
	}
}

/** Push the local branch to origin. Throws on failure. */
export async function pushBranch(
	repo: RepoEntry,
	token: string,
): Promise<void> {
	await git.push({
		fs: repo.fs,
		dir: repo.cloneDir,
		http,
		remote: 'origin',
		ref: repo.branch,
		remoteRef: `refs/heads/${repo.branch}`,
		...buildAuth(token),
	});
}

/**
 * True when an error from {@link pushBranch} is a non-fast-forward rejection
 * (the remote has commits the local branch doesn't) — the signal that the
 * branch has diverged and needs reconciliation rather than a plain retry.
 *
 * isomorphic-git surfaces this either as a client-detected `PushRejectedError`
 * (`reason: 'not-fast-forward'`) or, when the server rejects the ref, a
 * `GitPushError` carrying a `PushResult` with a per-ref error string.
 */
export function isNonFastForwardError(err: unknown): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const e = err as { code?: unknown; data?: unknown };
	if (e.code === 'PushRejectedError') return isNotFastForwardReason(e.data);
	if (e.code === 'GitPushError') return hasNonFastForwardRef(e.data);
	return false;
}

function isNotFastForwardReason(data: unknown): boolean {
	const reason = (data as { reason?: unknown } | null | undefined)?.reason;
	return reason === 'not-fast-forward';
}

function hasNonFastForwardRef(data: unknown): boolean {
	const refs = (
		data as
			| { result?: { refs?: Record<string, { error?: string | null }> } }
			| null
			| undefined
	)?.result?.refs;
	if (!refs) return false;
	return Object.values(refs).some(
		(r) =>
			typeof r.error === 'string' && /fast-forward|fetch first/i.test(r.error),
	);
}

/**
 * Merge-base (common ancestor) of two commits, or `null` if there is none
 * (unrelated histories). Used to scope a divergence reconcile to only the
 * files the remote actually changed.
 */
export async function mergeBaseOf(
	repo: RepoEntry,
	a: string,
	b: string,
): Promise<string | null> {
	const bases = (await git
		.findMergeBase({ fs: repo.fs, dir: repo.cloneDir, oids: [a, b] })
		.catch((): string[] => [])) as string[];
	return bases[0] ?? null;
}

/**
 * Hard-reset the local branch (and working tree) to `origin/<branch>`.
 *
 * Used to recover from a divergence: the git clone is a replaceable transport,
 * so discarding local commits is safe — their content lives in the canonical
 * vault and is re-pushed as fresh commits on top of the reset branch.
 * Returns `false` (no-op) when there is no remote-tracking ref to reset to.
 */
export async function resetBranchToRemote(repo: RepoEntry): Promise<boolean> {
	const remoteSha = await resolveRefSafe(
		repo,
		`refs/remotes/origin/${repo.branch}`,
	);
	if (!remoteSha) return false;
	await git.writeRef({
		fs: repo.fs,
		dir: repo.cloneDir,
		ref: `refs/heads/${repo.branch}`,
		value: remoteSha,
		force: true,
	});
	await git.checkout({
		fs: repo.fs,
		dir: repo.cloneDir,
		ref: repo.branch,
		force: true,
	});
	return true;
}

/** Resolve a ref to its SHA, or `null` if it does not exist. */
export async function resolveRefSafe(
	repo: RepoEntry,
	ref: string,
): Promise<string | null> {
	return git
		.resolveRef({ fs: repo.fs, dir: repo.cloneDir, ref })
		.catch(() => null);
}

/**
 * Compute the per-file changes between two commits (`oldOid` → `newOid`) as
 * {@link WatchEvent}s. Used by the watch poller to translate a remote advance
 * into precise create/modify/delete events the reconciler can apply, rather
 * than a coarse "something changed" signal.
 *
 * Directory nodes are skipped (the walk still recurses into them), so only
 * blob-level changes — including nested files and deletions — are reported.
 */
export async function diffCommitFiles(
	repo: RepoEntry,
	oldOid: string,
	newOid: string,
): Promise<WatchEvent[]> {
	const result = (await git.walk({
		fs: repo.fs,
		dir: repo.cloneDir,
		trees: [TREE({ ref: oldOid }), TREE({ ref: newOid })],
		map: async (filepath, entries) => {
			if (filepath === '.') return undefined;
			const change = await classifyBlobChange(entries[0], entries[1]);
			return change ? { type: change, path: filepath } : undefined;
		},
	})) as (WatchEvent | undefined)[];
	return result.filter((e): e is WatchEvent => e !== undefined);
}

/** The blob oid for a walk entry, or `undefined` if absent or a directory. */
async function blobOid(
	entry: WalkerEntry | null | undefined,
): Promise<string | undefined> {
	if (!entry) return undefined;
	const type = await entry.type();
	if (type !== 'blob') return undefined;
	return entry.oid();
}

/** Classify a before/after walk pair as a create/delete/modify, or null. */
async function classifyBlobChange(
	before: WalkerEntry | null | undefined,
	after: WalkerEntry | null | undefined,
): Promise<WatchEvent['type'] | null> {
	const beforeOid = await blobOid(before);
	const afterOid = await blobOid(after);
	if (beforeOid === afterOid) return null;
	if (beforeOid === undefined) return 'create';
	if (afterOid === undefined) return 'delete';
	return 'modify';
}
