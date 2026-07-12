import type { Router } from '@angular/router';
import { navigateToEntry } from '@core/utils/router-utils';
import type { VaultStore } from '@vault/store';
import type { Adapter, WatchEvent } from '../adapters/adapter.interface';
import type { ActiveAdapterEntry } from './sync-types';

/**
 * Manages adapter watch subscriptions, event debouncing, coalescing,
 * and browser fallback refresh mechanisms (visibility + folder-expand).
 *
 * Follows the same pattern as SyncPushPhase / SyncPullPhase — a plain
 * class instantiated by SyncEngineService.
 */
export class SyncWatchPhase {
	private watching = false;
	private watchCleanups: (() => void)[] = [];
	private visibilityCleanup: (() => void) | null = null;

	/**
	 * Event debounce buffer per adapter.
	 * Tauri's watcher delivers OS events in separate IPC callbacks, so a single
	 * atomic save produces multiple handleExternalChanges calls with 1 event each.
	 * This buffer collects events over a short window so coalesceEvents can merge
	 * delete+create pairs into modify events.
	 */
	readonly #eventBuffer = new Map<
		string,
		{ events: WatchEvent[]; timer: number | undefined }
	>();

	/** Debounce window for coalescing atomic-save event pairs. */
	static readonly EVENT_DEBOUNCE_MS = 200;

	constructor(
		private readonly vault: VaultStore,
		private readonly router: Router,
		private readonly getActiveAdapters: () => ActiveAdapterEntry[],
		private readonly forcePull: () => Promise<void>,
		private readonly reportError: (err: unknown) => void,
	) {}

	// ──────────────────────────────────────────────
	// Lifecycle
	// ──────────────────────────────────────────────

	/** True when watchers are active. */
	get isWatching(): boolean {
		return this.watching;
	}

	/**
	 * Subscribe to all adapter watchers and start browser visibility refresh.
	 */
	async startWatching(): Promise<void> {
		if (this.watching) return;
		this.watching = true;

		for (const { adapter, root } of this.getActiveAdapters()) {
			if (!adapter.watch) continue;

			// Isolate per-adapter: one adapter that can't start watching (e.g.
			// gdrive throwing ReauthRequiredError) must not prevent the others'
			// watchers OR the browser visibility refresh below from being wired up.
			try {
				const unsubscribe = await adapter.watch(
					(events: WatchEvent[]) => {
						this.#handleExternalChanges(events, adapter, root);
					},
					root,
				);
				this.watchCleanups.push(unsubscribe);
			} catch (err) {
				this.reportError(err);
			}
		}

		// Browser-only: full re-scan when the tab becomes visible or the window
		// regains focus (the File System Access API has no native watcher).
		if (!this.#hasTauriAdapter()) {
			this.#startVisibilityRefresh();
		}
	}

	/** Unsubscribe all watchers and remove visibility listener. */
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
		this.#stopVisibilityRefresh();
	}

	/** Full destroy: stop + clear event buffers. */
	destroy(): void {
		this.stopWatching();
		for (const [, buf] of this.#eventBuffer) {
			if (buf.timer) window.clearTimeout(buf.timer);
		}
		this.#eventBuffer.clear();
	}

	// ──────────────────────────────────────────────
	// Folder refresh (for sidebar expand)
	// ──────────────────────────────────────────────

	/**
	 * Re-read a single folder's direct children from the first available
	 * active adapter and reconcile against the vault. New entries are
	 * imported; entries that no longer exist on disk are soft-deleted.
	 *
	 * Intended for folder-expand in the sidebar (browser only — Tauri has
	 * native watching). Only lists the folder non-recursively.
	 */
	async refreshFolder(folderPath: string): Promise<void> {
		const adapters = this.getActiveAdapters();
		if (adapters.length === 0) return;

		// Prefer the first non-Tauri adapter; Tauri uses native watching
		const entry =
			adapters.find(
				(a: ActiveAdapterEntry) => a.adapter.id !== 'tauri-fs',
			) ?? adapters[0];
		if (!entry) return;

		const { adapter, root } = entry;

		try {
			const entries = await adapter.list(folderPath, root, false);
			const remotePaths = new Set(
				entries
					.filter((e: { isDirectory: boolean }) => !e.isDirectory)
					.map((e: { path: string }) => e.path),
			);
			const remoteFolderPaths = new Set(
				entries
					.filter((e: { isDirectory: boolean }) => e.isDirectory)
					.map((e: { path: string }) => e.path),
			);

			// Import entries found on disk
			for (const fsEntry of entries) {
				if (fsEntry.isDirectory) {
					await this.vault.applyExternalFolder(
						fsEntry.path,
						adapter.id,
					);
				} else {
					const content = await adapter.read(fsEntry.path, root);
					await this.vault.applyExternalFile(
						fsEntry.path,
						content,
						adapter.id,
					);
				}
			}

			// Orphan detection: vault entries under this folder that are
			// no longer on disk → soft-delete locally
			const allRemotePaths = new Set([
				...remotePaths,
				...remoteFolderPaths,
			]);
			const orphans = [
				...this.vault.files(),
				...this.vault.folders(),
			].filter(
				(e) =>
					e.path.startsWith(folderPath + '/') &&
					!e.path.slice(folderPath.length + 1).includes('/') &&
					!allRemotePaths.has(e.path),
			);
			for (const orphan of orphans) {
				await this.vault.delete(orphan.id);
			}
		} catch (err) {
			console.error(
				`[Sync] Failed to refresh folder "${folderPath}":`,
				err,
			);
		}
	}

	// ──────────────────────────────────────────────
	// External change handling
	// ──────────────────────────────────────────────

	#handleExternalChanges(
		events: WatchEvent[],
		adapter: Adapter,
		root?: string,
	): void {
		const key = adapter.id;

		let buf = this.#eventBuffer.get(key);
		if (!buf) {
			buf = { events: [], timer: undefined };
			this.#eventBuffer.set(key, buf);
		}

		buf.events.push(...events);
		if (buf.timer) window.clearTimeout(buf.timer);
		buf.timer = window.setTimeout(() => {
			const batch = buf.events;
			buf.events = [];
			buf.timer = undefined;
			void this.#flushEventBuffer(key, batch, adapter, root);
		}, SyncWatchPhase.EVENT_DEBOUNCE_MS);
	}

	async #flushEventBuffer(
		_key: string,
		events: WatchEvent[],
		adapter: Adapter,
		root?: string,
	): Promise<void> {
		if (events.length === 0) return;

		const coalesced = SyncWatchPhase.#coalesceEvents(events);

		for (const event of coalesced) {
			try {
				if (event.type === 'rename' && event.oldPath) {
					await this.vault.applyExternalRename(
						event.oldPath,
						event.path,
						adapter.id,
					);
					await this.#maybeNavigateAfterRename(
						event.oldPath,
						event.path,
					);
				} else if (event.type === 'delete') {
					const local = this.vault.getByPath(event.path);
					if (local && !local.deleted) {
						await this.vault.delete(local.id);
					}
				} else {
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

	/**
	 * Coalesce a batch of events into a compact action-per-path list.
	 *
	 * External editors often use atomic-save patterns:
	 *   1. Write content to .crswap temp file
	 *   2. Delete the original file
	 *   3. Rename .crswap → original
	 *
	 * This produces: modify(.crswap), delete(original), create(original)
	 * within a single batch. Without coalescing, the delete soft-deletes
	 * the vault entry, then the create makes a new entry with a different
	 * UUID — the editor loses its reference and content disappears.
	 */
	static #coalesceEvents(events: WatchEvent[]): WatchEvent[] {
		const grouped = new Map<string, WatchEvent>();
		const deletePaths = new Set<string>();

		for (const event of events) {
			if (event.type === 'delete') {
				deletePaths.add(event.path);
				grouped.set(event.path, event);
			} else if (
				event.type === 'create' &&
				deletePaths.has(event.path)
			) {
				// Delete + create for the same path → coalesce into modify
				grouped.set(event.path, { type: 'modify', path: event.path });
				deletePaths.delete(event.path);
			} else {
				grouped.set(event.path, event);
			}
		}

		return Array.from(grouped.values());
	}

	/** Navigate to the new path if the renamed entry was being viewed. */
	async #maybeNavigateAfterRename(
		oldPath: string,
		newPath: string,
	): Promise<void> {
		const url = this.router.url;
		const prefix = '/e/';
		if (!url.startsWith(prefix)) return;
		const viewPath = url.slice(prefix.length);
		if (viewPath === oldPath) {
			await navigateToEntry(this.router, newPath);
		}
	}

	// ──────────────────────────────────────────────
	// Browser visibility refresh
	// ──────────────────────────────────────────────

	/** True if any active adapter is the Tauri FS adapter. */
	#hasTauriAdapter(): boolean {
		return this.getActiveAdapters().some(
			(a) => a.adapter.id === 'tauri-fs',
		);
	}

	/**
	 * Re-pull from disk when the tab becomes visible OR the window regains focus.
	 *
	 * `visibilitychange` fires when switching tabs or minimizing, but alt-tabbing
	 * to another app (e.g. editing the file in Notepad) and back often leaves the
	 * tab "visible" and only fires window `focus` — so we listen to both. Repeated
	 * `forcePull` calls are cheap and coalesced by the engine's reentrancy guard.
	 */
	#startVisibilityRefresh(): void {
		const onVisible = (): void => {
			if (document.visibilityState === 'visible') {
				void this.forcePull();
			}
		};
		const onFocus = (): void => {
			void this.forcePull();
		};
		document.addEventListener('visibilitychange', onVisible);
		window.addEventListener('focus', onFocus);
		this.visibilityCleanup = () => {
			document.removeEventListener('visibilitychange', onVisible);
			window.removeEventListener('focus', onFocus);
		};
	}

	/** Remove the visibilitychange listener. */
	#stopVisibilityRefresh(): void {
		this.visibilityCleanup?.();
		this.visibilityCleanup = null;
	}
}

