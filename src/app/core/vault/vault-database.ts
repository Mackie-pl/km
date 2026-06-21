import { idbRequestToPromise } from '@core/utils/idb-request';
import type { VaultEntry } from './vault-entry';

/**
 * Raw IndexedDB layer for vault entries.
 * Handles database lifecycle and low-level CRUD operations.
 * VaultStore delegates all DB I/O to this class.
 */
export class VaultDatabase {
	private db: IDBDatabase | null = null;

	/** Open (or create) the IndexedDB database with schema migrations. */
	async open(): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open('vault-db', 5);

			request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
				const db = request.result;

				if (event.oldVersion < 5) {
					// v5: nuke & recreate — the `path` index was unique in older
					// versions, causing "key does not satisfy uniqueness" errors.
					// Rather than complex per-version migrations, drop the store
					// and recreate cleanly.
					if (db.objectStoreNames.contains('entries')) {
						db.deleteObjectStore('entries');
					}
				}

				if (!db.objectStoreNames.contains('entries')) {
					const store = db.createObjectStore('entries', {
						keyPath: 'id',
					});
					store.createIndex('path', 'path', { unique: false });
					store.createIndex('parentId', 'parentId', {
						unique: false,
					});
					store.createIndex('workspaceId', 'workspaceId', {
						unique: false,
					});
				}
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onerror = () => {
				reject(new Error(request.error?.message ?? 'Unknown error'));
			};
		});
	}

	/** Load all entries for a given workspace. */
	async loadAll(wsId: string): Promise<VaultEntry[]> {
		if (!this.db) return [];
		const tx = this.db.transaction('entries', 'readonly');
		const store = tx.objectStore('entries');
		const index = store.index('workspaceId');
		const request = index.getAll(wsId) as IDBRequest<VaultEntry[]>;
		return idbRequestToPromise(request);
	}

	/** Persist a single entry — insert or update. */
	async put(entry: VaultEntry): Promise<void> {
		if (!this.db) return;
		const tx = this.db.transaction('entries', 'readwrite');
		const store = tx.objectStore('entries');
		const request = store.put(entry);
		await idbRequestToPromise(request);
	}

	/** Delete all entries for a given workspace. Used when removing a workspace. */
	async deleteAllByWorkspaceId(wsId: string): Promise<void> {
		if (!this.db) return;
		const entries = await this.loadAll(wsId);
		if (entries.length === 0) return;

		const tx = this.db.transaction('entries', 'readwrite');
		const store = tx.objectStore('entries');
		for (const entry of entries) {
			store.delete(entry.id);
		}

		return new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => {
				resolve();
			};
			tx.onerror = () => {
				reject(new Error(tx.error?.message ?? 'Transaction failed'));
			};
		});
	}

	/** Delete all entries from the store. Used in tests to reset state. */
	async clear(): Promise<void> {
		if (!this.db) return;
		const tx = this.db.transaction('entries', 'readwrite');
		const store = tx.objectStore('entries');
		const request = store.clear();
		await idbRequestToPromise(request);
	}

	/** Close the database connection. Safe to call multiple times. */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}
}
