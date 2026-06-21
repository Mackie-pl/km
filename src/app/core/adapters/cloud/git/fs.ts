/**
 * Git adapter filesystem backend factory.
 *
 * Creates a LightningFS-backed filesystem for use with isomorphic-git.
 * This implementation works in both Node (Vitest) and browser environments
 * since LightningFS is pure JavaScript with IndexedDB or in-memory storage.
 */

import type { GitFsBackend } from './types';
import LightningFS from '@isomorphic-git/lightning-fs';
import { repoUrlToDir } from './helpers';

// Cache of LightningFS instances keyed by root/clone directory path.
// Each root (repo URL → hashed directory) gets its own FS namespace.
const fsCache = new Map<string, LightningFS>();

/**
 * Create (or reuse) a LightningFS backend for a given clone directory.
 *
 * @param cloneDir — The local directory path for the cloned repository.
 * @returns A filesystem backend satisfying isomorphic-git's fs interface.
 */
export async function createGitFsBackend(
	cloneDir: string,
): Promise<GitFsBackend> {
	// Use the cloneDir as the IndexedDB store name (sanitized).
	const dbName = sanitizeDbName(cloneDir);

	let fs = fsCache.get(dbName);
	if (!fs) {
		fs = new LightningFS(dbName);
		fsCache.set(dbName, fs);
	}

	// LightningFS PromisifiedFS already satisfies GitFsBackend's interface
	const promises = fs.promises as unknown as GitFsBackend['promises'];

	// Ensure the root directory exists
	await promises
		.mkdir(cloneDir, { recursive: true })
		.catch((_err: unknown) => {
			/* dir may already exist */
		});

	return { promises };
}

/**
 * Delete the IndexedDB database used by LightningFS for a given clone directory.
 * Also removes the cached LightningFS instance.
 *
 * Best-effort — failures are logged but not thrown, making this safe to call
 * during workspace cleanup where the DB may already be gone.
 */
export async function destroyGitFsBackend(cloneDir: string): Promise<void> {
	const dbName = sanitizeDbName(cloneDir);
	fsCache.delete(dbName);
	await deleteIndexedDb(dbName);
}

/**
 * Compute the LightningFS clone directory path from a repo URL.
 * Must stay in sync with the logic inside `GitAdapter.ensureRepo()`.
 */
export function repoUrlToCloneDir(repoUrl: string): string {
	return `/__git_${repoUrlToDir(repoUrl)}`;
}

/**
 * Delete an IndexedDB database by name.
 * Resolves even on failure — intended for best-effort cleanup.
 */
async function deleteIndexedDb(dbName: string): Promise<void> {
	return new Promise<void>((resolve) => {
		const req = indexedDB.deleteDatabase(dbName);
		req.onsuccess = () => resolve();
		req.onerror = () => {
			console.warn(
				`destroyGitFsBackend: failed to delete IndexedDB "${dbName}"`,
			);
			resolve();
		};
		req.onblocked = () => {
			console.warn(
				`destroyGitFsBackend: deleteDatabase blocked for "${dbName}"`,
			);
			resolve();
		};
	});
}

/**
 * Convert an arbitrary path into a safe IndexedDB database name.
 * Strips non-alphanumeric characters (except hyphens and underscores).
 */
function sanitizeDbName(path: string): string {
	return path.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
}
