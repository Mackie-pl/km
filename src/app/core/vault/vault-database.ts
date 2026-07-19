import { idbRequestToPromise } from '@core/utils/idb-request';
import type { VaultEntry } from './vault-entry';
import type { TrashRecord } from './trash-record';

/**
 * Raw IndexedDB layer for vault entries.
 * Handles database lifecycle and low-level CRUD operations.
 * VaultStore delegates all DB I/O to this class.
 */
export class VaultDatabase {
	private db: IDBDatabase | null = null;

	/** False once the connection is closed (e.g. by another tab's upgrade). */
	get isOpen(): boolean {
		return this.db !== null;
	}

	/**
	 * Open the vault database.
	 *
	 * Deliberately opens at *whatever version already exists* rather than
	 * pinning a version number, and only upgrades when the `entries` store is
	 * actually missing. A fixed version means every existing user needs a
	 * version-change transaction, which any second tab or stale connection
	 * blocks — and a blocked open request stays queued forever, poisoning
	 * every later open in that page. Since the schema is additive-only, "open
	 * what's there, create the store if absent" avoids that entirely.
	 *
	 * Auxiliary data lives in its own database (see TrashDatabase) so adding
	 * a feature never forces a migration of the entries store.
	 */
	async open(): Promise<void> {
		let db = await openAtCurrentVersion('vault-db');

		if (!db.objectStoreNames.contains('entries')) {
			const nextVersion = db.version + 1;
			db.close();
			db = await upgradeTo('vault-db', nextVersion, (upgraded) => {
				const store = upgraded.createObjectStore('entries', {
					keyPath: 'id',
				});
				store.createIndex('path', 'path', { unique: false });
				store.createIndex('parentId', 'parentId', { unique: false });
				store.createIndex('workspaceId', 'workspaceId', {
					unique: false,
				});
			});
		}

		// Step aside if another tab ever does need an upgrade, instead of
		// blocking it indefinitely with this connection.
		db.onversionchange = () => {
			db.close();
			this.db = null;
		};
		this.db = db;
	}

	/** The open connection, or throw a clear error if the DB isn't ready. */
	#requireDb(): IDBDatabase {
		if (!this.db) {
			throw new Error(
				'vault-db is not open — the database failed to initialize. ' +
					'Vault changes cannot be persisted.',
			);
		}
		return this.db;
	}

	/** Load all entries for a given workspace. */
	async loadAll(wsId: string): Promise<VaultEntry[]> {
		const tx = this.#requireDb().transaction('entries', 'readonly');
		const store = tx.objectStore('entries');
		const index = store.index('workspaceId');
		const request = index.getAll(wsId) as IDBRequest<VaultEntry[]>;
		return idbRequestToPromise(request);
	}

	/** Persist a single entry — insert or update. */
	async put(entry: VaultEntry): Promise<void> {
		const tx = this.#requireDb().transaction('entries', 'readwrite');
		const store = tx.objectStore('entries');
		const request = store.put(entry);
		await idbRequestToPromise(request);
	}

	/** Delete all entries for a given workspace. Used when removing a workspace. */
	async deleteAllByWorkspaceId(wsId: string): Promise<void> {
		const entries = await this.loadAll(wsId);
		if (entries.length === 0) return;

		const tx = this.#requireDb().transaction('entries', 'readwrite');
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
		const tx = this.#requireDb().transaction('entries', 'readwrite');
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

/**
 * Device-local trash: snapshots of deleted entries, recoverable for a
 * retention window. Never synced.
 *
 * Its own database rather than a store inside `vault-db` — adding it there
 * would force a version upgrade of the entries store on every existing
 * install, which a second tab or stale connection can block indefinitely.
 * This matches how the other auxiliary stores in the app are structured
 * (gdrive-token-store, browser-handles, the git stores).
 */
export class TrashDatabase {
	private db: IDBDatabase | null = null;

	async open(): Promise<void> {
		let db = await openAtCurrentVersion('trash-db');

		if (!db.objectStoreNames.contains('trash')) {
			const nextVersion = db.version + 1;
			db.close();
			db = await upgradeTo('trash-db', nextVersion, (upgraded) => {
				const store = upgraded.createObjectStore('trash', {
					keyPath: 'id',
				});
				store.createIndex('workspaceId', 'workspaceId', {
					unique: false,
				});
				store.createIndex('deletedAt', 'deletedAt', { unique: false });
			});
		}

		db.onversionchange = () => {
			db.close();
			this.db = null;
		};
		this.db = db;
	}

	#requireDb(): IDBDatabase {
		if (!this.db) {
			throw new Error(
				'trash-db is not open — the database failed to initialize.',
			);
		}
		return this.db;
	}

	/** Load all trash records for a workspace. */
	async loadAll(wsId: string): Promise<TrashRecord[]> {
		const tx = this.#requireDb().transaction('trash', 'readonly');
		const index = tx.objectStore('trash').index('workspaceId');
		const request = index.getAll(wsId) as IDBRequest<TrashRecord[]>;
		return idbRequestToPromise(request);
	}

	/** Persist trash records (insert or update) in one transaction. */
	async putMany(records: TrashRecord[]): Promise<void> {
		if (records.length === 0) return;
		const tx = this.#requireDb().transaction('trash', 'readwrite');
		const store = tx.objectStore('trash');
		for (const record of records) {
			store.put(record);
		}
		return txToPromise(tx);
	}

	/** Delete trash records by id in one transaction. */
	async deleteMany(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const tx = this.#requireDb().transaction('trash', 'readwrite');
		const store = tx.objectStore('trash');
		for (const id of ids) {
			store.delete(id);
		}
		return txToPromise(tx);
	}

	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}
}

/**
 * How long to wait for an open request before treating the database as
 * wedged. An `indexedDB.open` can hang indefinitely with no event of any
 * kind — a version-change request queued by another connection blocks every
 * later open in the profile, and survives reloads and new tabs. Left
 * unbounded that renders as a silently empty vault, so bound it and report.
 */
const OPEN_TIMEOUT_MS = 10_000;

/**
 * Open a database at whatever version currently exists (creating it at
 * version 1 if absent). Never triggers a version-change transaction on an
 * existing database, so it can't itself be blocked by other connections —
 * but it can still queue behind someone else's pending upgrade, hence the
 * timeout.
 */
function openAtCurrentVersion(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name);
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(
				new Error(
					`Timed out opening ${name}. The database is blocked by another ` +
						'connection — close every tab running this app, or clear site ' +
						'data for this origin, then reload. Your notes on disk are ' +
						'unaffected and will re-import.',
				),
			);
		}, OPEN_TIMEOUT_MS);

		request.onsuccess = () => {
			if (settled) {
				// Arrived after the timeout — don't leak the connection.
				request.result.close();
				return;
			}
			settled = true;
			clearTimeout(timer);
			resolve(request.result);
		};
		request.onerror = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(
				new Error(
					`Failed to open ${name}: ${request.error?.message ?? 'unknown error'}`,
				),
			);
		};
		request.onblocked = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(
				new Error(
					`${name} is blocked by another connection. Close every tab ` +
						'running this app and reload.',
				),
			);
		};
	});
}

/** Open at `version`, running `createStores` in the upgrade transaction. */
function upgradeTo(
	name: string,
	version: number,
	createStores: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name, version);
		let settled = false;

		const fail = (message: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(new Error(message));
		};

		const timer = setTimeout(() => {
			fail(
				`Timed out upgrading ${name}. Close every tab running this app ` +
					'and reload.',
			);
		}, OPEN_TIMEOUT_MS);

		request.onupgradeneeded = () => {
			createStores(request.result);
		};
		request.onsuccess = () => {
			if (settled) {
				request.result.close();
				return;
			}
			settled = true;
			clearTimeout(timer);
			resolve(request.result);
		};
		request.onerror = () => {
			fail(
				`Failed to upgrade ${name} to v${String(version)}: ${request.error?.message ?? 'unknown error'}`,
			);
		};
		// Only reachable when the store is genuinely missing and another
		// connection is open — rare, and actionable rather than silent.
		request.onblocked = () => {
			fail(
				`${name} is open in another tab and must be upgraded. ` +
					'Close other tabs running this app and reload.',
			);
		};
	});
}

/** Resolve when a readwrite transaction commits. */
function txToPromise(tx: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => {
			resolve();
		};
		tx.onerror = () => {
			reject(new Error(tx.error?.message ?? 'Transaction failed'));
		};
	});
}
