import type { Workspace } from '@core/services/workspace.service';
import type { VaultEntry } from './vault-entry';
import { VaultDatabase } from './vault-database';
import {
	repoUrlToCloneDir,
	destroyGitFsBackend,
} from '@core/adapters/cloud/git/fs';
import { GitTokenStore } from '@core/adapters/cloud/git/auth';
import { GitSettingsStore } from '@core/adapters/cloud/git/settings-store';
import type { AdapterConfig } from '@core/adapters/adapter.interface';
import type { VaultStore } from './store';

/**
 * Owns VaultStore's workspace-lifecycle + persistence concerns: opening the
 * IndexedDB connection, loading/reloading entries on workspace activation and
 * switch, purging a removed workspace's data, and persisting entries.
 *
 * A plain class instantiated by VaultStore (like VaultReconciler / VaultDatabase),
 * NOT an Angular service — this keeps VaultStore the single public entry point
 * and avoids a circular DI. It drives the store's in-memory state only through
 * the store's public `hydrate()` / `resetMemory()` methods, and contains no
 * `effect()` calls (those live in VaultStore's constructor, in injection context).
 */
export class VaultLifecycle {
	constructor(private readonly store: VaultStore) {}

	readonly #database = new VaultDatabase();
	#initPromise: Promise<void> | null = null;
	/** Tracks which workspace was last loaded via init(). Guards the switch effect. */
	#loadedWsId: string | null = null;

	/** Tracks workspace IDs seen previously, so we can detect removals. */
	#lastSeenWorkspaces = new Map<string, Workspace>();
	// True after the first workspace list is observed — guards against
	// firing on the initial empty→populated transition.
	#workspaceRemovalWatchReady = false;

	// ──────────────────────────────────────────────
	// Persistence
	// ──────────────────────────────────────────────

	/** Persist a single entry to IndexedDB. */
	async persist(entry: VaultEntry): Promise<void> {
		await this.#database.put(entry);
	}

	/**
	 * Persist many entries in one shot (single IndexedDB write batch). Used by
	 * the store's cascade/bulk paths so they don't fan out into N DB round-trips.
	 */
	async persistMany(entries: VaultEntry[]): Promise<void> {
		await Promise.all(entries.map((e) => this.#database.put(e)));
	}

	// ──────────────────────────────────────────────
	// Init / load
	// ──────────────────────────────────────────────

	/**
	 * Initialize the IndexedDB connection and load entries for the active workspace.
	 * Safe to call multiple times — only opens the DB once, but ALWAYS reloads
	 * entries (handles workspace switch where a different set of entries is needed).
	 */
	async init(): Promise<void> {
		// The connection can be dropped after a successful open — another tab
		// starting an upgrade triggers `onversionchange`, which closes it. A
		// cached resolved promise would then keep us permanently disconnected,
		// so reopen whenever the connection is gone.
		if (!this.#database.isOpen) this.#initPromise = null;
		this.#initPromise ??= this.#database.open();
		try {
			await this.#initPromise;
		} catch (err) {
			// Don't cache a rejected open — a retry (e.g. after the user closes
			// the other tab holding an older version) must be able to succeed.
			this.#initPromise = null;
			throw err;
		}
		await this.#loadAll();
	}

	async ensureInitialized(): Promise<void> {
		await this.init();
	}

	async #loadAll(): Promise<void> {
		const wsId = this.store.activeWorkspaceId();
		if (!wsId) {
			this.store.resetMemory();
			return;
		}
		const entries = await this.#database.loadAll(wsId);
		this.store.hydrate(entries);
		this.#loadedWsId = wsId;
	}

	/** Clear in-memory entries and reload from IndexedDB for the current workspace. */
	async #clearAndReload(): Promise<void> {
		this.store.resetMemory();
		await this.init();
	}

	// ──────────────────────────────────────────────
	// Effect handlers (invoked from VaultStore's constructor effects)
	// ──────────────────────────────────────────────

	/**
	 * React to the active workspace changing to a *different* workspace. Skips the
	 * initial load (handled by explicit init()) to avoid races.
	 */
	handleWorkspaceSwitch(wsId: string | null): void {
		if (!wsId || !this.#loadedWsId) return;
		if (wsId === this.#loadedWsId) return;
		void this.#clearAndReload();
	}

	/**
	 * Purge IndexedDB entries for any workspace ID that disappeared from the list.
	 * Keeps VaultStore the single authority over DB ↔ workspace linkage, avoiding a
	 * circular DI between WorkspaceService and VaultStore.
	 */
	syncWorkspaceRemovals(current: Workspace[]): void {
		const currentIds = new Set(current.map((w) => w.id));

		if (this.#workspaceRemovalWatchReady) {
			for (const [removedId, removedWs] of this.#lastSeenWorkspaces) {
				if (!currentIds.has(removedId)) {
					void this.purgeWorkspace(
						removedId,
						removedWs.adapterConfigs,
					);
				}
			}
		}

		this.#workspaceRemovalWatchReady = true;
		this.#lastSeenWorkspaces = new Map(current.map((w) => [w.id, w]));
	}

	// ──────────────────────────────────────────────
	// Purge (workspace removal)
	// ──────────────────────────────────────────────

	/**
	 * Permanently delete ALL vault entries for a given workspace from IndexedDB.
	 * Called when a workspace is removed. If the purged workspace is the currently
	 * active one, the in-memory entries are also cleared.
	 *
	 * Also cleans up git adapter data: destroys the LightningFS IndexedDB database
	 * for each git adapter and removes the encrypted token and stored settings.
	 */
	async purgeWorkspace(
		wsId: string,
		adapterConfigs?: AdapterConfig[],
	): Promise<void> {
		await this.ensureInitialized();
		await this.#database.deleteAllByWorkspaceId(wsId);

		// Clean up git adapter data (LightningFS DB + token + settings)
		if (adapterConfigs) {
			for (const config of adapterConfigs) {
				if (config.adapterId === 'git') {
					const cloneDir = repoUrlToCloneDir(config.repoUrl);
					await destroyGitFsBackend(cloneDir);
					const tokenStore = new GitTokenStore();
					await tokenStore.deleteToken(config.repoUrl);
					new GitSettingsStore().delete(config.repoUrl);
				}
			}
		}

		// If the purged workspace is the one currently loaded, clear memory
		if (this.store.activeWorkspaceId() === wsId) {
			this.store.resetMemory();
			this.#loadedWsId = null;
		}
	}
}
