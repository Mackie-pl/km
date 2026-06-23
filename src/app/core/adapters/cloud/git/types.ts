/**
 * Thrown by the push path when the remote branch has diverged and the adapter
 * has reset the local clone to the remote tip (reconciling remote changes into
 * the vault). It is a recoverable signal — not a hard failure: the affected
 * entry stays pending and re-pushes cleanly on top of the reset branch.
 */
export class GitDivergenceError extends Error {
	readonly code = 'GitDivergenceError';
	constructor(branch: string) {
		super(
			`Remote branch "${branch}" diverged — reconciled remote changes locally, re-syncing`,
		);
		this.name = 'GitDivergenceError';
	}
}

/**
 * Git clone state enum — tracks the lifecycle of a repository clone.
 */
export enum GitCloneState {
	NOT_CLONED = 'NOT_CLONED',
	CLONING = 'CLONING',
	READY = 'READY',
	ERROR = 'ERROR',
}

/**
 * Git authentication credentials.
 */
export interface GitAuth {
	/** Personal Access Token or password */
	token: string;
	/** Optional username (defaults to 'token' for most git hosts) */
	username?: string;
}

/**
 * Filesystem backend interface that satisfies isomorphic-git's fs expectations.
 *
 * isomorphic-git expects an object with `promises` containing:
 * - readFile(path, encoding?)
 * - writeFile(path, content)
 * - mkdir(path, { recursive? })
 * - readdir(path)
 * - unlink(path)
 * - rename(from, to)
 * - stat(path) — returns { size, isDirectory() }
 */
export interface GitFsBackend {
	promises: {
		readFile(path: string, encoding?: string): Promise<string | Uint8Array>;
		writeFile(path: string, content: string | Uint8Array): Promise<void>;
		mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
		rmdir(path: string): Promise<void>;
		readdir(path: string): Promise<string[]>;
		unlink(path: string): Promise<void>;
		rename(oldPath: string, newPath: string): Promise<void>;
		stat(
			path: string,
		): Promise<{
			size: number;
			isDirectory: () => boolean;
			isFile: () => boolean;
		}>;
		lstat(
			path: string,
		): Promise<{
			size: number;
			isDirectory: () => boolean;
			isFile: () => boolean;
		}>;
	};
}

/**
 * Error information surfaced when a git clone fails.
 */
export interface GitCloneError {
	message: string;
	repoUrl: string;
	timestamp: number;
}

/**
 * In-memory record for a single managed repository clone.
 * Keyed by repo URL inside the adapter's `repos` map.
 */
export interface RepoEntry {
	cloneDir: string;
	fs: GitFsBackend;
	state: GitCloneState;
	error: string | null;
	branch: string;
	authorName: string;
	authorEmail: string;
	/**
	 * Serializes commit+push for this repo. Each `commitAndPush` chains onto
	 * this tail so two concurrent writes can't read the same HEAD as their
	 * parent and diverge into a branch the remote rejects as non-fast-forward.
	 * Always kept non-rejecting so one failure doesn't break the chain.
	 */
	commitLock: Promise<unknown>;
}
