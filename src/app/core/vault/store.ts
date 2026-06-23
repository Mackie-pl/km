import { Injectable, signal, computed, inject, effect } from '@angular/core';
import {
	WorkspaceService,
	type Workspace,
} from '@core/services/workspace.service';
import { VAULT_ENTRY_TYPES, type VaultEntry } from './vault-entry';
import { VaultDatabase } from './vault-database';
import { VaultReconciler } from './vault-reconciler';
import { resolveUniquePath, makeVaultEntry } from './vault-utils';
import {
	repoUrlToCloneDir,
	destroyGitFsBackend,
} from '@core/adapters/cloud/git/fs';
import { GitTokenStore } from '@core/adapters/cloud/git/auth';
import { GitSettingsStore } from '@core/adapters/cloud/git/settings-store';
import type { AdapterConfig } from '@core/adapters/adapter.interface';
import { parseFrontmatter } from '@core/utils/frontmatter-parser';

// Re-exports for backward compat with imports from @vault/store
export { VAULT_ENTRY_TYPES, type VaultEntry } from './vault-entry';

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
	readonly entriesNeedingSync = computed(() => {
		const wsId = this.activeWorkspaceId();
		if (!wsId) return [];
		return Array.from(this.entries().values()).filter(
			(e) => e.workspaceId === wsId && e.pendingAdapters.length > 0,
		);
	});

	/** Frontmatter metadata for every non-deleted file — reactively derived. */
	readonly allFrontmatters = computed(() =>
		this.files().map((f) => {
			const { metadata } = parseFrontmatter(f.content ?? '');
			return metadata;
		}),
	);

	/** All unique tags across all files, lowercased, sorted. */
	readonly allTags = computed(() => {
		const set = new Set<string>();
		for (const fm of this.allFrontmatters()) {
			for (const tag of fm.tags ?? []) {
				set.add(tag.toLowerCase());
			}
		}
		return [...set].sort();
	});

	//
	// =========================
	// DB
	// =========================
	//

	private readonly database = new VaultDatabase();
	private initPromise: Promise<void> | null = null;
	/** Tracks which workspace was last loaded via init(). Guards the constructor effect. */
	private loadedWsId: string | null = null;

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
		this.initPromise ??= this.#openDatabase();
		await this.initPromise;
		await this.loadAll();
	}

	async #openDatabase(): Promise<void> {
		await this.database.open();
	}

	constructor() {
		// Reload entries when the active workspace changes to a different workspace.
		// Skips the initial load (handled by explicit init()) to avoid races.
		effect(() => {
			const wsId = this.activeWorkspaceId();
			if (!wsId || !this.loadedWsId) return;
			if (wsId === this.loadedWsId) return;
			void this.clearAndReload();
		});

		// When a workspace is removed from the service, purge its IndexedDB entries.
		// This keeps VaultStore as the single authority over DB ↔ workspace linkage,
		// avoiding a circular DI between WorkspaceService and VaultStore.
		this.#watchWorkspaceRemovals();
	}

	/** Tracks workspace IDs seen previously, so we can detect removals. */
	#lastSeenWorkspaces = new Map<string, Workspace>();
	// True after the first workspace list is observed — guards against
	// firing on the initial empty→populated transition.
	#workspaceRemovalWatchReady = false;

	/**
	 * Watch `workspaceService.workspaces()` and purge IndexedDB entries for any
	 * workspace ID that disappears from the list.
	 */
	#watchWorkspaceRemovals(): void {
		effect(() => {
			// Only dependency: the workspace list signal.
			const current = this.workspaceService.workspaces();
			const currentIds = new Set(current.map((w) => w.id));

			if (this.#workspaceRemovalWatchReady) {
				for (const [removedId, removedWs] of this.#lastSeenWorkspaces) {
					if (!currentIds.has(removedId)) {
						void this.purgeWorkspace(
							removedId,
							removedWs.adapterConfigs,
						);
					}
				}
			}

			this.#workspaceRemovalWatchReady = true;
			this.#lastSeenWorkspaces = new Map(current.map((w) => [w.id, w]));
		});
	}

	/** Clear in-memory entries and reload from IndexedDB for the current workspace. */
	private async clearAndReload(): Promise<void> {
		this.loadVersion.set(0);
		this.entries.set(new Map());
		await this.init();
	}

	async ensureInitialized(): Promise<void> {
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
		this.loadedWsId = wsId;
		// Signal that the vault is ready for consumers (SyncEngine, etc.)
		this.loadVersion.update((v) => v + 1);
	}

	//
	// =========================
	// PURGE (workspace removal)
	// =========================

	/**
	 * Permanently delete ALL vault entries for a given workspace from IndexedDB.
	 * Called when a workspace is removed. If the purged workspace is the currently
	 * active one, the in-memory entries are also cleared.
	 *
	 * Also cleans up git adapter data: destroys the LightningFS IndexedDB database
	 * for each git adapter and removes the encrypted token and stored settings.
	 */
	async purgeWorkspace(
		wsId: string,
		adapterConfigs?: AdapterConfig[],
	): Promise<void> {
		await this.ensureInitialized();
		await this.database.deleteAllByWorkspaceId(wsId);

		// Clean up git adapter data (LightningFS DB + token + settings)
		if (adapterConfigs) {
			for (const config of adapterConfigs) {
				if (config.adapterId === 'git') {
					const cloneDir = repoUrlToCloneDir(config.repoUrl);
					await destroyGitFsBackend(cloneDir);
					const tokenStore = new GitTokenStore();
					await tokenStore.deleteToken(config.repoUrl);
					new GitSettingsStore().delete(config.repoUrl);
				}
			}
		}

		// If the purged workspace is the one currently loaded, clear memory
		if (this.activeWorkspaceId() === wsId) {
			this.entries.set(new Map());
			this.loadedWsId = null;
			this.loadVersion.set(0);
		}
	}

	//
	// =========================
	// CREATE
	// =========================
	//

	async createFile(
		path: string,
		content = '',
		parentFolderPath?: string,
	): Promise<VaultEntry | undefined> {
		await this.ensureInitialized();

		const wsId = this.activeWorkspaceId();
		if (!wsId) {
			console.warn('VaultStore: no active workspace, cannot create file');
			return undefined;
		}

		// If parentFolderPath is given, derive parentId and full path
		let parentId: string | null = null;
		const fullPath = parentFolderPath
			? `${parentFolderPath}/${path}`
			: path;
		if (parentFolderPath) {
			const folder = this.getByPath(parentFolderPath);
			parentId = folder?.id ?? null;
		}

		const resolvedPath = resolveUniquePath(fullPath, (p) =>
			this.getByPath(p),
		);
		const name = resolvedPath.split('/').pop() ?? '';

		// Set pending adapters to all currently active adapters
		const activeAdapters = this.getActiveSyncAdapters();

		const entry = makeVaultEntry({
			workspaceId: wsId,
			name,
			path: resolvedPath,
			content,
			parentId,
			pendingAdapters: [...activeAdapters],
		});

		await this.put(entry);
		return entry;
	}

	async createFolder(path: string): Promise<VaultEntry | undefined> {
		await this.ensureInitialized();

		const wsId = this.activeWorkspaceId();
		if (!wsId) {
			console.warn(
				'VaultStore: no active workspace, cannot create folder',
			);
			return undefined;
		}

		const resolvedPath = resolveUniquePath(path, (p) => this.getByPath(p));
		const name = resolvedPath.split('/').pop() ?? '';

		// Folders persist to disk like files — set pending adapters so
		// sync engine creates real directories on all active adapters.
		const activeAdapters =
			this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];

		const entry = makeVaultEntry({
			workspaceId: wsId,
			name,
			path: resolvedPath,
			type: VAULT_ENTRY_TYPES.FOLDER,
			pendingAdapters: [...activeAdapters],
		});

		await this.put(entry);
		return entry;
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
		const resolvedPath = resolveUniquePath(newPath, (p) =>
			this.getByPath(p),
		);
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
			await this.cascadeRenameChildren(
				entry,
				oldPath,
				resolvedPath,
				activeAdapters,
			);
		}
	}

	/** Update all children of a renamed folder with new paths. */
	async cascadeRenameChildren(
		entry: VaultEntry,
		oldPath: string,
		newPath: string,
		activeAdapters: string[],
	): Promise<void> {
		const children = Array.from(this.entries().values()).filter(
			(e) =>
				e.workspaceId === entry.workspaceId &&
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

	getByPath(path: string): VaultEntry | undefined {
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
	 * Mark all vault entries NOT found in `seenPaths` as needing sync
	 * to the given adapter. Used when a new adapter is added to an
	 * existing workspace — existing vault entries that weren't found
	 * on the new adapter must be pushed to it so they don't get
	 * orphan-detected on the next pull cycle.
	 */
	async markPendingForAdapter(
		adapterId: string,
		seenPaths: Set<string>,
	): Promise<void> {
		const wsId = this.activeWorkspaceId();
		if (!wsId) return;

		for (const [, entry] of this.entries()) {
			if (entry.workspaceId !== wsId || entry.deleted) continue;
			if (seenPaths.has(entry.path)) continue;
			if (entry.pendingAdapters.includes(adapterId)) continue;

			await this.put({
				...entry,
				pendingAdapters: [...entry.pendingAdapters, adapterId],
			});
		}
	}

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
		const pendingRenameFrom: string | undefined =
			pendingAdapters.length === 0 ? undefined : entry.pendingRenameFrom;

		const { pendingRenameFrom: _oldRename, ...rest } = entry;

		await this.put({
			...rest,
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

	/**
	 * Clear the `pendingRenameFrom` field on an entry without changing anything else.
	 * Used by SyncPushPhase when a rename fails on an adapter that never had the
	 * source file — allows the push to fall back to writing content directly.
	 */
	async clearPendingRename(id: string): Promise<void> {
		const entry = this.entries().get(id);
		if (!entry) return;

		const { pendingRenameFrom: _old, ...rest } = entry;
		await this.put(rest);
	}

	//
	// =========================
	// INTERNAL
	// =========================
	//

	async put(entry: VaultEntry) {
		await this.database.put(entry);

		// update signal state
		const next = new Map(this.entries());
		next.set(entry.id, entry);
		this.entries.set(next);
	}
}
