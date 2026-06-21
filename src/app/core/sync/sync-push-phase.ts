import { isTempFilePath } from '@core/utils/file-patterns';
import {
	VAULT_ENTRY_TYPES,
	type VaultStore,
	type VaultEntry,
} from '@vault/store';
import type { ActiveAdapterEntry } from './sync-types';
import type { Adapter } from '@core/adapters/adapter.interface';
import { debugLog } from '@core/utils/debug-logger';

/**
 * Pushes pending vault entries to storage adapters.
 *
 * Handles: file writes, deletes, renames, and folder creation.
 * Errors are collected and thrown as AggregateError for the caller
 * (SyncEngineService) to handle (signals, recovery, retry).
 *
 * When every entry for a given adapter fails in a single cycle, the
 * adapter is skipped for subsequent entries to reduce console noise
 * and avoid cascading failures (e.g. missing git refs).
 */
export class SyncPushPhase {
	constructor(private readonly vault: VaultStore) {}

	async execute(adapters: ActiveAdapterEntry[]): Promise<void> {
		const entries = this.vault.entriesNeedingSync();
		const errors: string[] = [];

		if (entries.length > 0) {
			debugLog(
				`[Sync] push pending: ${String(entries.length)} entries ${JSON.stringify(entries.map((e) => ({ id: e.id, path: e.path, action: e.deleted ? 'delete' : e.pendingRenameFrom ? 'rename→' + e.pendingRenameFrom : e.type === 'folder' ? 'mkdir' : 'write' })))}`,
			);
		}

		for (const { adapter, root } of adapters) {
			const pending = this.#getPendingEntries(entries, adapter.id);
			if (pending.length === 0) continue;

			const pushErrors = await this.#pushToAdapter(
				pending,
				adapter,
				root,
			);
			errors.push(...pushErrors);
		}

		if (errors.length > 0) {
			throw new AggregateError(
				errors,
				'Sync push phase completed with errors',
			);
		}
	}

	/** Filter entries pending for this adapter. */
	#getPendingEntries(entries: VaultEntry[], adapterId: string): VaultEntry[] {
		return entries.filter(
			(e) =>
				e.pendingAdapters.includes(adapterId) &&
				!isTempFilePath(e.name),
		);
	}

	/**
	 * Push all pending entries to a single adapter.
	 * If every entry fails, remaining entries are skipped with a single warning.
	 */
	async #pushToAdapter(
		pending: VaultEntry[],
		adapter: Adapter,
		root?: string,
	): Promise<string[]> {
		const errors: string[] = [];
		let adapterBroken = false;

		for (const entry of pending) {
			if (adapterBroken) break;

			try {
				await this.#pushEntry(entry, adapter, root);
				await this.vault.markAdapterSynced(entry.id, adapter.id);
				debugLog(
					`[Sync] push ok "${entry.path}" → ${adapter.id} (rev ${String(entry.revision)})`,
				);
			} catch (err) {
				const msg = `Push failed for ${entry.path} on ${adapter.id}: ${err instanceof Error ? err.message : String(err)}`;
				console.error(`[Sync] ${msg}`, err);
				errors.push(msg);
				adapterBroken = true;
			}
		}

		if (adapterBroken && pending.length > 1) {
			const skipped = pending.length - 1;
			console.warn(
				`[Sync] Skipping ${String(skipped)} remaining entries for ${adapter.id} — adapter appears broken this cycle`,
			);
		}

		return errors;
	}

	/** Push a single entry to its adapter — handles deleted, rename, folder, and file cases. */
	async #pushEntry(
		entry: VaultEntry,
		adapter: Adapter,
		root?: string,
	): Promise<void> {
		if (entry.deleted) {
			await adapter.delete(entry.path, root);
		} else if (entry.pendingRenameFrom) {
			await this.#pushRenameOrFallback(entry, adapter, root);
		} else if (
			entry.type === VAULT_ENTRY_TYPES.FOLDER &&
			adapter.createDir
		) {
			await adapter.createDir(entry.path, root);
		} else if (entry.type === VAULT_ENTRY_TYPES.FOLDER) {
			// Adapter doesn't support directories — skip.
			// File writes will auto-create parent dirs via write().
			return;
		} else {
			await adapter.write(entry.path, entry.content ?? '', root);
		}
	}

	/**
	 * Attempt a rename on the adapter. If it fails (e.g. the source file never
	 * existed on this adapter), clear the rename flag and fall back to writing
	 * the content directly — same cycle, no extra debounce.
	 */
	async #pushRenameOrFallback(
		entry: VaultEntry,
		adapter: Adapter,
		root?: string,
	): Promise<void> {
		const renameFrom = entry.pendingRenameFrom;
		if (!renameFrom) {
			// Edge case: pendingRenameFrom cleared between filter and execution.
			// Fall through to a normal write.
			await adapter.write(entry.path, entry.content ?? '', root);
			return;
		}

		try {
			await adapter.rename(renameFrom, entry.path, root);
		} catch (err) {
			console.warn(
				`[Sync] Rename failed for "${renameFrom}" → "${entry.path}" on ${adapter.id} — falling back to write`,
				err,
			);
			await this.vault.clearPendingRename(entry.id);
			await adapter.write(entry.path, entry.content ?? '', root);
		}
	}
}
