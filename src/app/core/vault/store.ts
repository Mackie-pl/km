import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { WorkspaceService } from '@core/services/workspace.service';
import {
	VAULT_ENTRY_TYPES,
	type VaultEntryType,
	type VaultEntry,
} from './vault-entry';
import { VaultDatabase } from './vault-database';
import { VaultReconciler } from './vault-reconciler';

// Re-exports for backward compat with imports from @vault/store
export {
	VAULT_ENTRY_TYPES,
	type VaultEntryType,
	type VaultEntry,
} from './vault-entry';

@Injectable({
	providedIn: 'root',
})
export class VaultStore {
	//
	// =========================
	// SIGNAL STATE
	// =========================
	//

	private readonly workspaceService = inject(WorkspaceService);

	///** Derived signal: the currently active workspace ID, or null if none. */
	readonly activeWorkspaceId = computed(
		() => this.workspaceService.activeWorkspace()?.id ?? null,
	);

	private entries = signal<Map<string, VaultEntry>>(new Map());

	private readonly reconciler = new VaultReconciler(this);

	/** Expose the entries signal snapshot for VaultReconciler. */
	getEntriesSnapshot(): Map<string, VaultEntry> {
		return this.entries();
	}

	/** Expose active sync adapter IDs for VaultReconciler. */
	getActiveSyncAdapters(): string[] {
		return (
			this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? []
		);
	}

	readonly files = computed(() =>
		Array.from(this.entries().values()).filter(
			(e) => e.type === VAULT_ENTRY_TYPES.FILE && !e.deleted,
		),
	);

	readonly folders = computed(() =>
		Array.from(this.entries().values()).filter(
			(e) => e.type === VAULT_ENTRY_TYPES.FOLDER && !e.deleted,
		),
	);

	/** Entries that still have at least one adapter pending sync. */
	readonly entriesNeedingSync = computed(() =>
		Array.from(this.entries().values()).filter(
			(e) => e.pendingAdapters.length > 0,
		),
	);

	//
	// =========================
	// DB
	// =========================
	//

	private readonly database = new VaultDatabase();
	private initPromise: Promise<void> | null = null;

	/**
	 * Incremented every time entries are loaded from IndexedDB.
	 * SyncEngineService watches this to know when the vault is ready
	 * after workspace activation or switch.
	 */
	readonly loadVersion = signal(0);

	/**
	 * Initialize the IndexedDB connection and load entries for the active workspace.
	 * Safe to call multiple times — only opens the DB once, but ALWAYS reloads
	 * entries (handles workspace switch where a different set of entries is needed).
	 */
	async init() {
		this.initPromise ??= (async () => {
			await this.database.open();
		})();

		await this.initPromise;
		await this.loadAll();
	}

	constructor() {
		effect(() => {
			const wsId = this.activeWorkspaceId();
			if (!wsId) return;
			void this.clearAndReload();
		});
	}

	/** Clear in-memory entries and reload from IndexedDB for the current workspace. */
	private async clearAndReload(): Promise<void> {
		this.loadVersion.set(0);
		this.entries.set(new Map());
		// init() opens the DB (if not already open) then loads entries.
		// Safe to call multiple times — only opens DB once.
		await this.init();
	}

	async ensureInitialized(): Promise<void> {
		await this.init();
	}

	//
	// =========================
	// NAME DEDUP
	// =========================
	//

	/**
	 * Given an intended path, return the first non-conflicting variant
	 * by appending " (2)", " (3)", etc. if the path already exists.
	 *
	 * Examples:
	 *   "New Folder"       → "New Folder"          (if free)
	 *   "New Folder"       → "New Folder (2)"      (if "New Folder" exists)
	 *   "note.md"          → "note (2).md"         (if "note.md" exists)
	 *   "note.md"          → "note (3).md"         (if both "note.md" and "note (2).md" exist)
	 */
	private resolveUniquePath(path: string): string {
		let candidate = path;
		let counter = 2;
		while (this.getByPath(candidate)) {
			const ext = path.includes('.')
				? path.slice(path.lastIndexOf('.'))
				: '';
			const stem = ext ? path.slice(0, path.lastIndexOf('.')) : path;
			candidate = `${stem} (${String(counter)})${ext}`;
			counter++;
		}
		return candidate;
	}

	//
	// =========================
	// LOAD
	// =========================
	//

	private async loadAll() {
		const wsId = this.activeWorkspaceId();
		if (!wsId) {
			this.entries.set(new Map());
			return;
		}

		const entries = await this.database.loadAll(wsId);
		const map = new Map<string, VaultEntry>();
		for (const entry of entries) {
			map.set(entry.id, entry);
		}
		this.entries.set(map);
		// Signal that the vault is ready for consumers (SyncEngine, etc.)
		this.loadVersion.update((v) => v + 1);
	}

	//
	// =========================
	// CREATE
	// =========================
	//

	async createFile(path: string, content = '', parentFolderPath?: string) {
		await this.ensureInitialized();

		const wsId = this.activeWorkspaceId();
		if (!wsId) {
			console.warn('VaultStore: no active workspace, cannot create file');
			return;
		}

		// If parentFolderPath is given, derive parentId and full path
		let parentId: string | null = null;
		const fullPath = parentFolderPath
			? `${parentFolderPath}/${path}`
			: path;
		if (parentFolderPath) {
			const folder = this.getByPath(parentFolderPath);
			console.log(
				'Derived parent folder for new file:',
				folder,
				parentFolderPath,
				fullPath,
			);
			parentId = folder?.id ?? null;
		}

		const resolvedPath = this.resolveUniquePath(fullPath);
		const name = resolvedPath.split('/').pop() ?? '';

		// Set pending adapters to all currently active adapters
		const activeAdapters =
			this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];

		await this.put(
			this.makeEntry({
				workspaceId: wsId,
				name,
				path: resolvedPath,
				content,
				parentId,
				pendingAdapters: [...activeAdapters],
			}),
		);
	}

	async createFolder(path: string) {
		await this.ensureInitialized();

		const wsId = this.activeWorkspaceId();
		if (!wsId) {
			console.warn(
				'VaultStore: no active workspace, cannot create folder',
			);
			return;
		}

		const resolvedPath = this.resolveUniquePath(path);
		const name = resolvedPath.split('/').pop() ?? '';

		// Folders persist to disk like files — set pending adapters so
		// sync engine creates real directories on all active adapters.
		const activeAdapters =
			this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];

		await this.put(
			this.makeEntry({
				workspaceId: wsId,
				name,
				path: resolvedPath,
				type: VAULT_ENTRY_TYPES.FOLDER,
				pendingAdapters: [...activeAdapters],
			}),
		);
	}

	//
	// =========================
	// UPDATE
	// =========================
	//

	async updateFile(id: string, content: string) {
		const entry = this.entries().get(id);

		if (!entry) return;

		// Merge current active adapters into pending set (no dupes)
		const activeAdapters =
			this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];
		const pendingAdapters = [
			...new Set([...entry.pendingAdapters, ...activeAdapters]),
		];

		const updated: VaultEntry = {
			...entry,
			content,
			updatedAt: Date.now(),
			pendingAdapters,
			revision: entry.revision + 1,
		};

		await this.put(updated);
	}

	//
	// =========================
	// DELETE
	// =========================
	//

	/**
	 * Delete an entry by ID.
	 *
	 * For files: soft-deletes the entry and sets pendingAdapters so the
	 * sync engine pushes the delete to disk.
	 *
	 * For folders: cascades — soft-deletes the folder AND all descendants
	 * (entries whose path starts with the folder's path + '/').
	 * Each descendant gets pendingAdapters set so sync engine pushes deletes.
	 */
	async delete(id: string) {
		const entry = this.entries().get(id);

		if (!entry) return;

		const wsId = this.activeWorkspaceId();
		if (!wsId) return;

		// Merge current active adapters so delete is pushed to all
		const activeAdapters =
			this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];
		const pendingAdapters = [
			...new Set([...entry.pendingAdapters, ...activeAdapters]),
		];

		await this.put({
			...entry,
			deleted: true,
			pendingAdapters,
			updatedAt: Date.now(),
			revision: entry.revision + 1,
		});

		// Cascade to children if this is a folder
		if (entry.type === VAULT_ENTRY_TYPES.FOLDER) {
			const descendants = Array.from(this.entries().values()).filter(
				(e) =>
					e.workspaceId === wsId &&
					!e.deleted &&
					e.path.startsWith(entry.path + '/'),
			);

			for (const child of descendants) {
				await this.put({
					...child,
					deleted: true,
					pendingAdapters: [
						...new Set([
							...child.pendingAdapters,
							...activeAdapters,
						]),
					],
					updatedAt: Date.now(),
					revision: child.revision + 1,
				});
			}
		}
	}

	//
	// =========================
	// RENAME
	// =========================
	//

	/**
	 * Rename a file or folder entry.
	 *
	 * For files: updates name + path, sets `pendingRenameFrom` so the sync
	 * engine calls `adapter.rename()` instead of `adapter.write()`.
	 *
	 * For folders: cascades to all children whose `path` starts with the old path.
	 * Every child gets `revision + 1` and `pendingAdapters` merged.
	 *
	 * @param id - The entry ID to rename
	 * @param newName - The new name (last path segment only, e.g. "new-name.md")
	 */
	async renameEntry(id: string, newName: string): Promise<void> {
		const entry = this.entries().get(id);
		if (!entry || entry.name === newName) return;

		const oldPath = entry.path;

		// Rebuild path: replace last segment (the name)
		const parent = entry.path.split('/').slice(0, -1).join('/');
		const newPath = parent ? `${parent}/${newName}` : newName;

		const wsId = this.activeWorkspaceId();
		if (!wsId) return;

		const activeAdapters =
			this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];
		const pendingAdapters = [
			...new Set([...entry.pendingAdapters, ...activeAdapters]),
		];

		// Resolve name conflicts — if the new path already exists, auto-dedup
		const resolvedPath = this.resolveUniquePath(newPath);
		const resolvedName = resolvedPath.split('/').pop() ?? newName;

		const updated: VaultEntry = {
			...entry,
			name: resolvedName,
			path: resolvedPath,
			updatedAt: Date.now(),
			revision: entry.revision + 1,
			pendingAdapters,
			pendingRenameFrom: oldPath,
		};

		await this.put(updated);

		// Cascade to children if this is a folder
		if (entry.type === VAULT_ENTRY_TYPES.FOLDER) {
			const children = Array.from(this.entries().values()).filter(
				(e) =>
					e.workspaceId === wsId &&
					!e.deleted &&
					e.path.startsWith(oldPath + '/'),
			);

			for (const child of children) {
				const childNewPath =
					resolvedPath + child.path.slice(oldPath.length);
				const childNewName =
					childNewPath.split('/').pop() ?? child.name;

				await this.put({
					...child,
					name: childNewName,
					path: childNewPath,
					updatedAt: Date.now(),
					revision: child.revision + 1,
					pendingAdapters: [
						...new Set([
							...child.pendingAdapters,
							...activeAdapters,
						]),
					],
				});
			}
		}
	}

	//
	// =========================
	// INBOUND SYNC — delegated to VaultReconciler
	// =========================

	/** Apply an external file change from sync engine. */
	async applyExternalFile(
		path: string,
		content: string,
		sourceAdapterId: string,
	): Promise<void> {
		return this.reconciler.applyExternalFile(
			path,
			content,
			sourceAdapterId,
		);
	}

	/** Apply an external folder discovery from sync engine. */
	async applyExternalFolder(
		path: string,
		sourceAdapterId: string,
	): Promise<void> {
		return this.reconciler.applyExternalFolder(path, sourceAdapterId);
	}

	/** Apply an external rename from sync engine. */
	async applyExternalRename(
		oldPath: string,
		newPath: string,
		sourceAdapterId: string,
	): Promise<void> {
		return this.reconciler.applyExternalRename(
			oldPath,
			newPath,
			sourceAdapterId,
		);
	}

	//
	// =========================
	// QUERIES
	// =========================
	//

	getByPath(path: string) {
		const wsId = this.activeWorkspaceId();
		if (!wsId) return undefined;
		return Array.from(this.entries().values()).find(
			(e) => e.workspaceId === wsId && e.path === path && !e.deleted,
		);
	}

	/** Look up an entry by its unique ID across all workspaces. */
	getById(id: string): VaultEntry | undefined {
		return this.entries().get(id);
	}

	children(path: string) {
		return computed(() =>
			Array.from(this.entries().values()).filter((e) => {
				if (e.deleted) return false;
				return e.path.startsWith(path) && e.path !== path;
			}),
		);
	}

	//
	// =========================
	// SYNC HELPERS
	// =========================
	//

	/**
	 * Mark a single adapter as synced for this entry.
	 * Removes the adapter from `pendingAdapters`.
	 * Also clears `pendingRenameFrom` when the last adapter is synced.
	 */
	async markAdapterSynced(id: string, adapterId: string): Promise<void> {
		const entry = this.entries().get(id);
		if (!entry) return;

		const pendingAdapters = entry.pendingAdapters.filter(
			(a) => a !== adapterId,
		);

		// Clear pendingRenameFrom when fully synced (no adapters left to push to)
		const pendingRenameFrom =
			pendingAdapters.length === 0 ? undefined : entry.pendingRenameFrom;

		await this.put({
			...entry,
			pendingAdapters,
			...(pendingRenameFrom !== undefined ? { pendingRenameFrom } : {}),
		});
	}

	/**
	 * Ensure certain adapter IDs are in the pending set.
	 * Used by pull to spread newly imported files to other adapters.
	 */
	async markAllPending(id: string, adapterIds: string[]): Promise<void> {
		const entry = this.entries().get(id);
		if (!entry) return;

		await this.put({
			...entry,
			pendingAdapters: [
				...new Set([...entry.pendingAdapters, ...adapterIds]),
			],
		});
	}

	//
	// =========================
	// INTERNAL
	// =========================
	//

	/**
	 * Factory for creating a VaultEntry with sensible defaults.
	 * Only used within this class to reduce boilerplate and jscpd clones.
	 */
	makeEntry(overrides: {
		workspaceId: string;
		name: string;
		path: string;
		type?: VaultEntryType;
		content?: string;
		pendingAdapters: string[];
		parentId?: string | null;
	}): VaultEntry {
		return {
			id: crypto.randomUUID(),
			parentId: overrides.parentId ?? null,
			type: overrides.type ?? VAULT_ENTRY_TYPES.FILE,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			deleted: false,
			revision: 1,
			workspaceId: overrides.workspaceId,
			name: overrides.name,
			path: overrides.path,
			pendingAdapters: overrides.pendingAdapters,
			...(overrides.content !== undefined
				? { content: overrides.content }
				: {}),
		};
	}

	async put(entry: VaultEntry) {
		await this.database.put(entry);

		// update signal state
		const next = new Map(this.entries());
		next.set(entry.id, entry);
		this.entries.set(next);
	}
}
