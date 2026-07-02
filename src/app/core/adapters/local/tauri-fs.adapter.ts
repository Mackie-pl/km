import { invoke } from '@tauri-apps/api/core';
import {
	readTextFile,
	writeTextFile,
	readDir,
	remove,
	mkdir,
	rename,
	watchImmediate,
} from '@tauri-apps/plugin-fs';
import type {
	WorkspacePickResult,
	Adapter,
	FileEntry,
	WatchEvent,
} from '../adapter.interface';
import type {
	WatchEvent as TauriWatchEvent,
	WatchEventKindModify,
} from '@tauri-apps/plugin-fs';
import { isTempFilePath } from '@core/utils/file-patterns';
import { debugLog } from '@core/utils/debug-logger';
import { isTauriRuntime } from '@core/utils/tauri-runtime';
import { resolvePath, walkDirectory } from './walk-directory';

interface TauriWorkspacePickResult {
	path: string;
	/**
	 * Optional display name resolved by the Rust side. Present on Android,
	 * where `path` is an opaque content:// URI with no derivable folder name;
	 * absent on desktop, where the name is derived from the real path.
	 */
	name?: string;
}

/**
 * Detect a "file not found" error thrown by Tauri's `remove`, across
 * platforms/locales — `symlink_metadata` surfaces ENOENT (os error 2) as an
 * OS-localized message. Treated as a successful delete (the file is gone).
 */
function isFileNotFoundError(err: unknown): boolean {
	const msg =
		typeof err === 'string'
			? err
			: err instanceof Error
				? err.message
				: '';
	return (
		msg.includes('os error 2') ||
		msg.includes('ENOENT') ||
		msg.includes('cannot find the path') ||
		msg.includes('Nie można odnaleźć')
	);
}

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
export class TauriFsAdapter implements Adapter {
	readonly id = 'tauri-fs';
	readonly isLocal = true;

	/**
	 * Buffer for pairing rename-from → rename-to events from the Tauri watcher.
	 * The `notify` crate emits two separate events for a rename:
	 *   1. modify(rename, from) — old path
	 *   2. modify(rename, to)   — new path
	 * Without buffering, only the "to" event reaches the sync engine as
	 * a plain modify, creating a new vault entry while leaking the old one.
	 */
	#pendingRename: { oldPath: string; rootPath: string } | null = null;

	/** Logger shorthand — auto‑stringifies non‑strings, prepends tag. */
	#log(...args: unknown[]): void {
		const line = args
			.map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
			.join(' ');
		debugLog('[TauriFsAdapter]', line);
	}

	/**
	 * Cached Android check. On Android the workspace root is a SAF content://
	 * tree URI (serialized FileUri), so file I/O must go through the `saf_*`
	 * Rust commands rather than the path-based `@tauri-apps/plugin-fs` calls.
	 */
	#android: boolean | null = null;

	async #isAndroid(): Promise<boolean> {
		if (this.#android === null) {
			try {
				this.#android = (await invoke<string>('get_platform')) === 'android';
			} catch {
				this.#android = false;
			}
		}
		return this.#android;
	}

	isAvailable(): boolean {
		return isTauriRuntime();
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

		// Prefer the Rust-resolved display name (Android content:// URIs have
		// no derivable name); fall back to the last path segment on desktop.
		const pathParts = result.path.split(/[\\/]/);
		const name =
			result.name ?? pathParts[pathParts.length - 1] ?? 'Workspace';

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
		if (await this.#isAndroid()) {
			return invoke<string>('saf_read', { root: root ?? '', path });
		}
		const resolved = resolvePath(root, path);
		return readTextFile(resolved);
	}

	async write(path: string, content: string, root?: string): Promise<void> {
		if (await this.#isAndroid()) {
			await invoke('saf_write', { root: root ?? '', path, content });
			return;
		}
		const resolved = resolvePath(root, path);
		// Create parent directories if they don't exist yet.
		// `resolvePath` already cleans slashes, so we can split on '/'.
		const parent = resolved.split('/').slice(0, -1).join('/');
		await mkdir(parent, { recursive: true });
		await writeTextFile(resolved, content);
	}

	async delete(path: string, root?: string): Promise<void> {
		if (await this.#isAndroid()) {
			await invoke('saf_delete', { root: root ?? '', path });
			return;
		}
		const resolved = resolvePath(root, path);
		try {
			await remove(resolved, { recursive: true });
		} catch (err) {
			// If the file doesn't exist, the delete is already successful.
			// Tauri's `remove` calls `symlink_metadata` which throws ENOENT
			// when the file is missing (e.g. never written, externally deleted,
			// or already cleaned up by a previous cycle).
			if (isFileNotFoundError(err)) {
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
		if (await this.#isAndroid()) {
			await invoke('saf_rename', { root: root ?? '', oldPath, newPath });
			return;
		}
		const resolvedOld = resolvePath(root, oldPath);
		const resolvedNew = resolvePath(root, newPath);
		await rename(resolvedOld, resolvedNew);
	}

	async list(
		path: string,
		root?: string,
		recursive?: boolean,
	): Promise<FileEntry[]> {
		if (await this.#isAndroid()) {
			// SafEntry is already shaped as FileEntry (camelCase, paths relative
			// to root). The Rust command handles both recursive and flat listing.
			return invoke<FileEntry[]>('saf_list', {
				root: root ?? '',
				path,
				recursive: recursive ?? false,
			});
		}
		if (!recursive) {
			const resolved = resolvePath(root, path);
			const entries = await readDir(resolved);
			return entries.map((e) => ({
				path:
					path === '/' || path === ''
						? e.name
						: `${path.replace(/\/+$/, '')}/${e.name}`,
				name: e.name,
				isDirectory: e.isDirectory,
				lastModified: 0,
			}));
		}

		return walkDirectory(path, root);
	}

	/** Create a directory (and all parents) on the filesystem. */
	async createDir(path: string, root?: string): Promise<void> {
		if (await this.#isAndroid()) {
			await invoke('saf_create_dir', { root: root ?? '', path });
			return;
		}
		const resolved = resolvePath(root, path);
		await mkdir(resolved, { recursive: true });
	}

	/**
	 * Register a root path with Tauri's FS scope so read/write operations
	 * are allowed. Must be called for every workspace root path on app start
	 * (since FS scope registration doesn't survive restarts).
	 */
	async registerScope(root: string): Promise<void> {
		// On Android the SAF permission was persisted at folder-pick time and
		// survives restarts; there's no path-based FS scope to register.
		if (await this.#isAndroid()) {
			return;
		}
		await invoke('register_fs_scope', {
			// Normalize backslashes so the scope is registered with forward
			// slashes, matching what resolvePath() produces. Tauri's FS scope
			// check compares paths literally; separator inconsistency causes
			// "failed to get metadata" errors on Windows.
			path: root.replace(/\\/g, '/'),
		});
	}

	/**
	 * Verify access to a workspace root. On Android the SAF permission grant
	 * can be lost independently of the persisted workspace (reinstall, user
	 * revoking access in Settings, backup restore), so check the grant is
	 * still valid. On desktop the path-based FS scope is re-registered on
	 * activation, so access is always assumed OK.
	 */
	async verifyAccess(root: string): Promise<boolean> {
		if (!(await this.#isAndroid())) {
			return true;
		}
		try {
			return await invoke<boolean>('saf_check_permission', { root });
		} catch {
			// Treat a failed check as lost access — better to prompt a re-pick
			// than to let subsequent file I/O fail cryptically.
			return false;
		}
	}

	// ──────────────────────────────────────────────
	// File watching
	// ──────────────────────────────────────────────

	/**
	 * Subscribe to filesystem changes using Tauri's native file watcher.
	 *
	 * Uses `watchImmediate()` from `@tauri-apps/plugin-fs` which wraps
	 * Rust's `notify` crate under the hood — no polling, OS-level events.
	 *
	 * TypeScript analogy: Like `fs.watch()` in Node.js but backed by
	 * native kernel events (inotify on Linux, ReadDirectoryChanges on Windows).
	 *
	 * @param callback - Called with our flattened WatchEvent[] on each change
	 * @param root - Workspace root path (absolute filesystem path)
	 * @returns An unsubscribe function to stop watching
	 */
	async watch(
		callback: (events: WatchEvent[]) => void,
		root?: string,
	): Promise<() => void> {
		// SAF has no inotify-style change notifications, so there's nothing to
		// watch on Android — the sync engine falls back to manual/interval pulls.
		if (await this.#isAndroid()) {
			return () => undefined;
		}
		const resolvedPath = resolvePath(root ?? '', '');

		try {
			const unwatch = await watchImmediate(
				resolvedPath,
				(tauriEvent: TauriWatchEvent) => {
					this.#log('Raw event:', JSON.stringify(tauriEvent));
					const mapped = this.mapWatchEvent(tauriEvent, resolvedPath);
					this.#log('Mapped events:', JSON.stringify(mapped));
					if (mapped.length > 0) {
						callback(mapped);
					}
				},
				{ recursive: true },
			);
			return unwatch;
		} catch (err) {
			console.error(
				`[TauriFsAdapter] Failed to start watcher on "${resolvedPath}":`,
				err,
			);
			// Return no-op cleanup so the caller doesn't crash
			return () => undefined;
		}
	}

	/**
	 * Map a Tauri WatchEvent (discriminated union) to our flat WatchEvent[].
	 *
	 * Tauri events carry OS-level metadata (access, open, close, etc.) that
	 * we don't need. This narrows down to the subset that matters:
	 * file/folder create, content modify, delete, and rename.
	 *
	 * Rename events from the Tauri watcher arrive as two separate events:
	 * modify(rename, from) then modify(rename, to). The "from" is buffered
	 * in #pendingRename; when the matching "to" arrives, a single rename
	 * WatchEvent is emitted with both oldPath and path set.
	 */
	private mapWatchEvent(
		event: TauriWatchEvent,
		rootPath: string,
	): WatchEvent[] {
		const kind = event.type;

		// Skip high-level 'any' / 'other' events (open/close/access)
		if (kind === 'any' || kind === 'other') return [];
		if (typeof kind !== 'object') return [];

		if ('access' in kind) return [];

		const cleanPaths = this.#cleanEventPaths(event.paths);
		if (cleanPaths.length === 0) {
			this.#log('All paths filtered — dropping event');
			return [];
		}

		if ('create' in kind) {
			const mapped = cleanPaths.map((p) => ({
				type: 'create' as const,
				path: TauriFsAdapter.stripRoot(p, rootPath),
			}));
			this.#log(
				'Create event:',
				mapped.map((e) => e.path),
			);
			return mapped;
		}
		if ('modify' in kind) {
			return this.mapModifyEvent(kind.modify, cleanPaths, rootPath);
		}
		if ('remove' in kind) {
			const mapped = cleanPaths.map((p) => ({
				type: 'delete' as const,
				path: TauriFsAdapter.stripRoot(p, rootPath),
			}));
			this.#log(
				'Remove event:',
				mapped.map((e) => e.path),
			);
			return mapped;
		}
		this.#log('Unhandled event kind:', Object.keys(kind));
		return [];
	}

	/**
	 * Drop temp/swap-file paths created by external editors during atomic saves.
	 * These must not propagate to the sync engine (which would try to read them,
	 * fail, and potentially trigger content loss via delete+recreate sequences).
	 */
	#cleanEventPaths(paths: string[]): string[] {
		const cleanPaths = paths.filter((p) => !isTempFilePath(p));
		if (cleanPaths.length !== paths.length) {
			this.#log(
				'Filtered temp paths:',
				paths.filter((p) => isTempFilePath(p)),
			);
		}
		return cleanPaths;
	}

	/**
	 * Map a Tauri modify WatchEvent to our flat WatchEvent[].
	 * Extracted from mapWatchEvent to keep complexity under 10.
	 * Handles rename buffering to pair from→to events.
	 */
	private mapModifyEvent(
		modify: WatchEventKindModify,
		paths: string[],
		rootPath: string,
	): WatchEvent[] {
		// Skip metadata-only events
		if (modify.kind === 'metadata' || modify.kind === 'other') {
			this.#log(
				'Skip modify: kind=',
				modify.kind,
				'paths=',
				paths.map((p) => TauriFsAdapter.stripRoot(p, rootPath)),
			);
			return [];
		}

		// ── Rename handling ────────────────────────────
		if (modify.kind === 'rename') {
			return this.#mapRenameEvent(modify, paths, rootPath);
		}

		// Any non-rename modify: clear buffer (safety against orphaned from-events)
		this.#pendingRename = null;

		this.#log(
			'Content modify:',
			paths.map((p) => TauriFsAdapter.stripRoot(p, rootPath)),
		);
		return paths.map((p) => ({
			type: 'modify' as const,
			path: TauriFsAdapter.stripRoot(p, rootPath),
		}));
	}

	/**
	 * Map a rename event from the Tauri watcher.
	 * Complexity is inherent (3 modes: both/from/to with guards).
	 * Extracted from mapModifyEvent to keep that method under 10.
	 */
	#mapRenameEvent(
		modify: WatchEventKindModify & { kind: 'rename' },
		paths: string[],
		rootPath: string,
	): WatchEvent[] {
		// 'both': old and new path in one event (some platforms)
		if (modify.mode === 'both') {
			return this.#mapRenameBoth(paths, rootPath);
		}
		// 'from': buffer the old path for pairing
		if (modify.mode === 'from') {
			if (!paths[0]) return [];
			this.#log(
				'Rename FROM buffered:',
				TauriFsAdapter.stripRoot(paths[0], rootPath),
			);
			this.#pendingRename = { oldPath: paths[0], rootPath };
			return [];
		}
		// 'to': pair with buffered from
		if (modify.mode === 'to') {
			return this.#mapRenameTo(paths, rootPath);
		}
		return [];
	}

	/** Handle rename mode 'both' — old and new path in one event. */
	#mapRenameBoth(paths: string[], rootPath: string): WatchEvent[] {
		this.#pendingRename = null;
		if (paths.length < 2) {
			// Only one path survived temp-file filtering (e.g. a
			// .crswap→real-file rename). Emit modify so the sync
			// engine can coalesce it with any preceding delete.
			if (paths.length === 1 && paths[0]) {
				this.#log(
					'Rename BOTH (1 path, filtered) -> modify:',
					TauriFsAdapter.stripRoot(paths[0], rootPath),
				);
				return [
					{
						type: 'modify' as const,
						path: TauriFsAdapter.stripRoot(paths[0], rootPath),
					},
				];
			}
			return [];
		}
		const oldPath = paths[0];
		const newPath = paths[1];
		if (!oldPath || !newPath) return [];
		const mappedOld = TauriFsAdapter.stripRoot(oldPath, rootPath);
		const mappedNew = TauriFsAdapter.stripRoot(newPath, rootPath);
		this.#log('Rename BOTH:', mappedOld, '->', mappedNew);
		return [
			{
				type: 'rename' as const,
				path: mappedNew,
				oldPath: mappedOld,
			},
		];
	}

	/** Handle rename mode 'to' — pair with buffered 'from' event. */
	#mapRenameTo(paths: string[], rootPath: string): WatchEvent[] {
		const pending = this.#pendingRename;
		this.#pendingRename = null;
		if (!paths[0]) return [];
		const target = TauriFsAdapter.stripRoot(paths[0], rootPath);
		if (!pending) {
			// No buffered "from" path — the rename-from event was
			// filtered out (e.g. a temp-file path from an atomic
			// save, like .crswap). Emit a modify so the sync engine's
			// coalescer can merge this with any preceding delete for
			// the same path, keeping the vault entry alive.
			this.#log('Rename TO (no pending FROM) -> modify:', target);
			return [
				{
					type: 'modify' as const,
					path: target,
				},
			];
		}
		if (pending.rootPath !== rootPath) {
			this.#log('Rename TO root mismatch, dropping');
			return [];
		}
		const old = TauriFsAdapter.stripRoot(pending.oldPath, rootPath);
		this.#log('Rename TO paired with FROM:', old, '->', target);
		return [
			{
				type: 'rename' as const,
				path: target,
				oldPath: old,
			},
		];
	}

	/**
	 * Strip the root path prefix from an absolute path to get a vault-relative path.
	 *
	 * @example '/home/user/vault/notes/a.md' with root '/home/user/vault' → 'notes/a.md'
	 */
	private static stripRoot(path: string, rootPath: string): string {
		const normalized = path.replace(/\\/g, '/');
		const cleanRoot = rootPath.replace(/\/+$/, '');
		if (normalized.startsWith(cleanRoot + '/')) {
			return normalized.slice(cleanRoot.length + 1);
		}
		if (normalized === cleanRoot) return '';
		// Fallback: return as-is (shouldn't happen with proper roots)
		return normalized;
	}
}
