/**
 * Pure utility helpers for the Git adapter.
 */

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

export function assertRoot(root: string | undefined): string {
	if (!root) throw new Error('GitAdapter: root (repo URL) is required');
	return root;
}
