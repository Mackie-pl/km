import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { WorkspaceService } from '@core/services/workspace.service';
import { VAULT_ENTRY_TYPES, type VaultEntry } from './vault-entry';
import { VaultReconciler } from './vault-reconciler';
import { VaultRelocation } from './vault-relocation';
import { VaultLifecycle } from './vault-lifecycle';
import { VaultFrontmatterIndex } from './vault-frontmatter-index';
import { resolveUniquePath, makeVaultEntry } from './vault-utils';
import { ARCHIVE_FOLDER, isArchivedPath } from '@core/utils/file-patterns';

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

	/**
	 * path → id index for the active workspace's non-deleted entries.
	 * Keeps `getByPath` O(1) instead of a linear scan (which, called once per
	 * file during a pull, made reconciliation O(N²)). Maintained in lockstep
	 * with the `entries` signal by `put`/`putMany`/`hydrate`.
	 */
	readonly #pathIndex = new Map<string, string>();

	/** Memoized frontmatter parser backing `allFrontmatters`/`allTags`. */
	readonly #frontmatter = new VaultFrontmatterIndex();

	private readonly reconciler = new VaultReconciler(this);

	/** Owns rename/move mechanics (pendingRenameFrom, cascades). */
	private readonly relocation = new VaultRelocation(this);

	/** Owns DB access + workspace lifecycle (init/load/reload/purge). */
	private readonly lifecycle = new VaultLifecycle(this);

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

	/**
	 * UI-facing views of `files`/`folders` that hide the `.archive/` subtree.
	 * Sync phases must keep consuming the unfiltered `files()`/`folders()` —
	 * archived entries are real synced content, just not shown in the tree,
	 * search, or tag bar.
	 */
	readonly visibleFiles = computed(() =>
		this.files().filter((e) => !isArchivedPath(e.path)),
	);

	readonly visibleFolders = computed(() =>
		this.folders().filter((e) => !isArchivedPath(e.path)),
	);

	/** Non-deleted entries living under `.archive/` (excluding the folder itself). */
	readonly archivedEntries = computed(() =>
		Array.from(this.entries().values()).filter(
			(e) =>
				!e.deleted &&
				isArchivedPath(e.path) &&
				e.path !== ARCHIVE_FOLDER,
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

	/** Frontmatter metadata for every visible (non-archived) file. */
	readonly allFrontmatters = computed(() =>
		this.visibleFiles().map((f) =>
			this.#frontmatter.parse(f.id, f.content ?? ''),
		),
	);

	/** All unique tags across all files, lowercased, sorted. */
	readonly allTags = computed(() =>
		this.#frontmatter.collectTags(this.allFrontmatters()),
	);

	//
	// =========================
	// LIFECYCLE (DB + workspace load/switch/removal)
	// =========================
	//

	/**
	 * Incremented every time entries are loaded from IndexedDB. Consumers can
	 * watch this to know when the vault is ready after workspace activation or
	 * switch. Bumped by `hydrate`, reset by `resetMemory`.
	 */
	readonly loadVersion = signal(0);

	constructor() {
		// Reload entries when the active workspace changes to a different one.
		// The signal read happens inside the effect so the dependency is tracked.
		effect(() => {
			this.lifecycle.handleWorkspaceSwitch(this.activeWorkspaceId());
		});

		// Purge a workspace's IndexedDB entries when it's removed from the service.
		// Keeping this in VaultStore avoids a circular DI with WorkspaceService.
		effect(() => {
			this.lifecycle.syncWorkspaceRemovals(
				this.workspaceService.workspaces(),
			);
		});
	}

	/**
	 * Set when the IndexedDB connection could not be opened. The vault renders
	 * empty in that state and no write can persist, so this must be surfaced
	 * rather than left to look like an empty vault.
	 */
	readonly initError = signal<string | null>(null);

	/**
	 * Initialize the IndexedDB connection and load entries for the active
	 * workspace. Safe to call multiple times. Delegates to VaultLifecycle.
	 */
	async init(): Promise<void> {
		try {
			await this.lifecycle.init();
			this.initError.set(null);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : 'Unknown error';
			console.error('[Vault] Failed to open the vault database:', err);
			this.initError.set(message);
			throw err;
		}
	}

	async ensureInitialized(): Promise<void> {
		await this.lifecycle.ensureInitialized();
	}

	/**
	 * Replace in-memory state with `entries` loaded from the DB: rebuild the
	 * path index, clear the frontmatter cache, and signal readiness. Called by
	 * VaultLifecycle after loading a workspace.
	 */
	hydrate(entries: VaultEntry[]): void {
		const map = new Map<string, VaultEntry>();
		this.#pathIndex.clear();
		this.#frontmatter.clear();
		for (const entry of entries) {
			map.set(entry.id, entry);
			if (!entry.deleted) this.#pathIndex.set(entry.path, entry.id);
		}
		this.entries.set(map);
		// Signal that the vault is ready for consumers (SyncEngine, etc.)
		this.loadVersion.update((v) => v + 1);
	}

	/** Clear all in-memory state (workspace switch / removal / no workspace). */
	resetMemory(): void {
		this.loadVersion.set(0);
		this.#pathIndex.clear();
		this.#frontmatter.clear();
		this.entries.set(new Map());
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
		const mergePending = (e: VaultEntry): string[] => [
			...new Set([...e.pendingAdapters, ...activeAdapters]),
		];

		const now = Date.now();
		const updates: VaultEntry[] = [
			{
				...entry,
				deleted: true,
				pendingAdapters: mergePending(entry),
				updatedAt: now,
				revision: entry.revision + 1,
			},
		];

		// Cascade to children if this is a folder (one batched write)
		if (entry.type === VAULT_ENTRY_TYPES.FOLDER) {
			const descendants = Array.from(this.entries().values()).filter(
				(e) =>
					e.workspaceId === wsId &&
					!e.deleted &&
					e.path.startsWith(entry.path + '/'),
			);

			for (const child of descendants) {
				updates.push({
					...child,
					deleted: true,
					pendingAdapters: mergePending(child),
					updatedAt: now,
					revision: child.revision + 1,
				});
			}
		}

		await this.putMany(updates);
	}

	//
	// =========================
	// RENAME / MOVE — delegated to VaultRelocation
	// =========================
	//

	/** Rename an entry in place (last path segment only). */
	async renameEntry(id: string, newName: string): Promise<void> {
		return this.relocation.renameEntry(id, newName);
	}

	/** Move an entry to an arbitrary new path (e.g. into `.archive/`). */
	async moveEntry(id: string, newPath: string): Promise<void> {
		return this.relocation.moveEntry(id, newPath);
	}

	/** Create any missing folder entries along `folderPath`. */
	async ensureFolderPath(folderPath: string): Promise<void> {
		return this.relocation.ensureFolderPath(folderPath);
	}

	/** Update all children of a renamed/moved folder with new paths. */
	async cascadeRenameChildren(
		entry: VaultEntry,
		oldPath: string,
		newPath: string,
		activeAdapters: string[],
	): Promise<void> {
		return this.relocation.cascadeRenameChildren(
			entry,
			oldPath,
			newPath,
			activeAdapters,
		);
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
		// O(1) via the path index. Reading the entries signal keeps this method
		// reactive (computeds that call getByPath re-run when entries change);
		// the index is updated before the signal fires, so it's always current.
		const entries = this.entries();
		const id = this.#pathIndex.get(path);
		if (id === undefined) return undefined;
		const entry = entries.get(id);
		if (!entry || entry.deleted || entry.workspaceId !== wsId) {
			return undefined;
		}
		return entry;
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

		const updates: VaultEntry[] = [];
		for (const [, entry] of this.entries()) {
			if (entry.workspaceId !== wsId || entry.deleted) continue;
			if (seenPaths.has(entry.path)) continue;
			if (entry.pendingAdapters.includes(adapterId)) continue;

			updates.push({
				...entry,
				pendingAdapters: [...entry.pendingAdapters, adapterId],
			});
		}
		await this.putMany(updates);
	}

	/**
	 * Mark a single adapter as synced: removes it from `pendingAdapters` and
	 * clears `pendingRenameFrom` once fully synced. `contentHash` (the pushed
	 * content's hash) is recorded as the adapter's sync base so the reconciler
	 * can tell a stale remote from a diverged one.
	 */
	async markAdapterSynced(
		id: string,
		adapterId: string,
		contentHash?: string,
	): Promise<void> {
		const entry = this.entries().get(id);
		if (!entry) return;

		const { pendingRenameFrom, ...rest } = entry;
		const pendingAdapters = entry.pendingAdapters.filter(
			(a) => a !== adapterId,
		);
		const syncedHashes = contentHash
			? { ...entry.syncedHashes, [adapterId]: contentHash }
			: entry.syncedHashes;

		await this.put({
			...rest,
			pendingAdapters,
			...(syncedHashes ? { syncedHashes } : {}),
			// Keep pendingRenameFrom only while adapters remain to push to
			...(pendingAdapters.length > 0 && pendingRenameFrom !== undefined
				? { pendingRenameFrom }
				: {}),
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
		await this.lifecycle.persist(entry);

		// update signal state
		const next = new Map(this.entries());
		const prev = next.get(entry.id);
		next.set(entry.id, entry);
		this.#updatePathIndex(prev, entry);
		this.entries.set(next);
	}

	/**
	 * Persist many entries in one shot: a single IndexedDB write batch, a single
	 * Map rebuild, and a single signal emission. Used by the cascade/bulk paths
	 * (folder delete/rename, marking pending for a new adapter) so they don't
	 * fan out into N signal emissions (each of which recomputes every derived
	 * signal) — the quadratic behavior this replaces.
	 */
	async putMany(entries: VaultEntry[]): Promise<void> {
		if (entries.length === 0) return;

		await this.lifecycle.persistMany(entries);

		const next = new Map(this.entries());
		for (const entry of entries) {
			const prev = next.get(entry.id);
			next.set(entry.id, entry);
			this.#updatePathIndex(prev, entry);
		}
		this.entries.set(next);
	}

	/** Keep `#pathIndex` consistent when an entry is written, moved, or deleted. */
	#updatePathIndex(prev: VaultEntry | undefined, entry: VaultEntry): void {
		// Drop the previous path mapping if this entry moved away from it.
		if (
			prev &&
			prev.path !== entry.path &&
			this.#pathIndex.get(prev.path) === prev.id
		) {
			this.#pathIndex.delete(prev.path);
		}
		if (!entry.deleted) {
			this.#pathIndex.set(entry.path, entry.id);
		} else if (this.#pathIndex.get(entry.path) === entry.id) {
			this.#pathIndex.delete(entry.path);
		}
	}
}
