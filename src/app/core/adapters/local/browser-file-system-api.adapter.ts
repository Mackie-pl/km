import type {
	WorkspacePickResult,
	Adapter,
	FileEntry,
} from '../adapter.interface';
import { HandleStore } from './handle-store';

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
 * Local extension of FileSystemDirectoryHandle to include the `entries()` method
 * and permission methods not yet in TypeScript's DOM lib.
 */
interface FileSystemDirectoryHandleWithEntries extends Omit<
	FileSystemDirectoryHandle,
	'entries'
> {
	entries(): AsyncIterableIterator<
		[string, FileSystemDirectoryHandle | FileSystemFileHandle]
	>;
	queryPermission(descriptor?: {
		mode?: 'read' | 'readwrite';
	}): Promise<'granted' | 'denied' | 'prompt'>;
	requestPermission(descriptor?: {
		mode?: 'read' | 'readwrite';
	}): Promise<'granted' | 'denied' | 'prompt'>;
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

	/** Persisted handle store (IndexedDB — survives page reload). */
	private readonly handleStore = new HandleStore();

	/**
	 * In-memory registry mapping root identifiers → directory handles.
	 *
	 * Roots are strings like `"browser:MyFolder"` set by `pickWorkspaceFolder()`.
	 * Handles are also persisted to IndexedDB via handleStore so they survive
	 * page reload. On reload, restoreHandles() pre-populates this map;
	 * resolveRoot() falls back to IndexedDB if not found in memory.
	 *
	 * TypeScript analogy: `Map<string, FileHandle>` — a simple key-value store
	 * for directory permissions.
	 */
	private readonly handleRegistry = new Map<
		string,
		FileSystemDirectoryHandle
	>();

	constructor() {
		// Fire-and-forget: pre-populate in-memory registry from IndexedDB.
		// resolveRoot() has its own IDB fallback if this hasn't completed yet.
		void this.restoreHandles();
	}

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

			// Store the handle in memory + IndexedDB so it survives reload
			this.handleRegistry.set(root, dirHandle);
			await this.handleStore.set(root, dirHandle);

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
			// recursive: true handles both files and non-empty directories
			await parentDir.removeEntry(name, { recursive: true });
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

	async rename(
		oldPath: string,
		newPath: string,
		root?: string,
	): Promise<void> {
		const dir = await this.resolveRoot(root);
		const { parent: oldParent, name: oldName } = splitPath(oldPath);
		const { parent: newParent, name: newName } = splitPath(newPath);

		const oldDir =
			oldParent === '/' ? dir : await resolveDir(dir, oldParent);
		const newDir =
			newParent === '/' ? dir : await resolveDir(dir, newParent);

		// Check if old entry is a directory
		const oldDirHandle = await oldDir
			.getDirectoryHandle(oldName)
			.catch(() => null);
		if (oldDirHandle) {
			// Directory rename: create target dir, recursively copy, remove old
			const targetDir = await newDir.getDirectoryHandle(newName, {
				create: true,
			});
			await BrowserFileSystemApiAdapter.copyDirectoryContents(
				oldDirHandle,
				targetDir,
			);
			await oldDir.removeEntry(oldName, { recursive: true });
			return;
		}

		// File rename (existing logic)
		const oldHandle = await oldDir.getFileHandle(oldName);
		const oldFile = await oldHandle.getFile();
		const content = await oldFile.text();

		const newHandle = await newDir.getFileHandle(newName, {
			create: true,
		});
		const writable = await newHandle.createWritable();
		await writable.write(content);
		await writable.close();

		await oldDir.removeEntry(oldName);
	}

	/** Create a directory (and all parents). */
	async createDir(path: string, root?: string): Promise<void> {
		const dir = await this.resolveRoot(root);
		const clean = path
			.replace(/^\/+|\/+$/g, '')
			.split('/')
			.filter(Boolean);
		let current = dir;
		for (const segment of clean) {
			current = await current.getDirectoryHandle(segment, {
				create: true,
			});
		}
	}

	/**
	 * Recursively copy all entries from src directory to dest directory.
	 * Used by rename() for directory moves since FileSystemHandle.move()
	 * is not supported for directories outside OPFS.
	 */
	private static async copyDirectoryContents(
		src: FileSystemDirectoryHandle,
		dest: FileSystemDirectoryHandle,
	): Promise<void> {
		for await (const [name, handle] of (
			src as FileSystemDirectoryHandleWithEntries
		).entries()) {
			if (handle.kind === 'directory') {
				const subDest = await dest.getDirectoryHandle(name, {
					create: true,
				});
				const subSrc = await src.getDirectoryHandle(name);
				await BrowserFileSystemApiAdapter.copyDirectoryContents(
					subSrc,
					subDest,
				);
			} else {
				const fileHandle = await src.getFileHandle(name);
				const file = await fileHandle.getFile();
				const content = await file.text();
				const newFile = await dest.getFileHandle(name, {
					create: true,
				});
				const writable = await newFile.createWritable();
				await writable.write(content);
				await writable.close();
			}
		}
	}

	async list(
		path: string,
		root?: string,
		recursive?: boolean,
	): Promise<FileEntry[]> {
		const dir = await this.resolveRoot(root);
		const targetDir =
			path === '/' || path === '' ? dir : await resolveDir(dir, path);

		const result: FileEntry[] = [];
		await this.listDirEntries(targetDir, path, result, recursive);
		return result;
	}

	/**
	 * Walk a single directory handle and optionally recurse into subdirectories.
	 * This is shared between list() and the recursive path to avoid return-value
	 * serialisation overhead.
	 *
	 * TypeScript analogy: fs.readdir() with a recursive option, but for the
	 * File System Access API's async-iterable handle interface.
	 */
	private async listDirEntries(
		dirHandle: FileSystemDirectoryHandle,
		currentPath: string,
		result: FileEntry[],
		recursive?: boolean,
	): Promise<void> {
		for await (const [name, handle] of (
			dirHandle as FileSystemDirectoryHandleWithEntries
		).entries()) {
			const fullPath =
				currentPath === '/' || currentPath === ''
					? name
					: `${currentPath.replace(/\/+$/, '')}/${name}`;
			result.push({
				name,
				path: fullPath,
				isDirectory: handle.kind === 'directory',
				lastModified: 0,
			});

			if (recursive && handle.kind === 'directory') {
				try {
					const subHandle = await dirHandle.getDirectoryHandle(name);
					await this.listDirEntries(
						subHandle,
						fullPath,
						result,
						recursive,
					);
				} catch (err) {
					// Permission denied or other error — skip this subtree
					console.warn(
						`[BrowserFsAdapter] Skipping unreadable directory: "${fullPath}"`,
						err,
					);
				}
			}
		}
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
	 *
	 * Resolution order:
	 *   1. In-memory registry (fast path)
	 *   2. IndexedDB fallback (survives page reload)
	 *   3. If found in IDB, lazily checks & re-requests permission
	 *   4. If not found anywhere, throws
	 *
	 * Note: `requestPermission()` outside a user gesture returns `'denied'`
	 * without showing a dialog. That's fine — the sync engine's catch block
	 * handles it gracefully, and the user can click the sync button later
	 * (which IS gesture-triggered) to re-grant permission.
	 */
	private async resolveRoot(
		root?: string,
	): Promise<FileSystemDirectoryHandle> {
		if (!root)
			throw new Error(
				'BrowserFsAdapter: root is required (no workspace folder picked?)',
			);

		// 1. Fast path: already in memory
		let handle = this.handleRegistry.get(root);
		if (handle) return handle;

		// 2. Fallback: try IndexedDB
		handle = await this.handleStore.get(root);
		if (!handle)
			throw new Error(
				`BrowserFsAdapter: no handle for root "${root}". Pick a folder first.`,
			);

		// Cast to extended interface for permission methods not yet in DOM lib
		const handleWithPerms = handle as FileSystemDirectoryHandleWithEntries;

		// 3. Lazy permission check — prompts only when user does actual file I/O
		const permission = await handleWithPerms.queryPermission({
			mode: 'readwrite',
		});
		if (permission !== 'granted') {
			const result = await handleWithPerms.requestPermission({
				mode: 'readwrite',
			});
			if (result !== 'granted') {
				throw new Error(
					`BrowserFsAdapter: permission denied for root "${root}". Click sync to re-grant access.`,
				);
			}
		}

		// 4. Cache in memory for subsequent calls
		this.handleRegistry.set(root, handle);
		return handle;
	}

	/**
	 * Explicitly check and (if needed) request read/write permission for a root.
	 *
	 * Call this from UI handlers that have a user gesture context
	 * (button clicks, menu items) so the browser can show the permission prompt.
	 *
	 * @returns true if permission is granted
	 */
	async ensurePermission(root: string): Promise<boolean> {
		try {
			const handle = await this.resolveRoot(root);
			const handleWithPerms =
				handle as FileSystemDirectoryHandleWithEntries;
			const perm = await handleWithPerms.queryPermission({
				mode: 'readwrite',
			});
			if (perm === 'granted') return true;
			const result = await handleWithPerms.requestPermission({
				mode: 'readwrite',
			});
			return result === 'granted';
		} catch {
			return false;
		}
	}

	/**
	 * Pre-populate the in-memory registry from IndexedDB.
	 * Called once in the constructor (fire-and-forget).
	 */
	private async restoreHandles(): Promise<void> {
		try {
			const keys = await this.handleStore.getAllKeys();
			for (const key of keys) {
				const handle = await this.handleStore.get(key);
				if (handle) {
					this.handleRegistry.set(key, handle);
				}
			}
		} catch {
			// IDB may fail (private browsing, quota). Handles will be re-picked.
		}
	}
}
