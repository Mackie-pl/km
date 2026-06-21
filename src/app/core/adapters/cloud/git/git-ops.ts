/**
 * Low-level isomorphic-git wrappers for the Git adapter.
 *
 * These are stateless primitives over a {@link RepoEntry} (they only read
 * `fs`/`cloneDir`/`branch`). Authentication is passed in as a token — this
 * layer never touches the token store. Higher layers (repo-manager, adapter)
 * resolve the token and decide what to log; git-ops just talks to the remote.
 */

import type { RepoEntry } from './types';
import git from 'isomorphic-git';
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

/** Resolve a ref to its SHA, or `null` if it does not exist. */
export async function resolveRefSafe(
	repo: RepoEntry,
	ref: string,
): Promise<string | null> {
	return git
		.resolveRef({ fs: repo.fs, dir: repo.cloneDir, ref })
		.catch(() => null);
}
