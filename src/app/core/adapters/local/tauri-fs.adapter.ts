import { invoke } from '@tauri-apps/api/core';
import {
	readTextFile,
	writeTextFile,
	readDir,
	remove,
	mkdir,
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
	__TAURI__?: unknown;
};

const isTauriRuntimeAvailable = (): boolean => {
	return (
		typeof window !== 'undefined' &&
		(window as WindowWithTauri).__TAURI__ != null
	);
};

/**
 * Resolve a relative path against a root directory.
 * Handles leading/trailing slashes and returns a clean absolute path.
 *
 * TypeScript analogy: `path.join(root, relPath)` but for forward-slash paths.
 *
 * @example resolve('/home/user/vault', 'notes/ideas.md') → '/home/user/vault/notes/ideas.md'
 * @example resolve('/home/user/vault', '/notes/ideas.md') → '/home/user/vault/notes/ideas.md'
 */
function resolvePath(root: string | undefined, path: string): string {
	if (!root) return path.replace(/^\/+/, '');
	const cleanRoot = root.replace(/\/+$/, '');
	const cleanPath = path.replace(/^\/+/, '');
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
			path: result.path,
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
		await remove(resolved);
	}

	async list(path: string, root?: string): Promise<FileEntry[]> {
		const resolved = resolvePath(root, path);
		const entries = await readDir(resolved);
		return entries.map((e) => ({
			path: e.name,
			name: e.name,
			isDirectory: e.isDirectory,
			lastModified: 0,
		}));
	}
}
