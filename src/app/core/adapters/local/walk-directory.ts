import { readDir } from '@tauri-apps/plugin-fs';
import { isTempFilePath } from '@core/utils/file-patterns';
import type { FileEntry } from '../adapter.interface';

/**
 * Resolve a relative path against a root directory.
 * Normalizes backslashes to forward slashes on Windows.
 * Handles leading/trailing slashes and returns a clean absolute path.
 */
export function resolvePath(root: string | undefined, path: string): string {
	const normalizedRoot = (root ?? '').replace(/\\/g, '/');
	const normalizedPath = path.replace(/\\/g, '/');
	if (!normalizedRoot) return normalizedPath.replace(/^\/+/, '');
	const cleanRoot = normalizedRoot.replace(/\/+$/, '');
	const cleanPath = normalizedPath.replace(/^\/+/, '');
	return `${cleanRoot}/${cleanPath}`;
}

/** Join a child name onto a directory path, normalizing the root case. */
function joinChildPath(dirPath: string, name: string): string {
	if (dirPath === '/' || dirPath === '') return name;
	return `${dirPath.replace(/\/+$/, '')}/${name}`;
}

/**
 * Recursively walk a directory and return all entries (files + folders).
 *
 * - Skips symlinks to prevent cycles.
 * - Uses a `visited` set on resolved absolute paths as an additional
 *   safety net for hard-linked directories reachable through multiple paths.
 * - Skips unreadable subtrees (permission denied, etc.) with a warning.
 *
 * TODO: if profiling shows IPC overhead from per-subdirectory readDir calls,
 * replace with a single native Rust walkdir command that returns all entries at once.
 */
export async function walkDirectory(
	dirPath: string,
	root: string | undefined,
	visited = new Set<string>(),
): Promise<FileEntry[]> {
	const resolved = resolvePath(root, dirPath);

	if (visited.has(resolved)) {
		console.warn(
			`[walkDirectory] Skipping already-visited directory: "${dirPath}" (resolved: "${resolved}")`,
		);
		return [];
	}
	visited.add(resolved);

	let children;
	try {
		children = await readDir(resolved);
	} catch (err) {
		console.warn(
			`[walkDirectory] Skipping unreadable directory: "${dirPath}"`,
			err,
		);
		return [];
	}

	const result: FileEntry[] = [];

	for (const e of children) {
		// Skip temp/swap files created by external editors during atomic saves.
		if (isTempFilePath(e.name)) continue;

		const fullPath = joinChildPath(dirPath, e.name);
		result.push({
			path: fullPath,
			name: e.name,
			isDirectory: e.isDirectory,
			lastModified: 0,
		});

		if (e.isDirectory && !e.isSymlink) {
			const sub = await walkDirectory(fullPath, root, visited);
			result.push(...sub);
		}
	}

	return result;
}
