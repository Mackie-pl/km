import { invoke } from '@tauri-apps/api/core';
import {
	readTextFile,
	writeTextFile,
	readDir,
	remove,
	mkdir,
	rename,
} from '@tauri-apps/plugin-fs';
import type {
	WorkspacePickResult,
	Adapter,
	FileEntry,
} from '../adapter.interface';

interface TauriWorkspacePickResult {
	path: string;
}

type WindowWithTauri = Window & {
	__TAURI_INTERNALS__?: unknown;
};

const isTauriRuntimeAvailable = (): boolean => {
	return (
		typeof window !== 'undefined' &&
		(window as WindowWithTauri).__TAURI_INTERNALS__ != null
	);
};

/**
 * Resolve a relative path against a root directory.
 * Normalizes backslashes to forward slashes on Windows.
 * Handles leading/trailing slashes and returns a clean absolute path.
 *
 * TypeScript analogy: `path.join(root, relPath)` but for forward-slash paths.
 *
 * @example resolve('/home/user/vault', 'notes/ideas.md') → '/home/user/vault/notes/ideas.md'
 * @example resolve('/home/user/vault', '/notes/ideas.md') → '/home/user/vault/notes/ideas.md'
 * @example resolve('C:/Users/me/vault', 'notes/ideas.md') → 'C:/Users/me/vault/notes/ideas.md'
 */
function resolvePath(root: string | undefined, path: string): string {
	// Normalize all backslashes to forward slashes so the resolved path
	// has consistent separators regardless of OS. Tauri's FS scope check
	// compares paths literally — mixed separators cause scope mismatches
	// and "failed to get metadata" errors on Windows (#153203830).
	const normalizedRoot = (root ?? '').replace(/\\/g, '/');
	const normalizedPath = path.replace(/\\/g, '/');
	if (!normalizedRoot) return normalizedPath.replace(/^\/+/, '');
	const cleanRoot = normalizedRoot.replace(/\/+$/, '');
	const cleanPath = normalizedPath.replace(/^\/+/, '');
	return `${cleanRoot}/${cleanPath}`;
}

export class TauriFsAdapter implements Adapter {
	readonly id = 'tauri-fs';
	readonly isLocal = true;

	isAvailable(): boolean {
		return isTauriRuntimeAvailable();
	}

	async pickWorkspaceFolder(): Promise<WorkspacePickResult | null> {
		if (!this.isAvailable()) {
			return null;
		}

		const result = await invoke<TauriWorkspacePickResult | null>(
			'pick_workspace_folder',
		);
		if (!result) {
			return null;
		}

		const pathParts = result.path.split(/[\\/]/);
		const name = pathParts[pathParts.length - 1] ?? 'Workspace';

		return {
			// Normalize backslashes to forward slashes so path joining in
			// resolvePath() produces consistent separators. Tauri's FS scope
			// check compares paths literally — mixed separators cause a
			// scope mismatch and "failed to get metadata" errors on Windows.
			path: result.path.replace(/\\/g, '/'),
			name,
		};
	}

	async read(path: string, root?: string): Promise<string> {
		const resolved = resolvePath(root, path);
		return readTextFile(resolved);
	}

	async write(path: string, content: string, root?: string): Promise<void> {
		const resolved = resolvePath(root, path);
		// Create parent directories if they don't exist yet.
		// `resolvePath` already cleans slashes, so we can split on '/'.
		const parent = resolved.split('/').slice(0, -1).join('/');
		await mkdir(parent, { recursive: true });
		await writeTextFile(resolved, content);
	}

	async delete(path: string, root?: string): Promise<void> {
		const resolved = resolvePath(root, path);
		try {
			await remove(resolved, { recursive: true });
		} catch (err) {
			// If the file doesn't exist, the delete is already successful.
			// Tauri's `remove` calls `symlink_metadata` which throws ENOENT
			// when the file is missing (e.g. never written, externally deleted,
			// or already cleaned up by a previous cycle).
			const msg =
				typeof err === 'string'
					? err
					: err instanceof Error
						? err.message
						: '';
			if (
				msg.includes('os error 2') ||
				msg.includes('ENOENT') ||
				msg.includes('cannot find the path') ||
				msg.includes('Nie można odnaleźć')
			) {
				return; // File already gone → success
			}
			throw err;
		}
	}

	async rename(
		oldPath: string,
		newPath: string,
		root?: string,
	): Promise<void> {
		const resolvedOld = resolvePath(root, oldPath);
		const resolvedNew = resolvePath(root, newPath);
		await rename(resolvedOld, resolvedNew);
	}

	async list(
		path: string,
		root?: string,
		recursive?: boolean,
	): Promise<FileEntry[]> {
		const resolved = resolvePath(root, path);
		const entries = await readDir(resolved);

		const result: FileEntry[] = [];

		for (const e of entries) {
			const fullPath =
				path === '/' || path === ''
					? e.name
					: `${path.replace(/\/+$/, '')}/${e.name}`;
			result.push({
				path: fullPath,
				name: e.name,
				isDirectory: e.isDirectory,
				lastModified: 0,
			});

			// Recurse into subdirectories
			// TODO: if profiling shows IPC overhead from per-subdirectory readDir calls,
			// replace with a single native Rust walkdir command that returns all entries at once.
			if (recursive && e.isDirectory && !e.isSymlink) {
				await this.listRecursive(fullPath, root, result);
			}
		}

		return result;
	}

	/**
	 * Recursive helper for list(). Walks a subdirectory and adds all entries
	 * to the shared result array.
	 *
	 * Uses `isSymlink` on DirEntry to prevent descending into symlinks
	 * (which could introduce cycles). The `visited` set tracks resolved
	 * paths as an additional safety net for edge cases where the same
	 * directory is reachable through multiple non-symlink paths
	 * (e.g. hard-linked parent directories on some filesystems).
	 *
	 * TODO: if profiling shows IPC overhead from per-subdirectory readDir calls,
	 * replace with a single native Rust walkdir command that returns all entries at once.
	 */
	private async listRecursive(
		dirPath: string,
		root: string | undefined,
		result: FileEntry[],
		visited = new Set<string>(),
	): Promise<void> {
		const resolved = resolvePath(root, dirPath);

		// Use the resolved absolute path as a visited key for cycle detection.
		// This catches the same directory being reachable via multiple paths
		// (e.g. hard-linked directories). Symlinks are already filtered by
		// `isSymlink` in the caller, so this is an additional safety net.
		if (visited.has(resolved)) {
			console.warn(
				`[TauriFsAdapter] Skipping already-visited directory: "${dirPath}" (resolved: "${resolved}")`,
			);
			return;
		}
		visited.add(resolved);

		let children;
		try {
			children = await readDir(resolved);
		} catch (err) {
			// Permission denied or other error — skip this subtree
			console.warn(
				`[TauriFsAdapter] Skipping unreadable directory: "${dirPath}"`,
				err,
			);
			return;
		}

		for (const e of children) {
			const fullPath =
				dirPath === '/' || dirPath === ''
					? e.name
					: `${dirPath.replace(/\/+$/, '')}/${e.name}`;
			result.push({
				path: fullPath,
				name: e.name,
				isDirectory: e.isDirectory,
				lastModified: 0,
			});

			if (e.isDirectory && !e.isSymlink) {
				await this.listRecursive(fullPath, root, result, visited);
			}
		}
	}

	/** Create a directory (and all parents) on the filesystem. */
	async createDir(path: string, root?: string): Promise<void> {
		const resolved = resolvePath(root, path);
		await mkdir(resolved, { recursive: true });
	}

	/**
	 * Register a root path with Tauri's FS scope so read/write operations
	 * are allowed. Must be called for every workspace root path on app start
	 * (since FS scope registration doesn't survive restarts).
	 */
	async registerScope(root: string): Promise<void> {
		await invoke('register_fs_scope', {
			// Normalize backslashes so the scope is registered with forward
			// slashes, matching what resolvePath() produces. Tauri's FS scope
			// check compares paths literally; separator inconsistency causes
			// "failed to get metadata" errors on Windows.
			path: root.replace(/\\/g, '/'),
		});
	}
}
