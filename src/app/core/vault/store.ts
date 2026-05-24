import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { WorkspaceService } from '@core/services/workspace.service';
import {
	VAULT_ENTRY_TYPES,
	type VaultEntryType,
	type VaultEntry,
} from './vault-entry';
import { VaultDatabase } from './vault-database';

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

	/** Derived signal: the currently active workspace ID, or null if none. */
	private readonly activeWorkspaceId = computed(
		() => this.workspaceService.activeWorkspace()?.id ?? null,
	);

	private entries = signal<Map<string, VaultEntry>>(new Map());

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

	private async ensureInitialized(): Promise<void> {
		await this.init();
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

	async createFile(path: string, content = '') {
		await this.ensureInitialized();

		const wsId = this.activeWorkspaceId();
		if (!wsId) {
			console.warn('VaultStore: no active workspace, cannot create file');
			return;
		}

		const name = path.split('/').pop() ?? '';

		// Set pending adapters to all currently active adapters
		const activeAdapters =
			this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];

		await this.put(
			this.makeEntry({
				workspaceId: wsId,
				name,
				path,
				content,
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

		const name = path.split('/').pop() ?? '';

		await this.put(
			this.makeEntry({
				workspaceId: wsId,
				name,
				path,
				type: VAULT_ENTRY_TYPES.FOLDER,
				pendingAdapters: [],
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

	async delete(id: string) {
		const entry = this.entries().get(id);

		if (!entry) return;

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

		const updated: VaultEntry = {
			...entry,
			name: newName,
			path: newPath,
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
				const childNewPath = newPath + child.path.slice(oldPath.length);
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
	// INBOUND SYNC — external file reconciliation
	// =========================

	/** Apply an external file change — delegates to case handlers. */
	async applyExternalFile(
		path: string,
		content: string,
		sourceAdapterId: string,
	): Promise<void> {
		await this.ensureInitialized();

		const wsId = this.activeWorkspaceId();
		if (!wsId) return;

		const existing = this.getByPath(path);

		if (!existing) {
			await this.handleNewExternalFile(
				wsId,
				path,
				content,
				sourceAdapterId,
			);
			return;
		}

		if (existing.deleted) {
			await this.handleRestoredExternalFile(
				existing,
				content,
				sourceAdapterId,
			);
			return;
		}

		if (existing.pendingAdapters.length > 0) {
			await this.handleExternalConflict(
				existing,
				path,
				content,
				sourceAdapterId,
				wsId,
			);
			return;
		}

		// Clean overwrite — no local changes pending
		const updated: VaultEntry = {
			...existing,
			content,
			updatedAt: Date.now(),
			revision: existing.revision + 1,
			pendingAdapters: existing.pendingAdapters.filter(
				(a) => a !== sourceAdapterId,
			),
		};
		await this.put(updated);
	}

	private async handleNewExternalFile(
		wsId: string,
		path: string,
		content: string,
		sourceAdapterId: string,
	): Promise<void> {
		const name = path.split('/').pop() ?? '';
		const activeAdapters =
			this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];
		await this.put(
			this.makeEntry({
				workspaceId: wsId,
				name,
				path,
				content,
				pendingAdapters: activeAdapters.filter(
					(a) => a !== sourceAdapterId,
				),
			}),
		);
	}

	private async handleRestoredExternalFile(
		existing: VaultEntry,
		content: string,
		sourceAdapterId: string,
	): Promise<void> {
		const updated: VaultEntry = {
			...existing,
			content,
			deleted: false,
			updatedAt: Date.now(),
			revision: existing.revision + 1,
			pendingAdapters: existing.pendingAdapters.filter(
				(a) => a !== sourceAdapterId,
			),
		};
		await this.put(updated);
	}

	private async handleExternalConflict(
		existing: VaultEntry,
		path: string,
		content: string,
		sourceAdapterId: string,
		wsId: string,
	): Promise<void> {
		const ext = existing.name.includes('.')
			? '.' + (existing.name.split('.').pop() ?? '')
			: '';
		const conflictName = `${existing.name.replace(/\.[^.]+$/, '')}.conflict-${sourceAdapterId}${ext}`;
		const conflictPath = existing.path.replace(existing.name, conflictName);
		const entry: VaultEntry = {
			id: crypto.randomUUID(),
			workspaceId: wsId,
			name: conflictName,
			path: conflictPath,
			type: VAULT_ENTRY_TYPES.FILE,
			parentId: existing.parentId,
			content,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			pendingAdapters: [],
			deleted: false,
			revision: 1,
		};
		await this.put(entry);
		console.warn(
			`[Vault] Conflict detected for "${path}" — created "${conflictName}"`,
		);
	}

	//
	// =========================
	// INBOUND SYNC — external rename reconciliation
	// =========================

	/** Apply an external rename — delegates to case handlers. */
	async applyExternalRename(
		oldPath: string,
		newPath: string,
		sourceAdapterId: string,
	): Promise<void> {
		await this.ensureInitialized();

		const wsId = this.activeWorkspaceId();
		if (!wsId) return;

		const existing = this.getByPath(oldPath);
		if (!existing) return;

		const newName = newPath.split('/').pop() ?? '';

		if (existing.pendingAdapters.length > 0) {
			await this.handleExternalRenameConflict(
				existing,
				oldPath,
				newPath,
				newName,
				wsId,
				sourceAdapterId,
			);
			return;
		}

		await this.handleCleanExternalRename(
			existing,
			oldPath,
			newPath,
			newName,
			wsId,
			sourceAdapterId,
		);
	}

	private async handleExternalRenameConflict(
		existing: VaultEntry,
		_oldPath: string,
		newPath: string,
		newName: string,
		wsId: string,
		sourceAdapterId: string,
	): Promise<void> {
		const activeAdapters =
			this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];
		await this.put(
			this.makeEntry({
				workspaceId: wsId,
				name: newName,
				path: newPath,
				content: existing.content ?? '',
				pendingAdapters: activeAdapters.filter(
					(a) => a !== sourceAdapterId,
				),
			}),
		);
		console.warn(
			`[Vault] External rename conflict for "${_oldPath}" → "${newPath}" — local changes preserved`,
		);
	}

	private async handleCleanExternalRename(
		existing: VaultEntry,
		oldPath: string,
		newPath: string,
		newName: string,
		wsId: string,
		sourceAdapterId: string,
	): Promise<void> {
		const activeAdapters =
			this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];

		const updated: VaultEntry = {
			...existing,
			name: newName,
			path: newPath,
			updatedAt: Date.now(),
			revision: existing.revision + 1,
			pendingAdapters: activeAdapters.filter(
				(a) => a !== sourceAdapterId,
			),
		};

		await this.put(updated);

		if (existing.type === VAULT_ENTRY_TYPES.FOLDER) {
			await this.cascadeRenameChildren(
				existing,
				oldPath,
				newPath,
				activeAdapters,
			);
		}
	}

	private async cascadeRenameChildren(
		existing: VaultEntry,
		oldPath: string,
		newPath: string,
		activeAdapters: string[],
	): Promise<void> {
		const children = Array.from(this.entries().values()).filter(
			(e) =>
				e.workspaceId === existing.workspaceId &&
				!e.deleted &&
				e.path.startsWith(oldPath + '/'),
		);

		for (const child of children) {
			const childNewPath = newPath + child.path.slice(oldPath.length);
			const childNewName = childNewPath.split('/').pop() ?? child.name;

			await this.put({
				...child,
				name: childNewName,
				path: childNewPath,
				updatedAt: Date.now(),
				revision: child.revision + 1,
				pendingAdapters: [
					...new Set([...child.pendingAdapters, ...activeAdapters]),
				],
			});
		}
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
			(e) => e.workspaceId === wsId && e.path === path,
		);
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
	private makeEntry(overrides: {
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

	private async put(entry: VaultEntry) {
		await this.database.put(entry);

		// update signal state
		const next = new Map(this.entries());
		next.set(entry.id, entry);
		this.entries.set(next);
	}
}
