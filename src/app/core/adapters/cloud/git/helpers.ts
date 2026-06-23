/**
 * Pure utility helpers for the Git adapter.
 */

import type { FileEntry } from '../../adapter.interface';

export function repoUrlToDir(repoUrl: string): string {
	let hash = 0;
	for (let i = 0; i < repoUrl.length; i++) {
		const char = repoUrl.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash |= 0;
	}
	return `repo_${Math.abs(hash).toString(36)}`;
}

export function resolvePath(cloneDir: string, path: string): string {
	const clean = path.replace(/^\//, '');
	return `${cloneDir}/${clean}`;
}

export function relativePath(path: string): string {
	return path.replace(/^\//, '');
}

export function errMsg(err: unknown, defaultMsg: string): string {
	return err instanceof Error ? err.message : defaultMsg;
}

/** Short SHA for debug logs, or an em dash when the ref is absent. */
export function shortSha(sha: string | null): string {
	return sha ? sha.slice(0, 8) : '—';
}

export function assertRoot(root: string | undefined): string {
	if (!root) throw new Error('GitAdapter: root (repo URL) is required');
	return root;
}

/** Group a flat file list into a single directory level (non-recursive list). */
export function groupNonRecursiveEntries(
	files: string[],
	prefix: string,
): FileEntry[] {
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
