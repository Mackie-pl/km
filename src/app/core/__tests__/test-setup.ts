import { TestBed } from '@angular/core/testing';
import { VaultStore } from '../vault/store';
import {
	WorkspaceService,
	type Workspace,
} from '../services/workspace.service';
import { AdaptersManager } from '../adapters/manager';
import { ADAPTERS } from '../adapters/token';
import { TestFsAdapter } from '../adapters/test-fs.adapter';
import { signal, computed } from '@angular/core';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a mock workspace with sensible defaults.
 * Pass overrides to customize specific fields (id, adapters, etc.).
 */
export function createMockWorkspace(overrides?: Partial<Workspace>): Workspace {
	const ws: Workspace = {
		id: crypto.randomUUID(),
		name: 'Test Workspace',
		activeSyncAdapters: ['test-fs'],
		adapterConfigs: [{ adapterId: 'test-fs', path: 'test:/root' }],
		...overrides,
	};
	// If activeSyncAdapters changed but adapterConfigs didn't, auto-derive
	if (overrides?.activeSyncAdapters && !overrides.adapterConfigs) {
		ws.adapterConfigs = overrides.activeSyncAdapters.map((a) => ({
			adapterId: a,
			path: 'test:/root',
		}));
	}
	return ws;
}

export interface VaultTestContext {
	vault: VaultStore;
	mockWorkspaceService: WorkspaceService;
	testAdapter: TestFsAdapter;
	activeWorkspace: ReturnType<typeof signal<Workspace | null>>;
	workspaces: ReturnType<typeof signal<Workspace[]>>;
}

/**
 * Set up a VaultStore with a mock WorkspaceService and a TestFsAdapter.
 * Call with a workspace to pre-activate it, or null/undefined to start empty.
 */
export function setupVaultStore(
	workspace?: Workspace | null,
): VaultTestContext {
	const activeWorkspace = signal<Workspace | null>(workspace ?? null);
	const workspaces = signal<Workspace[]>(workspace ? [workspace] : []);

	const mockWorkspaceService = {
		activeWorkspace: computed(() => activeWorkspace()),
		workspaces: computed(() => workspaces()),
		activeAdapters: computed(() => []),
		activateWorkspace: (id: string) => {
			const ws = workspaces().find((w) => w.id === id) ?? null;
			activeWorkspace.set(ws);
		},
		addWorkspace: (w: Workspace) => {
			workspaces.update((list) => [...list, w]);
		},
		removeWorkspace: (id: string) => {
			workspaces.update((list) => list.filter((w) => w.id !== id));
			if (activeWorkspace()?.id === id) {
				activeWorkspace.set(workspaces()[0] ?? null);
			}
		},
	} as unknown as WorkspaceService;

	const testAdapter = new TestFsAdapter();

	TestBed.configureTestingModule({
		providers: [
			VaultStore,
			{ provide: WorkspaceService, useValue: mockWorkspaceService },
			{
				provide: AdaptersManager,
				useValue: { getAdaptersByIds: () => [testAdapter] },
			},
			{ provide: ADAPTERS, useValue: [testAdapter] },
		],
	});

	const vault = TestBed.inject(VaultStore);
	return {
		vault,
		mockWorkspaceService,
		testAdapter,
		activeWorkspace,
		workspaces,
	};
}
