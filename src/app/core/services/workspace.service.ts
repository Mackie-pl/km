import { computed, inject, Injectable, signal } from '@angular/core';
import { AdaptersManager } from '@core/adapters/manager';
import { GitTokenStore } from '@core/adapters/cloud/git/auth';
import { GitSettingsStore } from '@core/adapters/cloud/git/settings-store';
import type { AdapterConfig } from '../adapters/adapter.interface';

/** Workspace metadata */
export interface Workspace {
	id: string;
	name: string;
	/** IDs of sync adapters enabled for this workspace */
	activeSyncAdapters: string[];
	/** Per-adapter configuration (e.g., cloud mirror paths) */
	adapterConfigs: AdapterConfig[];
}

const WORKSPACES_KEY = 'workspaces';
const ACTIVE_WORKSPACE_KEY = 'activeWorkspace';

/**
 * Global workspace state manager.
 * Persists workspace list and active workspace to localStorage.
 * Each workspace owns its own adapter settings (which adapters are active,
 * and per-adapter config like mirror paths).
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceService {
	private readonly adapterManager = inject(AdaptersManager);

	/** List of all known workspaces */
	readonly workspaces = signal<Workspace[]>([]);

	/** Currently active workspace (null if none selected) */
	readonly activeWorkspace = signal<Workspace | null>(null);

	/**
	 * Computed list of active Adapter instances for the current workspace.
	 * Reactively updates when the active workspace or its adapter list changes.
	 */
	readonly activeAdapters = computed(() => {
		const ws = this.activeWorkspace();
		if (!ws) return [];
		return this.adapterManager.getAdaptersByIds(ws.activeSyncAdapters);
	});

	constructor() {
		this.loadPersistedState();
	}

	// ========================================================================
	// Persistence
	// ========================================================================

	/**
	 * Load workspace state from localStorage.
	 * If no workspaces exist, activeWorkspace remains null.
	 */
	private loadPersistedState(): void {
		try {
			const stored = localStorage.getItem(WORKSPACES_KEY);
			if (stored) {
				const parsed = JSON.parse(stored) as Workspace[];
				const cleaned = this.#migrateOutPlaintextTokens(parsed);
				this.#seedGitSettings(cleaned);
				this.workspaces.set(cleaned);
			}

			const activeId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
			if (activeId) {
				const active = this.workspaces().find((w) => w.id === activeId);
				if (active) {
					this.activeWorkspace.set(active);
				}
			}
		} catch (error) {
			console.error('Failed to load workspace state:', error);
		}
	}

	// ========================================================================
	// Secret hygiene — keep PATs out of plaintext localStorage
	// ========================================================================

	/**
	 * Strip the transient git PAT from a config. The token is never persisted
	 * in the workspace config; its durable home is the encrypted
	 * {@link GitTokenStore}. See `GitAdapterConfig.token`.
	 */
	#stripGitToken(config: AdapterConfig): AdapterConfig {
		if (config.adapterId === 'git' && config.token) {
			const { token: _token, ...rest } = config;
			return rest;
		}
		return config;
	}

	/** Strip transient secrets from every adapter config in a workspace. */
	#sanitizeWorkspace(ws: Workspace): Workspace {
		return {
			...ws,
			adapterConfigs: ws.adapterConfigs.map((c) =>
				this.#stripGitToken(c),
			),
		};
	}

	/**
	 * One-time cleanup for configs persisted by older versions that stored the
	 * PAT in plaintext. Migrates any token found into the encrypted token store
	 * (so existing auth keeps working), strips it from the config, and rewrites
	 * localStorage.
	 */
	#migrateOutPlaintextTokens(list: Workspace[]): Workspace[] {
		const hasPlaintextToken = list.some((ws) =>
			ws.adapterConfigs.some(
				(c) => c.adapterId === 'git' && !!c.token,
			),
		);
		if (!hasPlaintextToken) return list;

		// Best-effort migration into the encrypted store so existing auth
		// keeps working, then strip the plaintext copies and rewrite storage.
		const tokenStore = new GitTokenStore();
		for (const ws of list) {
			for (const c of ws.adapterConfigs) {
				if (c.adapterId === 'git' && c.token) {
					void tokenStore.setToken(c.repoUrl, c.token);
				}
			}
		}

		const cleaned = list.map((ws) => this.#sanitizeWorkspace(ws));
		try {
			localStorage.setItem(WORKSPACES_KEY, JSON.stringify(cleaned));
		} catch {
			/* best-effort */
		}
		return cleaned;
	}

	/**
	 * Prime the git settings store from persisted (non-secret) config so the
	 * adapter honors the configured branch/author/poll on first use — including
	 * for adapters configured before settings were stored separately. The git
	 * adapter is decoupled from workspace state, so this hands it the values it
	 * can't otherwise see.
	 */
	#seedGitSettings(list: Workspace[]): void {
		const store = new GitSettingsStore();
		for (const ws of list) {
			for (const c of ws.adapterConfigs) {
				if (c.adapterId === 'git') {
					store.set(c.repoUrl, c);
				}
			}
		}
	}

	/**
	 * Persist workspaces and active workspace to localStorage.
	 */
	private persist(): void {
		try {
			localStorage.setItem(
				WORKSPACES_KEY,
				JSON.stringify(this.workspaces()),
			);
			const activeId = this.activeWorkspace()?.id;
			if (activeId) {
				localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeId);
			} else {
				localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
			}
		} catch (error) {
			console.error('Failed to persist workspace state:', error);
		}
	}

	// ========================================================================
	// Workspace lifecycle
	// ========================================================================

	/**
	 * Set the active workspace by ID.
	 */
	activateWorkspace(id: string): void {
		const workspace = this.workspaces().find((w) => w.id === id);
		if (workspace) {
			this.activeWorkspace.set(workspace);
			this.persist();
		}
	}

	/**
	 * Add a new workspace (or update if ID already exists).
	 */
	addWorkspace(workspace: Workspace): void {
		const sanitized = this.#sanitizeWorkspace(workspace);
		const existing = this.workspaces().find((w) => w.id === sanitized.id);
		if (existing) {
			this.workspaces.update((list) =>
				list.map((w) => (w.id === sanitized.id ? sanitized : w)),
			);
		} else {
			this.workspaces.update((list) => [...list, sanitized]);
		}
		this.persist();
	}

	/**
	 * Remove a workspace by ID.
	 * If the removed workspace is the active one, auto-select the first remaining
	 * workspace, or set activeWorkspace to null if none are left.
	 */
	removeWorkspace(id: string): void {
		const removed = this.workspaces().find((w) => w.id === id);
		this.workspaces.update((list) => list.filter((w) => w.id !== id));

		// If the removed workspace was the active one, activate a fallback
		if (this.activeWorkspace()?.id === id) {
			const remaining = this.workspaces();
			if (remaining.length > 0) {
				this.activeWorkspace.set(remaining[0] as Workspace | null);
			} else {
				this.activeWorkspace.set(null);
			}
		}

		this.persist();
		if (removed) this.#disconnectOrphanedAdapters(removed.activeSyncAdapters);
	}

	// ========================================================================
	// Per-workspace adapter management
	// ========================================================================

	/**
	 * Set which adapters are active for a given workspace.
	 * @param workspaceId - Target workspace ID
	 * @param adapterIds - Array of adapter IDs to enable
	 */
	setWorkspaceAdapters(workspaceId: string, adapterIds: string[]): void {
		const previous =
			this.workspaces().find((w) => w.id === workspaceId)
				?.activeSyncAdapters ?? [];
		this.workspaces.update((list) =>
			list.map((w) =>
				w.id === workspaceId
					? { ...w, activeSyncAdapters: adapterIds }
					: w,
			),
		);
		// Keep activeWorkspace in sync if it's the same workspace
		if (this.activeWorkspace()?.id === workspaceId) {
			this.activeWorkspace.update((w) =>
				w ? { ...w, activeSyncAdapters: adapterIds } : w,
			);
		}
		this.persist();
		// Adapters dropped from this workspace may now be unused everywhere.
		const removed = previous.filter((id) => !adapterIds.includes(id));
		this.#disconnectOrphanedAdapters(removed);
	}

	/**
	 * Upsert adapter-specific config for a workspace.
	 * Replaces existing config for the same adapterId, adds otherwise.
	 * @param workspaceId - Target workspace ID
	 * @param config - Adapter configuration to store
	 */
	setAdapterConfig(workspaceId: string, config: AdapterConfig): void {
		// Drop the transient PAT before it ever reaches state/localStorage —
		// testConnection has already stashed it in the encrypted token store.
		const safeConfig = this.#stripGitToken(config);
		this.workspaces.update((list) =>
			list.map((w) => {
				if (w.id !== workspaceId) return w;
				const filtered = w.adapterConfigs.filter(
					(c) => c.adapterId !== safeConfig.adapterId,
				);
				return { ...w, adapterConfigs: [...filtered, safeConfig] };
			}),
		);
		if (this.activeWorkspace()?.id === workspaceId) {
			this.activeWorkspace.update((w) => {
				if (!w) return w;
				const filtered = w.adapterConfigs.filter(
					(c) => c.adapterId !== safeConfig.adapterId,
				);
				return { ...w, adapterConfigs: [...filtered, safeConfig] };
			});
		}
		this.persist();
	}

	/**
	 * Get adapter-specific config for the active workspace.
	 * @param adapterId - Adapter ID to look up
	 * @returns The config object, or undefined if not found
	 */
	getAdapterConfig(adapterId: string): AdapterConfig | undefined {
		return this.activeWorkspace()?.adapterConfigs.find(
			(c) => c.adapterId === adapterId,
		);
	}

	/**
	 * Remove adapter-specific config from a workspace.
	 * @param workspaceId - Target workspace ID
	 * @param adapterId - Adapter ID to remove config for
	 */
	removeAdapterConfig(workspaceId: string, adapterId: string): void {
		this.workspaces.update((list) =>
			list.map((w) => {
				if (w.id !== workspaceId) return w;
				return {
					...w,
					adapterConfigs: w.adapterConfigs.filter(
						(c) => c.adapterId !== adapterId,
					),
				};
			}),
		);
		if (this.activeWorkspace()?.id === workspaceId) {
			this.activeWorkspace.update((w) => {
				if (!w) return w;
				return {
					...w,
					adapterConfigs: w.adapterConfigs.filter(
						(c) => c.adapterId !== adapterId,
					),
				};
			});
		}
		this.persist();
	}

	/**
	 * Disconnect each candidate adapter that is no longer referenced by ANY
	 * workspace, releasing its global state (e.g. a shared Drive OAuth token and
	 * its reconnect prompt). Adapters still used by another workspace are left
	 * untouched — the Drive token is intentionally shared across workspaces.
	 */
	#disconnectOrphanedAdapters(candidateIds: string[]): void {
		if (candidateIds.length === 0) return;
		const stillUsed = new Set(
			this.workspaces().flatMap((w) => w.activeSyncAdapters),
		);
		const orphaned = candidateIds.filter((id) => !stillUsed.has(id));
		for (const adapter of this.adapterManager.getAdaptersByIds(orphaned)) {
			void adapter.disconnect?.();
		}
	}
}
