import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkspaceService, type Workspace } from '../workspace.service';
import { AdaptersManager } from '@core/adapters/manager';
import type { Adapter } from '@core/adapters/adapter.interface';

/**
 * Covers the orphaned-adapter cleanup: when no workspace references an adapter
 * any more, its `disconnect()` is called (releasing shared state like the Drive
 * OAuth token + reconnect prompt) — but NOT while another workspace still uses
 * it. Regression guard for "removed the Drive workspace, still asked to reauth".
 */
describe('WorkspaceService — orphaned adapter disconnect', () => {
	let disconnect: ReturnType<typeof vi.fn>;

	function ws(id: string, adapters: string[]): Workspace {
		return { id, name: id, activeSyncAdapters: adapters, adapterConfigs: [] };
	}

	function setup(): WorkspaceService {
		disconnect = vi.fn().mockResolvedValue(undefined);
		const gdrive = {
			id: 'gdrive',
			isLocal: false,
			isAvailable: () => true,
			disconnect,
		} as unknown as Adapter;

		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				WorkspaceService,
				{
					provide: AdaptersManager,
					useValue: {
						getAdaptersByIds: (ids: string[]) =>
							ids.includes('gdrive') ? [gdrive] : [],
					},
				},
			],
		});
		return TestBed.inject(WorkspaceService);
	}

	beforeEach(() => {
		localStorage.clear();
	});

	it('disconnects Drive when the last workspace using it is removed', () => {
		const svc = setup();
		svc.addWorkspace(ws('w1', ['gdrive']));

		svc.removeWorkspace('w1');

		expect(disconnect).toHaveBeenCalledTimes(1);
	});

	it('keeps Drive connected while another workspace still uses it', () => {
		const svc = setup();
		svc.addWorkspace(ws('w1', ['gdrive']));
		svc.addWorkspace(ws('w2', ['gdrive']));

		svc.removeWorkspace('w1');

		expect(disconnect).not.toHaveBeenCalled();
	});

	it('disconnects Drive when it is removed from the only workspace using it', () => {
		const svc = setup();
		svc.addWorkspace(ws('w1', ['gdrive', 'browser-file-system-api']));

		svc.setWorkspaceAdapters('w1', ['browser-file-system-api']);

		expect(disconnect).toHaveBeenCalledTimes(1);
	});

	it('does not disconnect an adapter that is still present after reconfig', () => {
		const svc = setup();
		svc.addWorkspace(ws('w1', ['gdrive']));

		// Re-set the same adapters (e.g. reordering) — nothing was dropped.
		svc.setWorkspaceAdapters('w1', ['gdrive']);

		expect(disconnect).not.toHaveBeenCalled();
	});
});
