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
