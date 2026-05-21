import { effect, inject, Injectable, type OnDestroy } from '@angular/core';
import { AdaptersManager } from '@core/adapters/manager';
import { WorkspaceService } from '@core/services/workspace.service';
import { timeout } from '@core/utils/async';
import { VaultStore } from '@vault/store';
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
	 */
	async forcePull(): Promise<void> {
		if (this.pulling) return;
		this.pulling = true;
		try {
			const adapters = this.getActiveAdapters();
			await this.pullPhase(adapters);
		} finally {
			this.pulling = false;
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
	 */
	private async runSync(): Promise<void> {
		const adapters = this.getActiveAdapters();
		if (adapters.length === 0) return;

		await this.pushPhase(adapters);
	}

	// ──────────────────────────────────────────────
	// Push phase
	// ──────────────────────────────────────────────

	private async pushPhase(adapters: ActiveAdapterEntry[]): Promise<void> {
		const entries = this.vault.entriesNeedingSync();

		for (const { adapter, root } of adapters) {
			const pending = entries.filter((e) =>
				e.pendingAdapters.includes(adapter.id),
			);
			if (pending.length === 0) continue;

			for (const entry of pending) {
				try {
					if (entry.deleted) {
						await adapter.delete(entry.path, root);
					} else {
						await adapter.write(
							entry.path,
							entry.content ?? '',
							root,
						);
					}
					await this.vault.markAdapterSynced(entry.id, adapter.id);
				} catch (err) {
					console.error(
						`[Sync] Push failed for ${entry.path} on ${adapter.id}:`,
						err,
					);
					// Don't mark synced — will retry next cycle
				}
			}
		}
	}

	// ──────────────────────────────────────────────
	// Pull phase
	// ──────────────────────────────────────────────

	private async pullPhase(adapters: ActiveAdapterEntry[]): Promise<void> {
		for (const { adapter, root } of adapters) {
			try {
				const remoteFiles = (await adapter.list('/', root)).filter(
					(e: FileEntry) => !e.isDirectory,
				);

				// Import each remote file through the canonical reconciliation path.
				// applyExternalFile handles: new files, conflicts, clean overwrites.
				for (const rf of remoteFiles) {
					const content = await adapter.read(rf.path, root);
					await this.vault.applyExternalFile(
						rf.path,
						content,
						adapter.id,
					);
				}
			} catch (err) {
				console.error(
					`[Sync] Pull failed for adapter ${adapter.id}:`,
					err,
				);
			}
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
		for (const event of events) {
			try {
				if (event.type === 'delete') {
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
}
