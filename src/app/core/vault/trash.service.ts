import { Injectable, computed, inject, signal } from '@angular/core';
import { VAULT_ENTRY_TYPES, VaultStore } from './store';
import { TrashDatabase } from './vault-database';
import type { TrashRecord } from './trash-record';

/** How long trashed entries are recoverable on this device. */
export const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One row in the Trash tab: a delete action (file, or folder + contents). */
export interface TrashBatch {
	batchId: string;
	/** The top-level record of the batch (shortest path). */
	root: TrashRecord;
	/** Total records in the batch (1 for a single file). */
	count: number;
	deletedAt: number;
	daysRemaining: number;
}

/**
 * Device-local trash. `deleteToTrash` snapshots an entry (and, for folders,
 * its subtree) into the `trash` object store, then runs the normal delete —
 * which still propagates to remotes. Records expire after
 * `TRASH_RETENTION_DAYS`; recovery is only possible on this device.
 *
 * Sync-driven deletions (orphan detection, reconciler) bypass this service
 * on purpose — a remote delete does not fill this device's trash.
 */
@Injectable({ providedIn: 'root' })
export class TrashService {
	private readonly vault = inject(VaultStore);

	/** Own database — never part of `vault-db`'s schema. */
	readonly #database = new TrashDatabase();
	#openPromise: Promise<void> | null = null;

	/** Raw records for the active workspace; call `load()` to populate. */
	readonly records = signal<TrashRecord[]>([]);

	/** Open the trash database once; retryable if it fails. */
	async #db(): Promise<TrashDatabase> {
		this.#openPromise ??= this.#database.open();
		try {
			await this.#openPromise;
		} catch (err) {
			this.#openPromise = null;
			throw err;
		}
		return this.#database;
	}

	/** Records grouped per delete action, newest first, for the Trash tab. */
	readonly batches = computed<TrashBatch[]>(() => {
		const byBatch = new Map<string, TrashRecord[]>();
		for (const record of this.records()) {
			const group = byBatch.get(record.batchId);
			if (group) group.push(record);
			else byBatch.set(record.batchId, [record]);
		}
		const now = Date.now();
		return Array.from(byBatch.entries())
			.map(([batchId, group]) => {
				const root = group.reduce((a, b) =>
					b.originalPath.length < a.originalPath.length ? b : a,
				);
				return {
					batchId,
					root,
					count: group.length,
					deletedAt: root.deletedAt,
					daysRemaining: Math.max(
						0,
						Math.ceil(
							(root.deletedAt + TRASH_RETENTION_MS - now) /
								DAY_MS,
						),
					),
				};
			})
			.sort((a, b) => b.deletedAt - a.deletedAt);
	});

	/** Snapshot an entry (+ descendants) into trash, then delete it. */
	async deleteToTrash(id: string): Promise<void> {
		const entry = this.vault.getById(id);
		if (!entry || entry.deleted) return;

		const batch = [entry];
		if (entry.type === VAULT_ENTRY_TYPES.FOLDER) {
			for (const e of this.vault.getEntriesSnapshot().values()) {
				if (
					e.workspaceId === entry.workspaceId &&
					!e.deleted &&
					e.path.startsWith(entry.path + '/')
				) {
					batch.push(e);
				}
			}
		}

		const batchId = crypto.randomUUID();
		const deletedAt = Date.now();
		const records: TrashRecord[] = batch.map((e) => ({
			id: e.id,
			workspaceId: e.workspaceId,
			batchId,
			originalPath: e.path,
			name: e.name,
			type: e.type,
			...(e.content !== undefined ? { content: e.content } : {}),
			deletedAt,
		}));

		const db = await this.#db();
		await db.putMany(records);
		await this.vault.delete(id);
		await this.load();
	}

	/**
	 * Recreate a batch's entries in the vault (folders first, shallow→deep)
	 * and drop its trash records. Entries get fresh ids and pending adapters,
	 * so they push back to every remote; path collisions auto-dedup.
	 */
	async restore(batchId: string): Promise<void> {
		const group = this.records().filter((r) => r.batchId === batchId);
		if (group.length === 0) return;

		const folders = group
			.filter((r) => r.type === VAULT_ENTRY_TYPES.FOLDER)
			.sort((a, b) => pathDepth(a.originalPath) - pathDepth(b.originalPath));
		const files = group.filter((r) => r.type === VAULT_ENTRY_TYPES.FILE);

		for (const folder of folders) {
			await this.vault.ensureFolderPath(folder.originalPath);
		}
		for (const file of files) {
			const parent = file.originalPath
				.split('/')
				.slice(0, -1)
				.join('/');
			await this.vault.ensureFolderPath(parent);
			await this.vault.createFile(file.originalPath, file.content ?? '');
		}

		const db = await this.#db();
		await db.deleteMany(group.map((r) => r.id));
		await this.load();
	}

	/** Permanently delete one batch. Irreversible — confirm in the UI. */
	async deleteForever(batchId: string): Promise<void> {
		const ids = this.records()
			.filter((r) => r.batchId === batchId)
			.map((r) => r.id);
		const db = await this.#db();
		await db.deleteMany(ids);
		await this.load();
	}

	/** Permanently delete every record in the active workspace's trash. */
	async emptyTrash(): Promise<void> {
		const db = await this.#db();
		await db.deleteMany(this.records().map((r) => r.id));
		await this.load();
	}

	/** Refresh `records` for the active workspace, purging expired ones. */
	async load(): Promise<void> {
		const wsId = this.vault.activeWorkspaceId();
		if (!wsId) {
			this.records.set([]);
			return;
		}
		const db = await this.#db();
		const all = await db.loadAll(wsId);

		const cutoff = Date.now() - TRASH_RETENTION_MS;
		const expired = all.filter((r) => r.deletedAt < cutoff);
		if (expired.length > 0) {
			await db.deleteMany(expired.map((r) => r.id));
		}

		this.records.set(all.filter((r) => r.deletedAt >= cutoff));
	}
}

function pathDepth(path: string): number {
	return path.split('/').length;
}
