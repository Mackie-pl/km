import { effect, inject, Injectable, signal, type OnDestroy } from '@angular/core';
import { AdaptersManager } from '@core/adapters/manager';
import { WorkspaceService } from '@core/services/workspace.service';
import { timeout } from '@core/utils/async';
import { VaultStore, VAULT_ENTRY_TYPES } from '@vault/store';
import {
	Adapter,
	WatchEvent,
	FileEntry,
} from '@core/adapters/adapter.interface';

interface ActiveAdapterEntry {
	adapter: Adapter;
	root: string | undefined;
}

@Injectable({
	providedIn: 'root',
})
export class SyncEngineService implements OnDestroy {
	private scheduled = false;
	private pulling = false;
	private watching = false;

	/** Cleanup functions returned by each adapter's watch() subscription. */
	private watchCleanups: (() => void)[] = [];

	// ──────────────────────────────────────────────
	// Reactive state (consumed by the header)
	// ──────────────────────────────────────────────

	/** Whether a background auto-sync cycle has failed. */
	readonly syncFailed = signal(false);

	/** Whether a sync operation (push/pull/syncAll) is in flight. */
	readonly isSyncing = signal(false);

	/** Human-readable description of the last sync error (null = no error). */
	readonly lastSyncError = signal<string | null>(null);

	/** Reset error state — called after a successful sync cycle. */
	clearSyncError(): void {
		this.syncFailed.set(false);
		this.lastSyncError.set(null);
	}

	private readonly vault = inject(VaultStore);
	private readonly manager = inject(AdaptersManager);
	private readonly workspaceService = inject(WorkspaceService);

	constructor() {
		// Auto-push on entries needing sync
		effect(() => {
			const needingSync = this.vault.entriesNeedingSync();
			if (needingSync.length > 0) void this.scheduleSync();
		});

		// Pull + watch on workspace activation; unwind on deactivation
		effect(() => {
			const ws = this.workspaceService.activeWorkspace();
			if (ws) {
				void this.forcePull();
				void this.startWatching();
			} else {
				this.stopWatching();
			}
		});
	}

	/** Unsubscribe from all watchers on destroy. */
	ngOnDestroy(): void {
		this.stopWatching();
	}

	// ──────────────────────────────────────────────
	// Public API
	// ──────────────────────────────────────────────

	/**
	 * Schedule a push cycle (debounced by 1s).
	 * Safe to call multiple times — only one cycle runs at a time.
	 */
	async scheduleSync(): Promise<void> {
		if (this.scheduled) return;
		this.scheduled = true;
		await timeout(1000);
		this.scheduled = false;
		void this.runSync();
	}

	/**
	 * Force a pull cycle immediately (no debounce).
	 * Used on workspace activation and by manual refresh.
	 * Sets syncFailed / clears error on completion.
	 */
	async forcePull(): Promise<void> {
		if (this.pulling) return;
		this.pulling = true;
		this.isSyncing.set(true);
		try {
			const adapters = this.getActiveAdapters();
			await this.registerScopes(adapters);
			await this.pullPhase(adapters);
			// Auto-recovery: successful pull clears previous errors
			this.clearSyncError();
		} catch (err) {
			this.syncFailed.set(true);
			this.lastSyncError.set(this.formatError(err));
		} finally {
			this.pulling = false;
			this.isSyncing.set(false);
		}
	}

	/**
	 * Pull then push — used by manual "Sync now" button.
	 * Waits for both phases to complete before resolving.
	 * Sets syncFailed / clears error on completion.
	 */
	async syncAll(): Promise<void> {
		this.isSyncing.set(true);
		try {
			// Register scopes (needs user gesture for FS API permission on some platforms)
			const adapters = this.getActiveAdapters();
			await this.registerScopes(adapters);

			// Pull first: imports external changes into the vault
			await this.pullPhase(adapters);

			// Push second: applies any pending vault changes to adapters
			await this.pushPhase(adapters);

			// Success — clear any previous error state
			this.clearSyncError();
		} catch (err) {
			this.syncFailed.set(true);
			this.lastSyncError.set(this.formatError(err));
			throw err; // rethrow so callers (header, tests) know it failed
		} finally {
			this.isSyncing.set(false);
		}
	}

	/**
	 * Start filesystem watchers for all active adapters that support watch().
	 * Safe to call multiple times — only subscribes once.
	 */
	async startWatching(): Promise<void> {
		if (this.watching) return;
		this.watching = true;

		try {
			for (const { adapter, root } of this.getActiveAdapters()) {
				if (!adapter.watch) continue;

				const unsubscribe = await adapter.watch(
					(events: WatchEvent[]) => {
						void this.handleExternalChanges(events, adapter, root);
					},
					root,
				);
				this.watchCleanups.push(unsubscribe);
			}
		} catch (err) {
			console.error('[Sync] Failed to start watching:', err);
			this.syncFailed.set(true);
			this.lastSyncError.set(this.formatError(err));
		}
	}

	/**
	 * Unsubscribe from all adapter watchers.
	 */
	stopWatching(): void {
		for (const cleanup of this.watchCleanups) {
			try {
				cleanup();
			} catch {
				// Ignore cleanup errors
			}
		}
		this.watchCleanups = [];
		this.watching = false;
	}

	// ──────────────────────────────────────────────
	// Sync orchestration
	// ──────────────────────────────────────────────

	/**
	 * Only push — triggered by entriesNeedingSync changes.
	 * (Pull is handled separately by forcePull on activation.)
	 * Clears error on success (auto-recovery), sets on failure.
	 */
	private async runSync(): Promise<void> {
		const adapters = this.getActiveAdapters();
		if (adapters.length === 0) return;

		this.isSyncing.set(true);
		try {
			await this.pushPhase(adapters);
			// Auto-recovery: successful push clears previous errors
			this.clearSyncError();
		} catch (err) {
			this.syncFailed.set(true);
			this.lastSyncError.set(this.formatError(err));
		} finally {
			this.isSyncing.set(false);
		}
	}

	// ──────────────────────────────────────────────
	// Push phase
	// ──────────────────────────────────────────────

	private async pushPhase(adapters: ActiveAdapterEntry[]): Promise<void> {
		const entries = this.vault.entriesNeedingSync();
		const errors: string[] = [];

		for (const { adapter, root } of adapters) {
			const pending = entries.filter((e) =>
				e.pendingAdapters.includes(adapter.id),
			);
			if (pending.length === 0) continue;

			for (const entry of pending) {
				try {
					console.log(
						`[Sync] Pushing "${entry.path}" to ${adapter.id} (deleted: ${String(entry.deleted)}, pendingRenameFrom: ${String(entry.pendingRenameFrom)})`,
						entry,
					);
					if (entry.deleted) {
						await adapter.delete(entry.path, root);
					} else if (entry.pendingRenameFrom) {
						const renameFrom: string = entry.pendingRenameFrom;
						// Use rename() on the adapter so the old file/dir is removed atomically
						await adapter.rename(renameFrom, entry.path, root);
					} else if (
						entry.type === VAULT_ENTRY_TYPES.FOLDER &&
						adapter.createDir
					) {
						await adapter.createDir(entry.path, root);
					} else if (entry.type === VAULT_ENTRY_TYPES.FOLDER) {
						// Adapter doesn't support directories — skip.
						// File writes will auto-create parent dirs via write().
						await this.vault.markAdapterSynced(
							entry.id,
							adapter.id,
						);
					} else {
						await adapter.write(
							entry.path,
							entry.content ?? '',
							root,
						);
					}
					await this.vault.markAdapterSynced(entry.id, adapter.id);
				} catch (err) {
					const msg = `Push failed for ${entry.path} on ${adapter.id}: ${err instanceof Error ? err.message : String(err)}`;
					console.error(`[Sync] ${msg}`, err);
					errors.push(msg);
					// Don't mark synced — will retry next cycle
				}
			}
		}

		if (errors.length > 0) {
			throw new AggregateError(errors, 'Sync push phase completed with errors');
		}
	}

	// ──────────────────────────────────────────────
	// Pull phase
	// ──────────────────────────────────────────────

	private async pullPhase(adapters: ActiveAdapterEntry[]): Promise<void> {
		console.log(
			`[Sync] Starting pull phase for ${String(adapters.length)} adapter(s)`,
		);
		const errors: string[] = [];

		for (const { adapter, root } of adapters) {
			try {
				const allEntries = await adapter.list('/', root, true);

				// Sort: directories first — ensures parent folder entries exist
				// before processing their children.
				allEntries.sort((a, b) =>
					a.isDirectory === b.isDirectory
						? 0
						: a.isDirectory
							? -1
							: 1,
				);

				const remotePaths = new Set(
					allEntries
						.filter((e: FileEntry) => !e.isDirectory)
						.map((e) => e.path),
				);

				// Import each remote entry through the canonical reconciliation path.
				// Directories first (sorted above), then files.
				console.log(
					`[Sync] Pulling ${String(allEntries.length)} entries from ${adapter.id}...`,
				);
				for (const entry of allEntries) {
					if (entry.isDirectory) {
						await this.vault.applyExternalFolder(
							entry.path,
							adapter.id,
						);
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
				// longer on remote were deleted externally — soft-delete locally
				// (watch may have missed the event). We delete via the vault so
				// the deletion cascades to children if it's a folder.
				const allVaultEntries = this.vault.files();
				for (const vaultEntry of allVaultEntries) {
					if (
						!remotePaths.has(vaultEntry.path) &&
						!vaultEntry.pendingAdapters.includes(adapter.id)
					) {
						await this.vault.delete(vaultEntry.id);
					}
				}
			} catch (err) {
				// NotAllowedError = browser FS API permission not available yet
				// (e.g., after reload, no user gesture to re-grant yet).
				let msg: string;
				if (
					err instanceof DOMException &&
					err.name === 'NotAllowedError'
				) {
					msg = `Sync permission needed for ${adapter.id} — click Sync Now to re-grant access`;
					console.warn(`[Sync] ${msg}`);
				} else if (
					err instanceof Error &&
					(err.message.includes('permission denied') ||
						err.message.includes('forbidden path'))
				) {
					msg = `Sync skipped for ${adapter.id}: ${err.message}`;
					console.warn(`[Sync] ${msg}`);
				} else {
					msg = `Sync pull failed for ${adapter.id}: ${err instanceof Error ? err.message : String(err)}`;
					console.error(`[Sync] ${msg}`, err);
				}
				errors.push(msg);
			}
		}

		if (errors.length > 0) {
			throw new AggregateError(
				errors,
				'Sync pull phase completed with errors',
			);
		}
	}

	// ──────────────────────────────────────────────
	// Inbound watch events
	// ──────────────────────────────────────────────

	/**
	 * React to filesystem change events from an adapter's watch() subscription.
	 *
	 * Flow:
	 * ```text
	 * WatchEvent → read canonical file → VaultStore.applyExternalFile() → signal update → UI
	 * ```
	 */
	private async handleExternalChanges(
		events: WatchEvent[],
		adapter: Adapter,
		root?: string,
	): Promise<void> {
		console.log(
			`[Sync] Received ${String(events.length)} external change(s) from ${adapter.id}:`,
			events,
		);
		for (const event of events) {
			try {
				if (event.type === 'rename' && event.oldPath) {
					const oldPath: string = event.oldPath;
					// External rename detected via watch
					await this.vault.applyExternalRename(
						oldPath,
						event.path,
						adapter.id,
					);
				} else if (event.type === 'delete') {
					const local = this.vault.getByPath(event.path);
					if (local && !local.deleted) {
						await this.vault.delete(local.id);
					}
				} else {
					// Read the canonical file from the adapter that detected the change
					const content = await adapter.read(event.path, root);
					await this.vault.applyExternalFile(
						event.path,
						content,
						adapter.id,
					);
				}
			} catch (err) {
				console.error(
					`[Sync] Failed to handle external change on ${adapter.id}:${event.path}:`,
					err,
				);
			}
		}
	}

	// ──────────────────────────────────────────────
	// Helpers
	// ──────────────────────────────────────────────

	/**
	 * Call registerScope on each adapter that supports it.
	 * This authorizes the root path with the platform's permission scope
	 * (e.g. Tauri's FS scope) before any read/write operations.
	 */
	private async registerScopes(
		adapters: ActiveAdapterEntry[],
	): Promise<void> {
		for (const { adapter, root } of adapters) {
			if (adapter.registerScope && root) {
				try {
					await adapter.registerScope(root);
				} catch (err) {
					console.warn(
						`[Sync] Failed to register scope for ${adapter.id}:`,
						err,
					);
				}
			}
		}
	}

	/**
	 * Build the list of active adapter instances with their root paths.
	 */
	private getActiveAdapters(): ActiveAdapterEntry[] {
		const ws = this.workspaceService.activeWorkspace();
		if (!ws) return [];

		return ws.activeSyncAdapters
			.map((id) => {
				const list = this.manager.getAdaptersByIds([id]);
				const a = list[0];
				if (!a) return null;
				const config = ws.adapterConfigs.find(
					(c) => c.adapterId === id,
				);
				return {
					adapter: a,
					root: config?.path,
				};
			})
			.filter((e): e is ActiveAdapterEntry => e !== null);
	}

	/**
	 * Convert a caught error to a human-readable string.
	 */
	private formatError(err: unknown): string {
		if (err instanceof DOMException && err.name === 'NotAllowedError') {
			return 'Sync permission needed — click to re-grant access';
		}
		if (err instanceof AggregateError) {
			return err.message;
		}
		if (err instanceof Error) {
			return err.message;
		}
		return String(err);
	}
}
