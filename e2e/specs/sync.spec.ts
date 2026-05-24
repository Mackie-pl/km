import { test, expect } from '../fixtures/test';

/**
 * Read the KM test hook from the window object.
 * Wrapped in a helper to avoid repetitive `unknown` casts.
 */
function getKmHook(): Record<string, unknown> | undefined {
	const hook = (window as unknown as Record<string, unknown>)['__KM_TEST__'];
	return typeof hook === 'object' && hook !== null
		? (hook as Record<string, unknown>)
		: undefined;
}

/**
 * Sync engine E2E tests — TDD contract for Phase F+G.
 *
 * These tests define the EXACT behaviour the pendingAdapters model
 * and rewritten SyncEngineService must satisfy.
 *
 * ## Initial state: RED
 * Phase F (pendingAdapters) and Phase G (push+pull) are NOT implemented.
 * These tests define the contract they must satisfy.
 *
 * ## How tests work
 *
 * 1. Tests use `window.__KM_TEST__` to access Angular services
 *    (WorkspaceService, VaultStore, TestFsAdapter instances)
 * 2. Tests bootstrap workspace state directly (not via wizard)
 * 3. After state changes, tests wait for sync debounce + async settle
 * 4. Tests assert on TestFsAdapter in-memory state
 */

test.describe('Sync contract — pendingAdapters model', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// Verify test hook is available
		const hasHook = await page.evaluate(() => {
			return (
				typeof (window as unknown as Record<string, unknown>)[
					'__KM_TEST__'
				] === 'object'
			);
		});
		expect(hasHook).toBe(true);
	});

	// ──────────── SCENARIO 1: CREATE NOTE ────────────
	// Create note → pendingAdapters = all active adapters
	// → push writes to each adapter → pending becomes empty
	test('create note pushes content to active adapters', async ({ page }) => {
		const noteContent = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				workspaceService: {
					addWorkspace: (ws: {
						id: string;
						name: string;
						activeSyncAdapters: string[];
						adapterConfigs: unknown[];
					}) => void;
					activateWorkspace: (id: string) => void;
				};
				vaultStore: {
					init: () => Promise<void>;
					createFile: (
						path: string,
						content?: string,
					) => Promise<void>;
					getByPath: (path: string) =>
						| {
								id: string;
								pendingAdapters: string[];
								content?: string;
						  }
						| undefined;
				};
				getTestAdapters: () => readonly {
					files: Map<string, string>;
				}[];
			};

			const id = 'tdd-ws-1';
			km.workspaceService.addWorkspace({
				id,
				name: 'TDD-Test',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);

			await km.vaultStore.init();
			await km.vaultStore.createFile('test-note.md', '# Hello Sync');

			// Wait for sync debounce (1s) + async settle
			await new Promise((r) => setTimeout(r, 2500));

			const adapters = km.getTestAdapters();
			const adapterFile = adapters[0]?.files.get('test-note.md');
			return adapterFile ?? 'NOT_FOUND';
		});
		expect(noteContent).toBe('# Hello Sync');
	});

	// ──────────── SCENARIO 2: PULL ON IMPORT ────────────
	// Pre-populate TestFsAdapter → trigger pull → vault has the file
	test('pull imports remote file from TestFsAdapter', async ({ page }) => {
		// Pre-create a file directly in the adapter
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				workspaceService: {
					addWorkspace: (ws: {
						id: string;
						name: string;
						activeSyncAdapters: string[];
						adapterConfigs: unknown[];
					}) => void;
					activateWorkspace: (id: string) => void;
				};
				vaultStore: {
					init: () => Promise<void>;
					createFile: (
						path: string,
						content?: string,
					) => Promise<void>;
					markAdapterSynced: (
						id: string,
						adapterId: string,
					) => Promise<void>;
					getByPath: (
						path: string,
					) => { id: string; content?: string } | undefined;
				};
				syncEngine: {
					forcePull: () => Promise<void>;
				};
				getTestAdapters: () => readonly {
					files: Map<string, string>;
				}[];
			};

			// Pre-seed a file directly in the adapter BEFORE activating workspace
			const adapters = km.getTestAdapters();
			adapters[0]?.files.set('remote-note.md', '# Remote Content');

			// Now activate workspace — pull will fire and find the file
			const id = 'tdd-ws-pull';
			km.workspaceService.addWorkspace({
				id,
				name: 'TDD-Pull',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [
					{ adapterId: 'test-fs', path: 'test:/test-root' },
				],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Trigger another pull manually to ensure it runs after init
			await km.syncEngine.forcePull();
		});

		// Wait and verify pull imported the file
		const imported = await page.evaluate(async () => {
			// Allow pull to fire (triggered by workspace activation)
			await new Promise((r) => setTimeout(r, 2500));

			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					getByPath: (
						path: string,
					) =>
						| { content?: string; pendingAdapters: string[] }
						| undefined;
				};
			};
			return km.vaultStore.getByPath('remote-note.md');
		});

		expect(imported).toBeDefined();
		expect(imported?.content).toBe('# Remote Content');
	});

	// ──────────── SCENARIO 3: TWO ADAPTERS ────────────
	test('two adapters tracked independently', async ({ page }) => {
		const result = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				workspaceService: {
					addWorkspace: (ws: {
						id: string;
						name: string;
						activeSyncAdapters: string[];
						adapterConfigs: unknown[];
					}) => void;
					activateWorkspace: (id: string) => void;
				};
				vaultStore: {
					init: () => Promise<void>;
					createFile: (
						path: string,
						content?: string,
					) => Promise<void>;
					markAdapterSynced: (
						id: string,
						adapterId: string,
					) => Promise<void>;
					getByPath: (
						path: string,
					) => { id: string; pendingAdapters: string[] } | undefined;
				};
				getTestAdapters: () => readonly {
					files: Map<string, string>;
				}[];
			};

			const id = 'tdd-ws-2a';
			km.workspaceService.addWorkspace({
				id,
				name: 'TDD-2Adapters',
				activeSyncAdapters: ['test-fs', 'tauri-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Create a note — should have both adapters in pendingAdapters
			await km.vaultStore.createFile('multi-adapter.md', '# Two targets');

			// Mark one adapter as synced (simulating partial success)
			const entry = km.vaultStore.getByPath('multi-adapter.md');
			if (!entry) return 'NOT_FOUND';

			return {
				pendingAdaptersBefore: [...entry.pendingAdapters],
			};
		});

		expect(result).toBeDefined();
		if (
			result &&
			typeof result === 'object' &&
			'pendingAdaptersBefore' in result
		) {
			const pending = (result as { pendingAdaptersBefore: string[] })
				.pendingAdaptersBefore;
			expect(pending).toContain('test-fs');
			expect(pending).toContain('tauri-fs');
		}
	});

	// ──────────── SCENARIO 4: NO ADAPTERS ────────────
	test('no adapters — pendingAdapters is empty', async ({ page }) => {
		const result = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				workspaceService: {
					addWorkspace: (ws: {
						id: string;
						name: string;
						activeSyncAdapters: string[];
						adapterConfigs: unknown[];
					}) => void;
					activateWorkspace: (id: string) => void;
				};
				vaultStore: {
					init: () => Promise<void>;
					createFile: (
						path: string,
						content?: string,
					) => Promise<void>;
					getByPath: (
						path: string,
					) => { pendingAdapters: string[] } | undefined;
				};
			};

			const id = 'tdd-ws-0a';
			km.workspaceService.addWorkspace({
				id,
				name: 'NoAdapters',
				activeSyncAdapters: [],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();
			await km.vaultStore.createFile('offline.md', '# No sync needed');

			const entry = km.vaultStore.getByPath('offline.md');
			return entry ? entry.pendingAdapters : 'NOT_FOUND';
		});
		expect(result).toEqual([]);
	});

	// ──────────── SCENARIO 5: DELETE ────────────
	test('delete pushes adapter.delete()', async ({ page }) => {
		const result = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				workspaceService: {
					addWorkspace: (ws: {
						id: string;
						name: string;
						activeSyncAdapters: string[];
						adapterConfigs: unknown[];
					}) => void;
					activateWorkspace: (id: string) => void;
				};
				vaultStore: {
					init: () => Promise<void>;
					createFile: (
						path: string,
						content?: string,
					) => Promise<void>;
					delete: (id: string) => Promise<void>;
					getByPath: (path: string) => { id: string } | undefined;
				};
				getTestAdapters: () => readonly {
					files: Map<string, string>;
				}[];
			};

			const id = 'tdd-ws-del';
			km.workspaceService.addWorkspace({
				id,
				name: 'TDD-Delete',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Create, wait for push, then delete
			await km.vaultStore.createFile('to-delete.md', '# Delete me');
			await new Promise((r) => setTimeout(r, 2500));

			const entry = km.vaultStore.getByPath('to-delete.md');
			if (!entry) return 'NOT_CREATED';

			const adapters = km.getTestAdapters();
			const inAdapterBefore = adapters[0]?.files.has('to-delete.md');

			await km.vaultStore.delete(entry.id);
			await new Promise((r) => setTimeout(r, 2500));

			const inAdapterAfter = adapters[0]?.files.has('to-delete.md');

			return { inAdapterBefore, inAdapterAfter };
		});

		expect(result).toEqual({
			inAdapterBefore: true,
			inAdapterAfter: false,
		});
	});
});

// ──────────── INBOUND SYNC SCENARIOS ────────────
test.describe('Inbound sync — watch() + applyExternalFile', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
	});

	// ──────────── SCENARIO 6: EXTERNAL MODIFY ────────────
	// External file modified → simulateExternalChange → watch callback fires
	// → SyncEngine.handleExternalChanges → VaultStore.applyExternalFile
	// → vault entry updated → UI sees new content
	test('external modify updates vault content', async ({ page }) => {
		// Set up workspace + create a file first
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				workspaceService: {
					addWorkspace: (ws: {
						id: string;
						name: string;
						activeSyncAdapters: string[];
						adapterConfigs: unknown[];
					}) => void;
					activateWorkspace: (id: string) => void;
				};
				vaultStore: {
					init: () => Promise<void>;
					createFile: (
						path: string,
						content?: string,
					) => Promise<void>;
					getByPath: (path: string) =>
						| {
								id: string;
								content?: string;
						  }
						| undefined;
				};
				simulateExternalChange: (
					type: 'create' | 'modify' | 'delete',
					path: string,
					content?: string,
				) => void;
			};

			const id = 'tdd-ws-watch-1';
			km.workspaceService.addWorkspace({
				id,
				name: 'TDD-Watch',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Create a local file first
			await km.vaultStore.createFile('watchable.md', '# Original');
			await new Promise((r) => setTimeout(r, 1500)); // wait for push
		});

		// Now simulate an external modification
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				simulateExternalChange: (
					type: 'create' | 'modify' | 'delete',
					path: string,
					content?: string,
				) => void;
			};
			km.simulateExternalChange(
				'modify',
				'watchable.md',
				'# Modified Externally',
			);
		});

		// Wait for async reconciliation
		await page.waitForTimeout(1000);

		// Verify vault was updated
		const updated = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					getByPath: (path: string) =>
						| {
								content?: string;
						  }
						| undefined;
				};
			};
			return km.vaultStore.getByPath('watchable.md');
		});

		expect(updated).toBeDefined();
		expect(updated?.content).toBe('# Modified Externally');
	});

	// ──────────── SCENARIO 7: EXTERNAL NEW FILE ────────────
	test('external new file is imported via watch', async ({ page }) => {
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				workspaceService: {
					addWorkspace: (ws: {
						id: string;
						name: string;
						activeSyncAdapters: string[];
						adapterConfigs: unknown[];
					}) => void;
					activateWorkspace: (id: string) => void;
				};
				vaultStore: {
					init: () => Promise<void>;
					getByPath: (
						path: string,
					) => { content?: string } | undefined;
				};
				simulateExternalChange: (
					type: 'create' | 'modify' | 'delete',
					path: string,
					content?: string,
				) => void;
			};

			const id = 'tdd-ws-watch-2';
			km.workspaceService.addWorkspace({
				id,
				name: 'TDD-Watch2',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();
		});

		// Simulate a new file appearing externally
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				simulateExternalChange: (
					type: 'create' | 'modify' | 'delete',
					path: string,
					content?: string,
				) => void;
			};
			km.simulateExternalChange('create', 'new-remote.md', '# Brand New');
		});

		await page.waitForTimeout(1000);

		const imported = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					getByPath: (
						path: string,
					) => { content?: string } | undefined;
				};
			};
			return km.vaultStore.getByPath('new-remote.md');
		});

		expect(imported).toBeDefined();
		expect(imported?.content).toBe('# Brand New');
	});

	// ──────────── SCENARIO 8: CONFLICT ON DIRTY ────────────
	test('external change with local unsaved changes creates conflict file', async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				workspaceService: {
					addWorkspace: (ws: {
						id: string;
						name: string;
						activeSyncAdapters: string[];
						adapterConfigs: unknown[];
					}) => void;
					activateWorkspace: (id: string) => void;
					setWorkspaceAdapters: (
						wsId: string,
						adapters: string[],
					) => void;
				};
				vaultStore: {
					init: () => Promise<void>;
					createFile: (
						path: string,
						content?: string,
					) => Promise<void>;
					updateFile: (id: string, content: string) => Promise<void>;
					getByPath: (path: string) =>
						| {
								id: string;
								content?: string;
								pendingAdapters: string[];
						  }
						| undefined;
				};
				simulateExternalChange: (
					type: 'create' | 'modify' | 'delete',
					path: string,
					content?: string,
				) => void;
			};

			const id = 'tdd-ws-conflict';
			km.workspaceService.addWorkspace({
				id,
				name: 'TDD-Conflict',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Create a file that has pendingAdapters (not synced yet)
			await km.vaultStore.createFile('conflict.md', '# Local version');

			// Simulate external modification while local has pending changes
			km.simulateExternalChange(
				'modify',
				'conflict.md',
				'# External version',
			);

			await new Promise((r) => setTimeout(r, 1000));

			// Original should still have local content
			const original = km.vaultStore.getByPath('conflict.md');
			// Conflict file should exist
			const conflictFile = km.vaultStore.getByPath(
				'conflict.conflict-test-fs.md',
			);

			return {
				originalContent: original?.content,
				hasConflictFile: conflictFile !== undefined,
				conflictContent: conflictFile?.content,
			};
		});

		expect(result).toBeDefined();
		expect(result?.originalContent).toBe('# Local version');
		expect(result?.hasConflictFile).toBe(true);
		expect(result?.conflictContent).toBe('# External version');
	});
});

test.describe('Adapter DI smoke tests', () => {
	test('TestFsAdapter is registered and accessible', async ({ page }) => {
		await page.goto('/');
		const hasAdapter = await page.evaluate(() => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as { getTestAdapters: () => readonly unknown[] } | undefined;
			return (km?.getTestAdapters()?.length ?? 0) > 0;
		});
		expect(hasAdapter).toBe(true);
	});

	test('invoke mock still works', async ({ page }) => {
		await page.goto('/');
		const hasInvoke = await page.evaluate(() => {
			const internals = (window as unknown as Record<string, unknown>)
				.__TAURI_INTERNALS__ as Record<string, unknown> | undefined;
			return typeof internals?.invoke === 'function';
		});
		expect(hasInvoke).toBe(true);
	});
});

// ──────────── RENAME CONTRACT ────────────
test.describe('Rename contract', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
	});

	// ──────────── SCENARIO R1: RENAME FILE PUSH ────────────
	// Rename file → pendingRenameFrom = old path → push executes adapter.rename()
	// → old file removed, new file created on adapter
	test('rename file pushes rename to adapter, old file removed', async ({
		page,
	}) => {
		const result = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				workspaceService: {
					addWorkspace: (ws: {
						id: string;
						name: string;
						activeSyncAdapters: string[];
						adapterConfigs: unknown[];
					}) => void;
					activateWorkspace: (id: string) => void;
				};
				vaultStore: {
					init: () => Promise<void>;
					createFile: (
						path: string,
						content?: string,
					) => Promise<void>;
					renameEntry: (id: string, newName: string) => Promise<void>;
					getByPath: (
						path: string,
					) => { id: string; name: string } | undefined;
				};
				getTestAdapters: () => readonly {
					files: Map<string, string>;
				}[];
			};

			const id = 'tdd-rename-push';
			km.workspaceService.addWorkspace({
				id,
				name: 'Rename-Push',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Create a file and wait for push
			await km.vaultStore.createFile('old-name.md', '# Rename me');
			await new Promise((r) => setTimeout(r, 2500));

			// Verify it was pushed
			const entry = km.vaultStore.getByPath('old-name.md');
			if (!entry) return 'NOT_CREATED';

			// Rename
			await km.vaultStore.renameEntry(entry.id, 'new-name.md');
			await new Promise((r) => setTimeout(r, 2500));

			const adapters = km.getTestAdapters();
			return {
				hasNew: adapters[0]?.files.has('new-name.md') ?? false,
				hasOld: adapters[0]?.files.has('old-name.md') ?? false,
			};
		});

		expect(result).not.toBe('NOT_CREATED');
		expect((result as { hasNew: boolean; hasOld: boolean }).hasNew).toBe(
			true,
		);
		expect((result as { hasNew: boolean; hasOld: boolean }).hasOld).toBe(
			false,
		);
	});

	// ──────────── SCENARIO R2: FOLDER RENAME CASCADE ────────────
	// Rename folder → children paths updated
	test('rename folder cascades to children paths', async ({ page }) => {
		const result = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				workspaceService: {
					addWorkspace: (ws: {
						id: string;
						name: string;
						activeSyncAdapters: string[];
						adapterConfigs: unknown[];
					}) => void;
					activateWorkspace: (id: string) => void;
				};
				vaultStore: {
					init: () => Promise<void>;
					createFolder: (path: string) => Promise<void>;
					createFile: (
						path: string,
						content?: string,
					) => Promise<void>;
					renameEntry: (id: string, newName: string) => Promise<void>;
					getByPath: (
						path: string,
					) => { id: string; name: string; path: string } | undefined;
				};
			};

			const id = 'tdd-rename-folder';
			km.workspaceService.addWorkspace({
				id,
				name: 'Rename-Folder',
				activeSyncAdapters: [],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Create folder with file inside
			await km.vaultStore.createFolder('notes');
			await km.vaultStore.createFile('notes/meeting.md', '# Meeting');

			const folder = km.vaultStore.getByPath('notes');
			if (!folder) return 'FOLDER_NOT_FOUND';

			// Rename folder
			await km.vaultStore.renameEntry(folder.id, 'journal');

			const child = km.vaultStore.getByPath('journal/meeting.md');
			const oldChild = km.vaultStore.getByPath('notes/meeting.md');
			const renamedFolder = km.vaultStore.getByPath('journal');

			return {
				childPath: child?.path ?? null,
				oldChildPath: oldChild?.path ?? null,
				folderName: renamedFolder?.name ?? null,
			};
		});

		expect(result).not.toBe('FOLDER_NOT_FOUND');
		const r = result as {
			childPath: string | null;
			oldChildPath: string | null;
			folderName: string | null;
		};
		expect(r.childPath).toBe('journal/meeting.md');
		expect(r.oldChildPath).toBeUndefined();
		expect(r.folderName).toBe('journal');
	});

	// ──────────── SCENARIO R3: EXTERNAL RENAME VIA WATCH ────────────
	// simulateExternalChange with type 'rename' → vault paths updated
	test('external rename via watch updates vault', async ({ page }) => {
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				workspaceService: {
					addWorkspace: (ws: {
						id: string;
						name: string;
						activeSyncAdapters: string[];
						adapterConfigs: unknown[];
					}) => void;
					activateWorkspace: (id: string) => void;
				};
				vaultStore: {
					init: () => Promise<void>;
					createFile: (
						path: string,
						content?: string,
					) => Promise<void>;
					getByPath: (
						path: string,
					) => { id: string; content?: string } | undefined;
				};
				simulateExternalChange: (
					type: 'create' | 'modify' | 'delete' | 'rename',
					path: string,
					content?: string,
					oldPath?: string,
				) => void;
			};

			const id = 'tdd-rename-external';
			km.workspaceService.addWorkspace({
				id,
				name: 'Rename-External',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Create a local file
			await km.vaultStore.createFile('original.md', '# Original');
			await new Promise((r) => setTimeout(r, 1500));

			// Simulate external rename
			km.simulateExternalChange(
				'rename',
				'renamed.md',
				'# Original',
				'original.md',
			);
		});

		await page.waitForTimeout(1000);

		const result = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					getByPath: (
						path: string,
					) => { path: string; content?: string } | undefined;
				};
			};
			const renamed = km.vaultStore.getByPath('renamed.md');
			const original = km.vaultStore.getByPath('original.md');
			return {
				renamedExists: renamed !== undefined,
				renamedContent: renamed?.content,
				originalExists: original !== undefined,
			};
		});

		expect(result.renamedExists).toBe(true);
		expect(result.renamedContent).toBe('# Original');
		expect(result.originalExists).toBe(false);
	});

	// ──────────── SCENARIO R4: PULL DETECTS ORPHANED ENTRY ────────────
	// Pre-populate adapter with file → vault has a different file that doesn't exist remotely
	// → pull detects orphan → orphan deleted
	test('pull detects orphaned entry after remote rename', async ({
		page,
	}) => {
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				workspaceService: {
					addWorkspace: (ws: {
						id: string;
						name: string;
						activeSyncAdapters: string[];
						adapterConfigs: unknown[];
					}) => void;
					activateWorkspace: (id: string) => void;
				};
				vaultStore: {
					init: () => Promise<void>;
					createFile: (
						path: string,
						content?: string,
					) => Promise<void>;
				};
				syncEngine: {
					forcePull: () => Promise<void>;
				};
				getTestAdapters: () => readonly {
					files: Map<string, string>;
				}[];
			};

			const adapters = km.getTestAdapters();

			// Pre-populate adapter with ONLY the renamed file
			adapters[0]?.files.set('current-name.md', '# Current');

			const id = 'tdd-rename-orphan';
			km.workspaceService.addWorkspace({
				id,
				name: 'Rename-Orphan',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [{ adapterId: 'test-fs', path: 'test:/root' }],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Create an orphan — a vault entry with no matching remote file
			await km.vaultStore.createFile('stale-orphan.md', '# Orphan');

			// Wait for push so adapter has it
			await new Promise((r) => setTimeout(r, 2500));

			// Now manually remove it from the adapter (simulating remote rename/delete)
			adapters[0]?.files.delete('stale-orphan.md');
			adapters[0]?.files.set('current-name.md', '# Still current');

			// Pull — should detect orphan
			await km.syncEngine.forcePull();
			await new Promise((r) => setTimeout(r, 1500));
		});

		const result = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					getByPath: (path: string) => { path: string } | undefined;
				};
			};
			return {
				orphanExists:
					km.vaultStore.getByPath('stale-orphan.md') !== undefined,
				currentExists:
					km.vaultStore.getByPath('current-name.md') !== undefined,
			};
		});

		expect(result.orphanExists).toBe(false);
		expect(result.currentExists).toBe(true);
	});
});
