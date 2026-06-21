import type { VaultStore } from '@vault/store';
import type { ActiveAdapterEntry } from './sync-types';
import type { FileEntry } from '@core/adapters/adapter.interface';
import { debugLog } from '@core/utils/debug-logger';

/**
 * Pulls remote entries from storage adapters into the vault.
 *
 * Handles: importing files, importing directories, orphan detection,
 * and permission-issue classification.
 * Errors are collected and thrown as AggregateError for the caller
 * (SyncEngineService) to handle.
 *
 * Orphan detection (deleting local files that don't exist on remote)
 * only runs on adapters that have completed at least one full pull cycle.
 * This prevents data loss on first connect when a new adapter is empty
 * or unreachable.
 */
export class SyncPullPhase {
	/**
	 * Tracks which adapter IDs have completed at least one full pull cycle.
	 * Orphan detection is skipped for adapters NOT in this set.
	 */
	private readonly completedFirstPull = new Set<string>();

	constructor(private readonly vault: VaultStore) {}

	async execute(adapters: ActiveAdapterEntry[]): Promise<void> {
		console.warn(
			`[Sync] Starting pull phase for ${String(adapters.length)} adapter(s)`,
		);
		const errors: string[] = [];

		for (const { adapter, root } of adapters) {
			try {
				await this.pullOneAdapter(adapter, root);
			} catch (err) {
				errors.push(this.classifyPullError(err, adapter.id));
			}
		}

		if (errors.length > 0) {
			throw new AggregateError(
				errors,
				'Sync pull phase completed with errors',
			);
		}
	}

	/**
	 * Pull from a single adapter: list, import, orphan-detect.
	 * Separated so error classification is one level up.
	 */
	private async pullOneAdapter(
		adapter: ActiveAdapterEntry['adapter'],
		root: string | undefined,
	): Promise<void> {
		const allEntries = await adapter.list('/', root, true);

		// Sort: directories first — ensures parent folder entries exist
		// before processing their children.
		allEntries.sort((a, b) =>
			a.isDirectory === b.isDirectory ? 0 : a.isDirectory ? -1 : 1,
		);

		const remotePaths = new Set(
			allEntries
				.filter((e: FileEntry) => !e.isDirectory)
				.map((e) => e.path),
		);

		debugLog(
			`[Sync] ${adapter.id} pull: ${String(allEntries.length)} entries ${JSON.stringify(allEntries.length < 50 ? allEntries.map((e) => e.path) : `${String(allEntries.length)} files total`)}`,
		);

		for (const entry of allEntries) {
			if (entry.isDirectory) {
				await this.vault.applyExternalFolder(entry.path, adapter.id);
			} else {
				const content = await adapter.read(entry.path, root);
				await this.vault.applyExternalFile(
					entry.path,
					content,
					adapter.id,
				);
			}
		}

		// Orphan detection: vault entries synced to this adapter but no
		// longer on remote were deleted externally — soft-delete locally.
		// Only runs after the first successful pull (adapter is already in
		// the completedFirstPull set) to prevent data loss on first connect.
		// E.g. a new git repo returns 0 entries — without this guard, the
		// orphan detector would delete the entire vault.
		if (this.completedFirstPull.has(adapter.id)) {
			const allVaultEntries = this.vault.files();
			debugLog(
				`[Sync] ${adapter.id} pull: orphan check — ${String(allVaultEntries.length)} vault files, ${String(remotePaths.size)} remote files`,
			);
			const orphans = allVaultEntries.filter(
				(e) =>
					!remotePaths.has(e.path) &&
					!e.pendingAdapters.includes(adapter.id),
			);
			if (orphans.length > 0) {
				debugLog(
					`[Sync] ${adapter.id} pull: ${String(orphans.length)} orphans ${JSON.stringify(orphans.map((e) => `"${e.path}"`))}`,
				);
				for (const vaultEntry of orphans) {
					await this.vault.delete(vaultEntry.id);
				}
			}
		} else {
			// First pull: mark vault entries NOT on remote as pending for this
			// adapter, so they get pushed (they pre-existed the adapter's arrival).
			// Without this, new adapters can silently miss files that were synced
			// to other adapters before the new one was added, and the next pull
			// would orphan-detect (delete) them from the vault.
			debugLog(
				`[Sync] ${adapter.id} pull: marking missing-from-remote entries as pending (first pull)`,
			);
			await this.vault.markPendingForAdapter(adapter.id, remotePaths);
		}

		// Mark this adapter as having completed its first pull cycle.
		// Done AFTER orphan check so the guard works on subsequent pulls.
		this.completedFirstPull.add(adapter.id);
	}

	/**
	 * Classify a pull error into a human-readable message.
	 * NotAllowedError means browser FS API needs re-grant;
	 * permission/forbidden means path access denied;
	 * everything else is a generic failure.
	 */
	private classifyPullError(err: unknown, adapterId: string): string {
		if (err instanceof DOMException && err.name === 'NotAllowedError') {
			const msg = `Sync permission needed for ${adapterId} — click Sync Now to re-grant access`;
			console.warn(`[Sync] ${msg}`);
			return msg;
		}
		if (
			err instanceof Error &&
			(err.message.includes('permission denied') ||
				err.message.includes('forbidden path'))
		) {
			const msg = `Sync skipped for ${adapterId}: ${err.message}`;
			console.warn(`[Sync] ${msg}`);
			return msg;
		}
		const msg = `Sync pull failed for ${adapterId}: ${err instanceof Error ? err.message : String(err)}`;
		console.error(`[Sync] ${msg}`, err);
		return msg;
	}
}
