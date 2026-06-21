import { computed, inject, Injectable, signal } from '@angular/core';
import { AdaptersManager } from '@core/adapters/manager';
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
			if (stored) this.workspaces.set(JSON.parse(stored) as Workspace[]);

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
		const existing = this.workspaces().find((w) => w.id === workspace.id);
		if (existing) {
			this.workspaces.update((list) =>
				list.map((w) => (w.id === workspace.id ? workspace : w)),
			);
		} else {
			this.workspaces.update((list) => [...list, workspace]);
		}
		this.persist();
	}

	/**
	 * Remove a workspace by ID.
	 * If the removed workspace is the active one, auto-select the first remaining
	 * workspace, or set activeWorkspace to null if none are left.
	 */
	removeWorkspace(id: string): void {
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
	}

	/**
	 * Upsert adapter-specific config for a workspace.
	 * Replaces existing config for the same adapterId, adds otherwise.
	 * @param workspaceId - Target workspace ID
	 * @param config - Adapter configuration to store
	 */
	setAdapterConfig(workspaceId: string, config: AdapterConfig): void {
		this.workspaces.update((list) =>
			list.map((w) => {
				if (w.id !== workspaceId) return w;
				const filtered = w.adapterConfigs.filter(
					(c) => c.adapterId !== config.adapterId,
				);
				return { ...w, adapterConfigs: [...filtered, config] };
			}),
		);
		if (this.activeWorkspace()?.id === workspaceId) {
			this.activeWorkspace.update((w) => {
				if (!w) return w;
				const filtered = w.adapterConfigs.filter(
					(c) => c.adapterId !== config.adapterId,
				);
				return { ...w, adapterConfigs: [...filtered, config] };
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
}
