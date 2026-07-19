import { describe, it, expect, vi, afterEach } from 'vitest';
import { VaultDatabase, TrashDatabase } from '@vault/vault-database';
import { makeVaultEntry } from '@vault/vault-utils';

/**
 * Schema/lifecycle contract for the vault databases.
 *
 * Adding the trash store as a *version bump of `vault-db`* once broke the app
 * hard: with any other connection open, the upgrade blocks, the open request
 * stays queued forever, and every later open in that page hangs behind it —
 * the vault renders empty while writes silently no-op. Trash therefore lives
 * in its own database, and `vault-db` opens at whatever version exists rather
 * than pinning one. These tests pin both properties.
 */
describe('VaultDatabase', () => {
	it('creates the entries store on a fresh open', async () => {
		const db = new VaultDatabase();
		await db.open();

		await db.put(
			makeVaultEntry({
				workspaceId: 'ws',
				name: 'a.md',
				path: 'a.md',
				pendingAdapters: [],
			}),
		);
		expect((await db.loadAll('ws')).length).toBe(1);
		db.close();
	});

	it('opens an existing v5 database without upgrading it', async () => {
		// Build the historical v5 schema with a row in it.
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open('vault-db', 5);
			req.onupgradeneeded = () => {
				const store = req.result.createObjectStore('entries', {
					keyPath: 'id',
				});
				store.createIndex('path', 'path', { unique: false });
				store.createIndex('parentId', 'parentId', { unique: false });
				store.createIndex('workspaceId', 'workspaceId', {
					unique: false,
				});
			};
			req.onsuccess = () => {
				const db = req.result;
				const tx = db.transaction('entries', 'readwrite');
				tx.objectStore('entries').put(
					makeVaultEntry({
						workspaceId: 'ws',
						name: 'keep.md',
						path: 'keep.md',
						pendingAdapters: [],
					}),
				);
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => {
					reject(new Error('seed failed'));
				};
			};
			req.onerror = () => {
				reject(new Error('v5 open failed'));
			};
		});

		const db = new VaultDatabase();
		await db.open();

		const entries = await db.loadAll('ws');
		expect(entries.length).toBe(1);
		expect(entries[0]?.name).toBe('keep.md');
		db.close();

		// Still v5 — no version-change transaction was needed, which is what
		// keeps a second tab from blocking startup.
		const version = await new Promise<number>((resolve) => {
			const req = indexedDB.open('vault-db');
			req.onsuccess = () => {
				const v = req.result.version;
				req.result.close();
				resolve(v);
			};
		});
		expect(version).toBe(5);
	});

	it('opens even while another connection is already held', async () => {
		// The exact shape of the original failure: a live connection during
		// startup. With no version pinned this must not block.
		const holder = await new Promise<IDBDatabase>((resolve) => {
			const req = indexedDB.open('vault-db', 5);
			req.onupgradeneeded = () => {
				req.result.createObjectStore('entries', {
					keyPath: 'id',
				}).createIndex('workspaceId', 'workspaceId', { unique: false });
			};
			req.onsuccess = () => {
				resolve(req.result);
			};
		});
		// Refuse to step aside, mimicking a stale tab.
		holder.onversionchange = () => undefined;

		const db = new VaultDatabase();
		await db.open();
		expect(await db.loadAll('ws')).toEqual([]);

		db.close();
		holder.close();
	});

	it('throws instead of silently no-opping when not open', async () => {
		const db = new VaultDatabase();
		const entry = makeVaultEntry({
			workspaceId: 'ws',
			name: 'a.md',
			path: 'a.md',
			pendingAdapters: [],
		});

		// A silent no-op here is indistinguishable from "the vault is empty".
		await expect(db.put(entry)).rejects.toThrow(/not open/i);
		await expect(db.loadAll('ws')).rejects.toThrow(/not open/i);
		await expect(db.clear()).rejects.toThrow(/not open/i);
	});

	it('rejects rather than hanging when the open never settles', async () => {
		// A wedged IndexedDB fires no event at all — not success, not error,
		// not blocked. Unbounded, that renders as a permanently empty vault
		// with nothing in the console. It must time out and report instead.
		vi.useFakeTimers();
		const realIdb = globalThis.indexedDB;
		globalThis.indexedDB = {
			open: () => ({}) as IDBOpenDBRequest,
		} as unknown as IDBFactory;

		const db = new VaultDatabase();
		const pending = db.open();
		const assertion = expect(pending).rejects.toThrow(
			/timed out opening vault-db/i,
		);
		await vi.advanceTimersByTimeAsync(11_000);
		await assertion;

		globalThis.indexedDB = realIdb;
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe('TrashDatabase', () => {
	it('is a separate database from vault-db', async () => {
		const trash = new TrashDatabase();
		await trash.open();
		await trash.putMany([
			{
				id: 't1',
				workspaceId: 'ws',
				batchId: 'b1',
				originalPath: 'a.md',
				name: 'a.md',
				type: 'file',
				deletedAt: Date.now(),
			},
		]);
		expect((await trash.loadAll('ws')).length).toBe(1);
		trash.close();

		// vault-db must be untouched by trash usage.
		const vault = new VaultDatabase();
		await vault.open();
		expect(await vault.loadAll('ws')).toEqual([]);
		vault.close();

		const names = (await indexedDB.databases()).map((d) => d.name);
		expect(names).toContain('trash-db');
	});

	it('round-trips and deletes records', async () => {
		const trash = new TrashDatabase();
		await trash.open();
		const base = {
			workspaceId: 'ws',
			batchId: 'b1',
			originalPath: 'a.md',
			name: 'a.md',
			type: 'file' as const,
			deletedAt: Date.now(),
		};
		await trash.putMany([
			{ ...base, id: 't1' },
			{ ...base, id: 't2' },
		]);
		expect((await trash.loadAll('ws')).length).toBe(2);

		await trash.deleteMany(['t1']);
		expect((await trash.loadAll('ws')).map((r) => r.id)).toEqual(['t2']);
		trash.close();
	});

	it('throws instead of silently no-opping when not open', async () => {
		const trash = new TrashDatabase();
		await expect(trash.loadAll('ws')).rejects.toThrow(/not open/i);
	});
});
