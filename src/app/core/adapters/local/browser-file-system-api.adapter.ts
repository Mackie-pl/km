import type {
	WorkspacePickResult,
	Adapter,
	FileEntry,
} from '../adapter.interface';

type WindowWithDirectoryPicker = Window & {
	showDirectoryPicker: (options?: {
		mode?: 'read' | 'readwrite';
	}) => Promise<FileSystemDirectoryHandle>;
};

const isShowDirectoryPickerSupported = (
	value: unknown,
): value is WindowWithDirectoryPicker => {
	return (
		typeof value === 'object' &&
		value !== null &&
		'showDirectoryPicker' in value
	);
};

/**
 * Local extension of FileSystemDirectoryHandle to include the `entries()` method.
 * This is part of the File System Access API spec but not yet in TypeScript's DOM lib.
 */
interface FileSystemDirectoryHandleWithEntries extends FileSystemDirectoryHandle {
	entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

/**
 * Navigate from a root directory handle to a subdirectory.
 *
 * Splits the path on '/' and walks through each segment using
 * `getDirectoryHandle`. If any segment doesn't exist and `createMissing`
 * is true, it creates the directory.
 *
 * TypeScript analogy: `cd path/to/dir; mkdir -p some/nested/dir` but in the
 * File System Access API. Each segment is like a folder name.
 */
async function resolveDir(
	root: FileSystemDirectoryHandle,
	path: string,
	createMissing = false,
): Promise<FileSystemDirectoryHandle> {
	const segments = path
		.replace(/^\/+|\/+$/g, '')
		.split('/')
		.filter(Boolean);
	let current = root;

	for (const segment of segments) {
		try {
			current = await current.getDirectoryHandle(segment, {
				create: createMissing,
			});
		} catch {
			throw new Error(
				`BrowserFsAdapter: directory not found: "${path}" (segment: "${segment}")`,
			);
		}
	}

	return current;
}

/**
 * Split a file path into parent directory path and filename.
 *
 * @example splitPath('notes/ideas.md') → { parent: 'notes', name: 'ideas.md' }
 * @example splitPath('root.md') → { parent: '/', name: 'root.md' }
 */
function splitPath(filePath: string): { parent: string; name: string } {
	const clean = filePath.replace(/^\/+/, '');
	const lastSlash = clean.lastIndexOf('/');
	if (lastSlash === -1) return { parent: '/', name: clean };
	return {
		parent: '/' + clean.slice(0, lastSlash),
		name: clean.slice(lastSlash + 1),
	};
}

export class BrowserFileSystemApiAdapter implements Adapter {
	readonly id = 'browser-file-system-api';
	readonly isLocal = true;

	/**
	 * In-memory registry mapping root identifiers → directory handles.
	 *
	 * Roots are strings like `"browser:MyFolder"` set by `pickWorkspaceFolder()`.
	 * On page reload, these handles are lost (user must re-pick).
	 *
	 * TypeScript analogy: `Map<string, FileHandle>` — a simple key-value store
	 * for directory permissions.
	 */
	private readonly handleRegistry = new Map<
		string,
		FileSystemDirectoryHandle
	>();

	isAvailable(): boolean {
		return isShowDirectoryPickerSupported(window);
	}

	async pickWorkspaceFolder(): Promise<WorkspacePickResult | null> {
		if (!isShowDirectoryPickerSupported(window)) {
			return null;
		}

		try {
			const dirHandle = await window.showDirectoryPicker({
				mode: 'readwrite',
			});
			const name = dirHandle.name || 'Workspace';
			const root = `browser:${name}`;

			// Store the handle so subsequent read/write/list calls can find it
			this.handleRegistry.set(root, dirHandle);

			return { path: root, name };
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				return null; // User cancelled the picker
			}
			throw error;
		}
	}

	async read(path: string, root?: string): Promise<string> {
		const dir = await this.resolveRoot(root);
		const { parent, name } = splitPath(path);
		const parentDir = parent === '/' ? dir : await resolveDir(dir, parent);
		const fileHandle = await parentDir.getFileHandle(name);
		const file = await fileHandle.getFile();
		return file.text();
	}

	async write(path: string, content: string, root?: string): Promise<void> {
		const dir = await this.resolveRoot(root);
		const { parent, name } = splitPath(path);

		// Create parent directories if needed
		const parentDir =
			parent === '/' ? dir : await resolveDir(dir, parent, true);

		const fileHandle = await parentDir.getFileHandle(name, {
			create: true,
		});
		const writable = await fileHandle.createWritable();
		await writable.write(content);
		await writable.close();
	}

	async delete(path: string, root?: string): Promise<void> {
		const dir = await this.resolveRoot(root);
		const { parent, name } = splitPath(path);
		const parentDir = parent === '/' ? dir : await resolveDir(dir, parent);

		try {
			await parentDir.removeEntry(name);
		} catch (error) {
			// Silently ignore if the file doesn't exist
			if (
				!(error instanceof DOMException) ||
				error.name !== 'NotFoundError'
			) {
				throw error;
			}
		}
	}

	async list(path: string, root?: string): Promise<FileEntry[]> {
		const dir = await this.resolveRoot(root);
		const targetDir =
			path === '/' || path === '' ? dir : await resolveDir(dir, path);

		const result: FileEntry[] = [];
		for await (const [name, handle] of (
			targetDir as FileSystemDirectoryHandleWithEntries
		).entries()) {
			result.push({
				name,
				path:
					path === '/' ? name : `${path.replace(/\/+$/, '')}/${name}`,
				isDirectory: handle.kind === 'directory',
				lastModified: 0,
			});
		}
		return result;
	}

	// ──────────────────────────────────────────────
	// Internal helpers
	// ──────────────────────────────────────────────

	/**
	 * Look up the directory handle for a given root identifier.
	 *
	 * Each workspace created via the browser picker gets a root like
	 * `"browser:MyFolder"`. This method finds the stored handle so
	 * file operations know which directory to work in.
	 */
	private resolveRoot(root?: string): Promise<FileSystemDirectoryHandle> {
		if (!root)
			throw new Error(
				'BrowserFsAdapter: root is required (no workspace folder picked?)',
			);
		const handle = this.handleRegistry.get(root);
		if (!handle)
			throw new Error(
				`BrowserFsAdapter: no handle for root "${root}". Pick a folder first.`,
			);
		return Promise.resolve(handle);
	}
}
