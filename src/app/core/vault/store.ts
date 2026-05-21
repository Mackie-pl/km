// vault-db.service.ts

import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { WorkspaceService } from '@core/services/workspace.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export const VAULT_ENTRY_TYPES = { FILE: 'file', FOLDER: 'folder' } as const;
export type VaultEntryType =
	(typeof VAULT_ENTRY_TYPES)[keyof typeof VAULT_ENTRY_TYPES];

export interface VaultEntry {
	id: string;
	workspaceId: string;
	name: string;
	path: string;
	parentId: string | null;
	type: VaultEntryType;
	content?: string;
	createdAt: number;
	updatedAt: number;
	/** Adapter IDs that still need to receive this entry. Empty = fully synced. */
	pendingAdapters: string[];
	deleted: boolean;
	revision: number;
}

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

	private db: IDBDatabase | null = null;
	private initPromise: Promise<void> | null = null;

	/**
	 * Initialize the IndexedDB connection and load entries for the active workspace.
	 * Safe to call multiple times — only opens the DB once.
	 * If no workspace is active, the entries map stays empty until one is selected.
	 */
	async init() {
		this.initPromise ??= (async () => {
			this.db = await this.open();
			await this.loadAll();
		})();

		await this.initPromise;
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
		this.entries.set(new Map());
		await this.loadAll();
	}

	private async ensureInitialized(): Promise<void> {
		await this.init();
	}

	private open(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			// DB version 3: dirty:boolean → pendingAdapters:string[]
			const request = indexedDB.open('vault-db', 3);

			request.onupgradeneeded = (event) => {
				const db = request.result;

				if (!db.objectStoreNames.contains('entries')) {
					const store = db.createObjectStore('entries', {
						keyPath: 'id',
					});
					store.createIndex('path', 'path');
					store.createIndex('parentId', 'parentId');
					store.createIndex('workspaceId', 'workspaceId');
				} else if (event.oldVersion < 3) {
					// Migration v2 → v3: replace dirty index with pendingAdapters field
					const store = request.transaction?.objectStore('entries');
					if (!store) return;

					// Remove old dirty index if it exists
					if (store.indexNames.contains('dirty')) {
						store.deleteIndex('dirty');
					}

					// Migrate: dirty:boolean → pendingAdapters:string[]
					const cursorReq = store.openCursor();
					cursorReq.onsuccess = () => {
						const cursor = cursorReq.result;
						if (cursor) {
							const entry = cursor.value as AnyRecord;
							if (typeof entry['dirty'] === 'boolean') {
								entry['pendingAdapters'] = [];
								delete entry['dirty'];
								cursor.update(entry);
							}
							cursor.continue();
						}
					};
				}
			};

			request.onsuccess = () => {
				resolve(request.result);
			};

			request.onerror = () => {
				reject(new Error(request.error?.message));
			};
		});
	}

	//
	// =========================
	// LOAD
	// =========================
	//

	private async loadAll() {
		if (!this.db) return;
		const wsId = this.activeWorkspaceId();
		if (!wsId) {
			this.entries.set(new Map());
			return;
		}

		const tx = this.db.transaction('entries', 'readonly');
		const store = tx.objectStore('entries');
		const index = store.index('workspaceId');

		const request = index.getAll(wsId) as IDBRequest<VaultEntry[]>;
		const entries = await this.awaitRequest<VaultEntry[]>(request);

		const map = new Map<string, VaultEntry>();
		for (const entry of entries) {
			map.set(entry.id, entry);
		}
		this.entries.set(map);
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
	// INBOUND SYNC — external file reconciliation
	// =========================

	/**
	 * Apply an external file change detected by an adapter (watch/pull).
	 *
	 * This is the canonical reconciliation entry point for inbound sync:
	 *
	 * ```text
	 * external change → adapter detects → SyncEngine reads file
	 * → VaultStore.applyExternalFile() → projection updated → UI rerenders
	 * ```
	 *
	 * ## Behavior by scenario
	 *
	 * | Scenario | Action |
	 * |----------|--------|
	 * | NEW file (not in vault) | Create entry, mark source adapter synced |
	 * | EXISTING file, no local unsaved changes | Overwrite content |
	 * | EXISTING file, local unsaved changes exist | Create conflict file |
	 * | EXISTING file marked deleted | Restore as active file |
	 *
	 * @param path - File path relative to workspace root
	 * @param content - Full text content from the canonical source
	 * @param sourceAdapterId - The adapter that detected the change
	 */
	async applyExternalFile(
		path: string,
		content: string,
		sourceAdapterId: string,
	): Promise<void> {
		await this.ensureInitialized();

		const wsId = this.activeWorkspaceId();
		if (!wsId) return;

		const existing = this.getByPath(path);

		// ── Case 1: Brand new file ──
		if (!existing) {
			const name = path.split('/').pop() ?? '';
			const activeAdapters =
				this.workspaceService.activeWorkspace()?.activeSyncAdapters ??
				[];

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
			return;
		}

		// ── Case 2: File was locally deleted, now external version appears ──
		if (existing.deleted) {
			const updated: VaultEntry = {
				...existing,
				content,
				deleted: false,
				updatedAt: Date.now(),
				revision: existing.revision + 1,
				// Don't re-add source adapter — it's already in sync
				pendingAdapters: existing.pendingAdapters.filter(
					(a) => a !== sourceAdapterId,
				),
			};
			await this.put(updated);
			return;
		}

		// ── Case 3: Local unsaved changes exist → conflict ──
		if (existing.pendingAdapters.length > 0) {
			const ext = existing.name.includes('.')
				? '.' + (existing.name.split('.').pop() ?? '')
				: '';
			const conflictName = `${existing.name.replace(/\.[^.]+$/, '')}.conflict-${sourceAdapterId}${ext}`;
			const conflictPath = existing.path.replace(
				existing.name,
				conflictName,
			);
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
			return;
		}

		// ── Case 4: Clean overwrite — no local changes pending ──
		const updated: VaultEntry = {
			...existing,
			content,
			updatedAt: Date.now(),
			revision: existing.revision + 1,
			// Source adapter is already in sync
			pendingAdapters: existing.pendingAdapters.filter(
				(a) => a !== sourceAdapterId,
			),
		};
		await this.put(updated);
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
	 */
	async markAdapterSynced(id: string, adapterId: string): Promise<void> {
		const entry = this.entries().get(id);
		if (!entry) return;

		await this.put({
			...entry,
			pendingAdapters: entry.pendingAdapters.filter(
				(a) => a !== adapterId,
			),
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
			...overrides,
		};
	}

	private async put(entry: VaultEntry) {
		// persist to IndexedDB
		if (!this.db) return;
		const tx = this.db.transaction('entries', 'readwrite');
		const store = tx.objectStore('entries');
		const request = store.put(entry);
		await this.awaitRequest(request);

		// update signal state
		const next = new Map(this.entries());
		next.set(entry.id, entry);
		this.entries.set(next);
	}

	private awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			request.onsuccess = () => {
				resolve(request.result);
			};

			request.onerror = () => {
				reject(new Error(request.error?.message));
			};
		});
	}
}
