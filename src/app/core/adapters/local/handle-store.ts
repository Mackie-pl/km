/**
 * Standalone IndexedDB wrapper for persisting FileSystemDirectoryHandle
 * references across page reloads.
 *
 * FileSystemDirectoryHandle is serializable per the File System Access API spec,
 * so it can be stored directly in IndexedDB.
 *
 * This is a plain class (not an Angular service) because the browser adapter
 * is instantiated via InjectionToken and doesn't participate in DI for itself.
 *
 * Schema:
 *   DB name:  "browser-handles"
 *   Version:  1
 *   Store:    "handles" — keyPath: "root" (string, e.g. "browser:km-test-2")
 */
import { idbRequestToPromise } from '@core/utils/idb-request';

export class HandleStore {
	private db: IDBDatabase | null = null;
	private openPromise: Promise<void> | null = null;

	private async ensureOpen(): Promise<IDBDatabase> {
		if (this.db) return this.db;

		this.openPromise ??= new Promise<void>((resolve, reject) => {
			const request = indexedDB.open('browser-handles', 1);

			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains('handles')) {
					db.createObjectStore('handles', { keyPath: 'root' });
				}
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onerror = () => {
				reject(
					new Error(
						request.error?.message ??
							'HandleStore: failed to open IndexedDB',
					),
				);
			};
		});

		await this.openPromise;
		return this.db as unknown as IDBDatabase;
	}

	/**
	 * Store a directory handle keyed by root identifier.
	 * The handle is serialized by the structured clone algorithm.
	 */
	async set(root: string, handle: FileSystemDirectoryHandle): Promise<void> {
		const db = await this.ensureOpen();
		const tx = db.transaction('handles', 'readwrite');
		const store = tx.objectStore('handles');
		await idbRequestToPromise(store.put({ root, handle }));
	}

	/**
	 * Retrieve a directory handle by root identifier.
	 * Returns undefined if no handle is stored for that root.
	 */
	async get(root: string): Promise<FileSystemDirectoryHandle | undefined> {
		const db = await this.ensureOpen();
		const tx = db.transaction('handles', 'readonly');
		const store = tx.objectStore('handles');
		const result = await idbRequestToPromise<unknown>(store.get(root));
		const entry = result as
			| {
					root: string;
					handle: FileSystemDirectoryHandle;
			  }
			| undefined;
		return entry?.handle;
	}

	/**
	 * Remove a stored handle by root identifier.
	 * Safe to call even if the key doesn't exist.
	 */
	async remove(root: string): Promise<void> {
		const db = await this.ensureOpen();
		const tx = db.transaction('handles', 'readwrite');
		const store = tx.objectStore('handles');
		await idbRequestToPromise(store.delete(root));
	}

	/**
	 * Get all stored root identifiers.
	 * Used during initialization to pre-populate the in-memory registry.
	 */
	async getAllKeys(): Promise<string[]> {
		const db = await this.ensureOpen();
		const tx = db.transaction('handles', 'readonly');
		const store = tx.objectStore('handles');
		return (await idbRequestToPromise(store.getAllKeys())) as string[];
	}
}
