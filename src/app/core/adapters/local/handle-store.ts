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
		return new Promise<void>((resolve, reject) => {
			const tx = db.transaction('handles', 'readwrite');
			const store = tx.objectStore('handles');
			const request = store.put({ root, handle });

			request.onsuccess = () => {
				resolve();
			};
			request.onerror = () => {
				reject(new Error(request.error?.message));
			};
		});
	}

	/**
	 * Retrieve a directory handle by root identifier.
	 * Returns undefined if no handle is stored for that root.
	 */
	async get(root: string): Promise<FileSystemDirectoryHandle | undefined> {
		const db = await this.ensureOpen();
		return new Promise<FileSystemDirectoryHandle | undefined>(
			(resolve, reject) => {
				const tx = db.transaction('handles', 'readonly');
				const store = tx.objectStore('handles');
				const request = store.get(root);

				request.onsuccess = () => {
					const entry = request.result as
						| {
								root: string;
								handle: FileSystemDirectoryHandle;
						  }
						| undefined;
					resolve(entry?.handle);
				};
				request.onerror = () => {
					reject(new Error(request.error?.message));
				};
			},
		);
	}

	/**
	 * Remove a stored handle by root identifier.
	 * Safe to call even if the key doesn't exist.
	 */
	async remove(root: string): Promise<void> {
		const db = await this.ensureOpen();
		return new Promise<void>((resolve, reject) => {
			const tx = db.transaction('handles', 'readwrite');
			const store = tx.objectStore('handles');
			const request = store.delete(root);

			request.onsuccess = () => {
				resolve();
			};
			request.onerror = () => {
				reject(new Error(request.error?.message));
			};
		});
	}

	/**
	 * Get all stored root identifiers.
	 * Used during initialization to pre-populate the in-memory registry.
	 */
	async getAllKeys(): Promise<string[]> {
		const db = await this.ensureOpen();
		return new Promise<string[]>((resolve, reject) => {
			const tx = db.transaction('handles', 'readonly');
			const store = tx.objectStore('handles');
			const request = store.getAllKeys();

			request.onsuccess = () => {
				resolve(request.result as string[]);
			};
			request.onerror = () => {
				reject(new Error(request.error?.message));
			};
		});
	}
}
