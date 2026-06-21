import { TestBed } from '@angular/core/testing';
import { SyncEngineService } from '../sync-engine';
import { VaultStore } from '@vault/store';
import {
	WorkspaceService,
	type Workspace,
} from '@core/services/workspace.service';
import { AdaptersManager } from '@core/adapters/manager';
import { ADAPTERS } from '@core/adapters/token';
import { TestFsAdapter } from '@core/adapters/test-fs.adapter';
import { signal, computed } from '@angular/core';
import { createMockWorkspace } from '@core/__tests__/test-setup';
import { timeout } from '@core/utils/async';

interface SyncTestContext {
	engine: SyncEngineService;
	vault: VaultStore;
	testAdapter: TestFsAdapter;
	activeWorkspace: ReturnType<typeof signal<Workspace | null>>;
	workspaces: ReturnType<typeof signal<Workspace[]>>;
}

function setupSyncEngine(workspace?: Workspace | null): SyncTestContext {
	const activeWorkspace = signal<Workspace | null>(workspace ?? null);
	const wsList = signal<Workspace[]>(workspace ? [workspace] : []);

	const mockWorkspaceService = {
		activeWorkspace: computed(() => activeWorkspace()),
		workspaces: computed(() => wsList()),
		activeAdapters: computed(() => []),
		addWorkspace: (w: Workspace) => {
			wsList.update((list) => [...list, w]);
		},
		activateWorkspace: (id: string) => {
			activeWorkspace.set(wsList().find((w) => w.id === id) ?? null);
		},
	} as unknown as WorkspaceService;

	const testAdapter = new TestFsAdapter();

	TestBed.configureTestingModule({
		providers: [
			VaultStore,
			SyncEngineService,
			{
				provide: WorkspaceService,
				useValue: mockWorkspaceService,
			},
			{
				provide: AdaptersManager,
				useValue: {
					getAdaptersByIds: (ids: string[]) =>
						ids.map((id) => {
							if (id === 'test-fs') return testAdapter;
							return {
								id,
								isLocal: false,
								isAvailable: () => true,
								read: () => Promise.resolve('remote content'),
								write: () => Promise.resolve(),
								delete: () => Promise.resolve(),
								rename: () => Promise.resolve(),
								list: () => Promise.resolve([]),
							};
						}),
				},
			},
			{ provide: ADAPTERS, useValue: [testAdapter] },
		],
	});

	const vault = TestBed.inject(VaultStore);
	const engine = TestBed.inject(SyncEngineService);

	return {
		engine,
		vault,
		testAdapter,
		activeWorkspace,
		workspaces: wsList,
	};
}

/** Wait for the 1s debounce in scheduleSync to elapse. */
async function waitForDebounce(): Promise<void> {
	await timeout(1100);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SyncEngineService', () => {
	beforeEach(() => {
		TestBed.resetTestingModule();
	});

	describe('initial state', () => {
		it('should start with no sync error', () => {
			const { engine } = setupSyncEngine(null);
			expect(engine.syncFailed()).toBe(false);
			expect(engine.isSyncing()).toBe(false);
			expect(engine.lastSyncError()).toBeNull();
		});

		it('should clear error state via clearSyncError', () => {
			const { engine } = setupSyncEngine(null);
			engine.syncFailed.set(true);
			engine.lastSyncError.set('something broke');

			engine.clearSyncError();
			expect(engine.syncFailed()).toBe(false);
			expect(engine.lastSyncError()).toBeNull();
		});
	});

	describe('scheduleSync (push)', () => {
		it('should push pending entries to adapters', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, vault, testAdapter } = ctx;

			await vault.init();
			await vault.createFile('note.md', 'hello world');

			const pushPromise = engine.scheduleSync();
			await waitForDebounce();
			await pushPromise;

			const writtenContent = await testAdapter.read('note.md');
			expect(writtenContent).toBe('hello world');

			const entry = vault.getByPath('note.md');
			expect(entry?.pendingAdapters).not.toContain('test-fs');
		});

		it('should push deleted entries to adapters', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, vault, testAdapter } = ctx;

			await vault.init();

			await vault.createFile('temp.md', 'temporary');
			const entry = vault.getByPath('temp.md')!;
			await vault.markAdapterSynced(entry.id, 'test-fs');
			await testAdapter.write('temp.md', 'temporary');
			expect(await testAdapter.read('temp.md')).toBe('temporary');

			await vault.delete(entry.id);

			const pushPromise = engine.scheduleSync();
			await waitForDebounce();
			await pushPromise;

			await expect(testAdapter.read('temp.md')).rejects.toThrow();
		});

		it('should push rename operations to adapters', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, vault, testAdapter } = ctx;

			await vault.init();

			await vault.createFile('old.md', 'rename me');
			const entry = vault.getByPath('old.md')!;
			await vault.markAdapterSynced(entry.id, 'test-fs');
			await testAdapter.write('old.md', 'rename me');
			expect(await testAdapter.read('old.md')).toBe('rename me');

			await vault.renameEntry(entry.id, 'new.md');

			const pushPromise = engine.scheduleSync();
			await waitForDebounce();
			await pushPromise;

			await expect(testAdapter.read('old.md')).rejects.toThrow();
			expect(await testAdapter.read('new.md')).toBe('rename me');
		});

		it('should set syncFailed on push error', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, vault, testAdapter } = ctx;

			await vault.init();
			await vault.createFile('note.md', 'content');

			const originalWrite = testAdapter.write.bind(testAdapter);
			testAdapter.write = () => {
				throw new Error('Disk full');
			};

			const pushPromise = engine.scheduleSync();
			await waitForDebounce();
			await pushPromise;

			expect(engine.syncFailed()).toBe(true);
			expect(engine.lastSyncError()).not.toBeNull();

			testAdapter.write = originalWrite;
		});
	});

	describe('forcePull', () => {
		it('should import files from adapters', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, vault, testAdapter } = ctx;

			await vault.init();

			await testAdapter.createDir('subdir');
			await testAdapter.write('subdir/hello.md', 'hello from disk');
			await testAdapter.write('readme.md', '# Readme');

			await engine.forcePull();

			const readme = vault.getByPath('readme.md');
			expect(readme).toBeDefined();
			expect(readme?.content).toBe('# Readme');

			const hello = vault.getByPath('subdir/hello.md');
			expect(hello).toBeDefined();
			expect(hello?.content).toBe('hello from disk');

			const subdir = vault.getByPath('subdir');
			expect(subdir).toBeDefined();
			expect(subdir?.type).toBe('folder');
		});

		it('should orphan-detect vault entries not on remote after pull', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, vault } = ctx;

			await vault.init();

			await vault.createFile('orphan.md', 'not on disk');
			const entry = vault.getByPath('orphan.md')!;
			await vault.markAdapterSynced(entry.id, 'test-fs');

			await engine.forcePull();

			expect(vault.getByPath('orphan.md')).toBeUndefined();
		});

		it('should not orphan-remove entries with pending adapters', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, vault } = ctx;

			await vault.init();

			await vault.createFile('pending.md', 'not pushed yet');

			await engine.forcePull();

			expect(vault.getByPath('pending.md')).toBeDefined();
		});

		it('should set syncFailed on pull error', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, testAdapter } = ctx;

			// Make list() throw
			testAdapter.list = () => {
				throw new Error('Connection lost');
			};

			await engine.forcePull();

			expect(engine.syncFailed()).toBe(true);
			expect(engine.lastSyncError()).not.toBeNull();
		});
	});

	describe('syncAll (pull + push)', () => {
		it('should pull then push', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, vault, testAdapter } = ctx;

			await vault.init();

			await testAdapter.write('remote.md', 'from disk');

			await engine.syncAll();

			const remote = vault.getByPath('remote.md');
			expect(remote).toBeDefined();
			expect(remote?.content).toBe('from disk');
			expect(engine.syncFailed()).toBe(false);
		});

		it('should push vault changes after pulling external ones', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, vault, testAdapter } = ctx;

			await vault.init();

			await testAdapter.write('external.md', 'external');

			await vault.createFile('local.md', 'local');

			await engine.syncAll();

			expect(vault.getByPath('external.md')?.content).toBe('external');

			const localOnDisk = await testAdapter.read('local.md');
			expect(localOnDisk).toBe('local');
		});
	});

	describe('watch integration', () => {
		it('should start and stop watching', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, vault, testAdapter } = ctx;

			await vault.init();

			// Start watching
			await engine.startWatching();

			// External change should be detected
			testAdapter.simulateExternalChange(
				'create',
				'watch-test.md',
				'watch content',
			);
			await timeout(350);
			expect(vault.getByPath('watch-test.md')).toBeDefined();

			// Stop watching
			engine.stopWatching();
		});

		it('should handle external events through watch', async () => {
			const ws2 = createMockWorkspace();
			const ctx2 = setupSyncEngine(ws2);
			const { engine: e2, vault: v2, testAdapter: ta2 } = ctx2;

			await v2.init();
			await e2.startWatching();

			ta2.simulateExternalChange(
				'create',
				'watch-file.md',
				'created via watch',
			);

			await timeout(350);

			const entry = v2.getByPath('watch-file.md');
			expect(entry).toBeDefined();
			expect(entry?.content).toBe('created via watch');

			e2.stopWatching();
		});

		it('should handle external delete through watch', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, vault, testAdapter } = ctx;

			await vault.init();
			await vault.createFile('delete-me.md', 'about to be deleted');
			const entry = vault.getByPath('delete-me.md')!;
			await vault.markAdapterSynced(entry.id, 'test-fs');

			await engine.startWatching();

			testAdapter.files.delete('delete-me.md');
			testAdapter.simulateExternalChange('delete', 'delete-me.md');

			await timeout(350);

			expect(vault.getByPath('delete-me.md')).toBeUndefined();

			engine.stopWatching();
		});

		it('should handle external rename through watch', async () => {
			const ws = createMockWorkspace();
			const ctx = setupSyncEngine(ws);
			const { engine, vault, testAdapter } = ctx;

			await vault.init();
			await vault.createFile('old-watch.md', 'renamed externally');
			const entry = vault.getByPath('old-watch.md')!;
			await vault.markAdapterSynced(entry.id, 'test-fs');

			await engine.startWatching();

			testAdapter.files.set('new-watch.md', 'renamed externally');
			testAdapter.files.delete('old-watch.md');
			testAdapter.simulateExternalChange(
				'rename',
				'new-watch.md',
				'renamed externally',
				'old-watch.md',
			);

			await timeout(350);

			expect(vault.getByPath('old-watch.md')).toBeUndefined();
			const renamed = vault.getByPath('new-watch.md');
			expect(renamed).toBeDefined();
			expect(renamed?.content).toBe('renamed externally');

			engine.stopWatching();
		});
	});
});
