import {
	effect,
	inject,
	Injectable,
	signal,
	type OnDestroy,
} from '@angular/core';
import { Router } from '@angular/router';
import { AdaptersManager } from '@core/adapters/manager';
import { WorkspaceService } from '@core/services/workspace.service';
import { timeout } from '@core/utils/async';
import { VaultStore } from '@vault/store';
import { getAdapterRoot } from '@core/adapters/adapter.interface';
import { SyncPushPhase } from './sync-push-phase';
import { SyncPullPhase } from './sync-pull-phase';
import { SyncWatchPhase } from './sync-watch-phase';
import type { ActiveAdapterEntry } from './sync-types';

@Injectable({
	providedIn: 'root',
})
export class SyncEngineService implements OnDestroy {
	private scheduled = false;
	private pulling = false;
	private pullRequested = false;

	/** Phase executors — instantiated once, reused across cycles. */
	private readonly pushPhase: SyncPushPhase;
	private readonly pullPhase: SyncPullPhase;
	private readonly watchPhase: SyncWatchPhase;

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
	private readonly router = inject(Router);

	constructor() {
		this.pushPhase = new SyncPushPhase(this.vault);
		this.pullPhase = new SyncPullPhase(this.vault);
		this.watchPhase = new SyncWatchPhase(
			this.vault,
			this.router,
			() => this.getActiveAdapters(),
			() => this.forcePull(),
			(err: unknown) => {
				this.#onWatchError(err);
			},
		);

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
		this.watchPhase.destroy();
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
		if (this.pulling) {
			this.pullRequested = true;
			return;
		}
		this.pulling = true;
		this.isSyncing.set(true);
		try {
			const adapters = this.getActiveAdapters();
			await this.registerScopes(adapters);
			await this.pullPhase.execute(adapters);
			this.clearSyncError();
		} catch (err) {
			this.syncFailed.set(true);
			this.lastSyncError.set(this.formatError(err));
		} finally {
			this.pulling = false;
			this.isSyncing.set(false);
			// If another pull was queued while this one was in flight (e.g. an
			// adapter was activated mid-pull), re-run with the updated state.
			if (this.pullRequested) {
				this.pullRequested = false;
				void this.forcePull();
			}
		}
	}

	/**
	 * Pull then push — used by manual "Sync now" button.
	 */
	async syncAll(): Promise<void> {
		this.isSyncing.set(true);
		try {
			const adapters = this.getActiveAdapters();
			await this.registerScopes(adapters);
			await this.pullPhase.execute(adapters);
			await this.pushPhase.execute(adapters);
			this.clearSyncError();
		} catch (err) {
			this.syncFailed.set(true);
			this.lastSyncError.set(this.formatError(err));
			throw err;
		} finally {
			this.isSyncing.set(false);
		}
	}

	/**
	 * Re-read a single entry from all active adapters and apply changes
	 * to the vault. First adapter success wins — no multi-adapter merge.
	 *
	 * Safe to call frequently (focus events, polling) — the reconciler
	 * handles conflict detection and creates `.conflict-*` copies when
	 * local pending changes exist.
	 *
	 * @param entryId - Vault entry ID to refresh
	 */
	async refreshEntry(entryId: string): Promise<void> {
		const entry = this.vault.getById(entryId);
		if (!entry || entry.deleted) return;

		for (const { adapter, root } of this.getActiveAdapters()) {
			try {
				const content = await adapter.read(entry.path, root);
				await this.vault.applyExternalFile(
					entry.path,
					content,
					adapter.id,
				);
				return;
			} catch {
				continue;
			}
		}
	}

	/**
	 * Re-read a file by path (without knowing its entry ID) from all
	 * active adapters. Used on note-navigation before the editor mounts.
	 *
	 * @param filePath - Vault-relative file path to refresh
	 */
	async refreshPath(filePath: string): Promise<void> {
		const entry = this.vault.getByPath(filePath);
		if (entry) {
			await this.refreshEntry(entry.id);
			return;
		}

		for (const { adapter, root } of this.getActiveAdapters()) {
			try {
				const content = await adapter.read(filePath, root);
				await this.vault.applyExternalFile(
					filePath,
					content,
					adapter.id,
				);
				return;
			} catch {
				continue;
			}
		}
	}

	/**
	 * Re-read a single folder's direct children from disk and reconcile.
	 * Delegated to SyncWatchPhase.
	 */
	async refreshFolder(folderPath: string): Promise<void> {
		await this.watchPhase.refreshFolder(folderPath);
	}

	// ──────────────────────────────────────────────
	// Watch lifecycle
	// ──────────────────────────────────────────────

	async startWatching(): Promise<void> {
		await this.watchPhase.startWatching();
	}

	stopWatching(): void {
		this.watchPhase.stopWatching();
	}

	// ──────────────────────────────────────────────
	// Internal
	// ──────────────────────────────────────────────

	/** Only push — triggered by entriesNeedingSync changes. */
	private async runSync(): Promise<void> {
		const adapters = this.getActiveAdapters();
		if (adapters.length === 0) return;

		this.isSyncing.set(true);
		try {
			await this.pushPhase.execute(adapters);
			this.clearSyncError();
		} catch (err) {
			this.syncFailed.set(true);
			this.lastSyncError.set(this.formatError(err));
		} finally {
			this.isSyncing.set(false);
		}
	}

	/** Called when SyncWatchPhase encounters a watch startup error. */
	#onWatchError(err: unknown): void {
		console.error('[Sync] Failed to start watching:', err);
		this.syncFailed.set(true);
		this.lastSyncError.set(this.formatError(err));
	}

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
					root: config ? getAdapterRoot(config) : undefined,
				};
			})
			.filter((e): e is ActiveAdapterEntry => e !== null);
	}

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
