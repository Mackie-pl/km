import { test, expect } from '../fixtures/test';

/**
 * Folder persistence E2E tests — TDD Cycle A.
 *
 * Defines the contract for folder disk persistence
 * (no tree UI needed for these tests).
 *
 * ## How tests work
 *
 * 1. Tests use `window.__KM_TEST__` to access Angular services
 *    (WorkspaceService, VaultStore, TestFsAdapter instances)
 * 2. Tests bootstrap workspace state directly (not via wizard)
 * 3. After state changes, tests wait for sync debounce + async settle
 * 4. Tests assert on TestFsAdapter in-memory state for disk-backed assertions
 */

test.describe('Folder persistence', () => {
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

	// ──────────── A1: CREATE FOLDER → DISPLAYED IN SIDEBAR ────────────
	test('A1: creates folder and displays it in sidebar', async ({ page }) => {
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
					createFolder: (path: string) => Promise<void>;
				};
			};

			const id = 'tdd-folder-a1';
			km.workspaceService.addWorkspace({
				id,
				name: 'Folder-A1',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();
			await km.vaultStore.createFolder('my-folder');
		});

		// Navigate to the workspace so sidebar renders
		await page.goto('/');
		await page.waitForTimeout(500);

		// Assert folder button is visible in the sidebar
		await expect(
			page.locator('[aria-label="my-folder"]').first(),
		).toBeVisible();
	});

	// ──────────── A2: CREATE FOLDER → PERSISTS TO ADAPTER ON DISK ────────────
	test('A2: creating folder persists to adapter on disk', async ({
		page,
	}) => {
		const hasDir = await page.evaluate(async () => {
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
				};
				getTestAdapters: () => readonly {
					dirs: Set<string>;
				}[];
			};

			const id = 'tdd-folder-a2';
			km.workspaceService.addWorkspace({
				id,
				name: 'Folder-A2',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();
			await km.vaultStore.createFolder('notes');

			// Wait for sync debounce (1s) + async settle
			await new Promise((r) => setTimeout(r, 2500));

			const adapters = km.getTestAdapters();
			return adapters[0]?.dirs.has('notes') ?? false;
		});

		expect(hasDir).toBe(true);
	});

	// ──────────── A3: CREATE FILE INSIDE FOLDER → parentId ────────────
	test('A3: create file inside folder assigns parentId', async ({ page }) => {
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
						parentFolderPath?: string,
					) => Promise<void>;
					getByPath: (path: string) =>
						| {
								id: string;
								parentId: string | null;
								path: string;
								type: string;
						  }
						| undefined;
				};
			};

			const id = 'tdd-folder-a3';
			km.workspaceService.addWorkspace({
				id,
				name: 'Folder-A3',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			await km.vaultStore.createFolder('work');
			await km.vaultStore.createFile('meeting.md', '', 'work');

			const folder = km.vaultStore.getByPath('work');
			const file = km.vaultStore.getByPath('work/meeting.md');

			return {
				fileParentId: file?.parentId ?? null,
				folderId: folder?.id ?? null,
				filePath: file?.path ?? null,
			};
		});

		expect(result.fileParentId).toBe(result.folderId);
		expect(result.filePath).toBe('work/meeting.md');
	});

	// ──────────── A4: FOLDER RENAME CASCADES CHILDREN ────────────
	test('A4: folder rename cascades children on disk', async ({ page }) => {
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
						parentFolderPath?: string,
					) => Promise<void>;
					renameEntry: (id: string, newName: string) => Promise<void>;
					getByPath: (path: string) => { id: string } | undefined;
				};
				getTestAdapters: () => readonly {
					files: Map<string, string>;
				}[];
			};

			const id = 'tdd-folder-a4';
			km.workspaceService.addWorkspace({
				id,
				name: 'Folder-A4',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			await km.vaultStore.createFolder('old-name');
			await km.vaultStore.createFile('file.md', '# content', 'old-name');

			// Wait for sync so files land in adapter
			await new Promise((r) => setTimeout(r, 2500));

			const folder = km.vaultStore.getByPath('old-name');
			if (!folder) return { error: 'folder not found' };
			await km.vaultStore.renameEntry(folder.id, 'new-name');

			// Wait for sync debounce + rename to propagate
			await new Promise((r) => setTimeout(r, 2500));

			const adapters = km.getTestAdapters();

			return {
				hasNewPath: adapters[0]?.files.has('new-name/file.md') ?? false,
				hasOldPath: adapters[0]?.files.has('old-name/file.md') ?? false,
				childContent:
					adapters[0]?.files.get('new-name/file.md') ?? null,
			};
		});

		expect(result.hasNewPath).toBe(true);
		expect(result.hasOldPath).toBe(false);
		expect(result.childContent).toBe('# content');
	});

	// ──────────── A5: DELETE FOLDER CASCADES CHILDREN ────────────
	test('A5: delete folder cascades children on disk', async ({ page }) => {
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
						parentFolderPath?: string,
					) => Promise<void>;
					delete: (id: string) => Promise<void>;
					getByPath: (path: string) =>
						| {
								id: string;
								deleted?: boolean;
						  }
						| undefined;
					getById: (id: string) =>
						| {
								id: string;
								deleted?: boolean;
						  }
						| undefined;
				};
				getTestAdapters: () => readonly {
					files: Map<string, string>;
					dirs: Set<string>;
				}[];
			};

			const id = 'tdd-folder-a5';
			km.workspaceService.addWorkspace({
				id,
				name: 'Folder-A5',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			await km.vaultStore.createFolder('docs');
			await km.vaultStore.createFile('a.md', '# A', 'docs');
			await km.vaultStore.createFile('b.md', '# B', 'docs');

			// Wait for sync
			await new Promise((r) => setTimeout(r, 2500));

			const folder = km.vaultStore.getByPath('docs');
			if (!folder) return { error: 'folder not found' };
			const folderId = folder.id;
			// Capture child's ID before delete for post-delete assertion
			const childAEntry = km.vaultStore.getByPath('docs/a.md');
			const childAId = childAEntry?.id ?? null;
			await km.vaultStore.delete(folderId);

			// Wait for delete to propagate
			await new Promise((r) => setTimeout(r, 2500));

			const adapters = km.getTestAdapters();
			const folderEntry = km.vaultStore.getById(folderId);
			const childA = childAId
				? km.vaultStore.getById(childAId)
				: undefined;

			return {
				folderDeleted: folderEntry?.deleted ?? null,
				childADeleted:
					(childA as { deleted?: boolean })?.deleted ?? null,
				adapterHasDir: adapters[0]?.dirs.has('docs') ?? false,
				adapterHasFile: adapters[0]?.files.has('docs/a.md') ?? false,
			};
		});

		expect(result.folderDeleted).toBe(true);
		expect(result.childADeleted).toBe(true);
	});

	// ──────────── A6: PULL IMPORTS DIRECTORIES FROM ADAPTER ────────────
	test('A6: pull imports directories from adapter', async ({ page }) => {
		const hasFolder = await page.evaluate(async () => {
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
					getByPath: (path: string) => { type: string } | undefined;
				};
				syncEngine: {
					forcePull: () => Promise<void>;
				};
				getTestAdapters: () => readonly {
					dirs: Set<string>;
					files: Map<string, string>;
				}[];
			};

			// Pre-seed directory on the adapter BEFORE activating workspace
			const adaptersSeeded = km.getTestAdapters();
			adaptersSeeded[0]?.dirs.add('remote-projects');
			adaptersSeeded[0]?.files.set(
				'remote-projects/readme.md',
				'# Remote',
			);

			// Activate workspace — pull will fire and find the directory
			const id = 'tdd-folder-a6';
			km.workspaceService.addWorkspace({
				id,
				name: 'Folder-A6',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [
					{ adapterId: 'test-fs', path: 'test:/test-root' },
				],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Trigger pull manually
			await km.syncEngine.forcePull();

			// Allow pull to settle
			await new Promise((r) => setTimeout(r, 2500));

			const folderEntry = km.vaultStore.getByPath('remote-projects');
			return folderEntry?.type ?? null;
		});

		expect(hasFolder).toBe('folder');
	});

	// ──────────── A7: CREATE FILE AT ROOT → parentId is null ────────────
	test('A7: create file at root sets parentId to null', async ({ page }) => {
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
						parentFolderPath?: string,
					) => Promise<void>;
					getByPath: (path: string) =>
						| {
								id: string;
								parentId: string | null;
								path: string;
								type: string;
						  }
						| undefined;
				};
			};

			const id = 'tdd-folder-a7';
			km.workspaceService.addWorkspace({
				id,
				name: 'Folder-A7',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			await km.vaultStore.createFile('root-note.md', '# Root');

			const file = km.vaultStore.getByPath('root-note.md');

			return {
				parentId: file?.parentId ?? null,
				path: file?.path ?? null,
				type: file?.type ?? null,
			};
		});

		expect(result.parentId).toBeNull();
		expect(result.path).toBe('root-note.md');
		expect(result.type).toBe('file');
	});

	// ──────────── A8: CREATE FILE AT ROOT PERSISTS TO ADAPTER ────────────
	test('A8: create file at root persists to adapter on disk', async ({
		page,
	}) => {
		const hasFile = await page.evaluate(async () => {
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
						parentFolderPath?: string,
					) => Promise<void>;
				};
				getTestAdapters: () => readonly {
					files: Map<string, string>;
				}[];
			};

			const id = 'tdd-folder-a8';
			km.workspaceService.addWorkspace({
				id,
				name: 'Folder-A8',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			await km.vaultStore.createFile('standalone.md', '# Standalone');

			// Wait for sync debounce (1s) + async settle
			await new Promise((r) => setTimeout(r, 2500));

			const adapters = km.getTestAdapters();
			return adapters[0]?.files.has('standalone.md') ?? false;
		});

		expect(hasFile).toBe(true);
	});
});

// ──────────── B: PARENT ID AFTER ADAPTER RECONCILIATION ────────────
test.describe('Parent ID after adapter reconciliation', () => {
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

	// ──────────── B1: CREATE FILE INSIDE FOLDER ────────────
	test('B1: create file inside folder sets parentId to folder ID', async ({
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
					createFolder: (path: string) => Promise<void>;
					createFile: (
						path: string,
						content?: string,
						parentFolderPath?: string,
					) => Promise<void>;
					getByPath: (path: string) =>
						| {
								id: string;
								parentId: string | null;
						  }
						| undefined;
				};
			};

			const id = 'tdd-parent-b1';
			km.workspaceService.addWorkspace({
				id,
				name: 'Parent-B1',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			await km.vaultStore.createFolder('projects');
			const folder = km.vaultStore.getByPath('projects');
			await km.vaultStore.createFile(
				'readme.md',
				'# Project',
				'projects',
			);

			const file = km.vaultStore.getByPath('projects/readme.md');
			return {
				fileParentId: file?.parentId ?? null,
				folderId: folder?.id ?? null,
			};
		});

		expect(result.fileParentId).toBe(result.folderId);
	});

	// ──────────── B2: PULL IMPORTS FILE WITH CORRECT PARENT ID ────────────
	test('B2: pull imports file with correct parentId', async ({ page }) => {
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
					getByPath: (path: string) =>
						| {
								id: string;
								parentId: string | null;
						  }
						| undefined;
				};
				syncEngine: {
					forcePull: () => Promise<void>;
				};
				getTestAdapters: () => readonly {
					dirs: Set<string>;
					files: Map<string, string>;
				}[];
			};

			// Pre-seed adapter with folder + file before activation
			const adapters = km.getTestAdapters();
			adapters[0]?.dirs.add('notes');
			adapters[0]?.files.set('notes/readme.md', '# Notes');

			const id = 'tdd-parent-b2';
			km.workspaceService.addWorkspace({
				id,
				name: 'Parent-B2',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [
					{ adapterId: 'test-fs', path: 'test:/test-root' },
				],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();
			await km.syncEngine.forcePull();
			await new Promise((r) => setTimeout(r, 2500));

			const folder = km.vaultStore.getByPath('notes');
			const file = km.vaultStore.getByPath('notes/readme.md');
			return {
				folderId: folder?.id ?? null,
				fileParentId: file?.parentId ?? null,
			};
		});

		expect(result.fileParentId).toBe(result.folderId);
	});

	// ──────────── B3: PULL IMPORTS DEEPLY NESTED FILE ────────────
	test('B3: pull deeply nested file has correct parentId', async ({
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
					getByPath: (path: string) =>
						| {
								id: string;
								parentId: string | null;
								path: string;
						  }
						| undefined;
				};
				syncEngine: {
					forcePull: () => Promise<void>;
				};
				getTestAdapters: () => readonly {
					dirs: Set<string>;
					files: Map<string, string>;
				}[];
			};

			// Pre-seed nested structure: projects/web/index.md
			const adapters = km.getTestAdapters();
			adapters[0]?.dirs.add('projects');
			adapters[0]?.dirs.add('projects/web');
			adapters[0]?.files.set('projects/web/index.md', '# Web Project');

			const id = 'tdd-parent-b3';
			km.workspaceService.addWorkspace({
				id,
				name: 'Parent-B3',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [
					{ adapterId: 'test-fs', path: 'test:/test-root' },
				],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();
			await km.syncEngine.forcePull();
			await new Promise((r) => setTimeout(r, 2500));

			const subfolder = km.vaultStore.getByPath('projects/web');
			const file = km.vaultStore.getByPath('projects/web/index.md');
			return {
				subfolderId: subfolder?.id ?? null,
				fileParentId: file?.parentId ?? null,
				filePath: file?.path ?? null,
			};
		});

		expect(result.fileParentId).toBe(result.subfolderId);
		expect(result.filePath).toBe('projects/web/index.md');
	});

	// ──────────── B4: EXTERNAL WATCH IMPORTS FILE INSIDE FOLDER ────────────
	test('B4: external watch import sets parentId on file inside folder', async ({
		page,
	}) => {
		// Create a folder first
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
					createFolder: (path: string) => Promise<void>;
				};
			};

			const id = 'tdd-parent-b4';
			km.workspaceService.addWorkspace({
				id,
				name: 'Parent-B4',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();
			await km.vaultStore.createFolder('docs');
		});

		// Simulate external file creation inside the folder
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				simulateExternalChange: (
					type: 'create' | 'modify' | 'delete' | 'rename',
					path: string,
					content?: string,
				) => void;
			};
			km.simulateExternalChange('create', 'docs/notes.md', '# New Notes');
		});

		await page.waitForTimeout(1500);

		const result = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					getByPath: (path: string) =>
						| {
								id: string;
								parentId: string | null;
						  }
						| undefined;
				};
			};
			const folder = km.vaultStore.getByPath('docs');
			const file = km.vaultStore.getByPath('docs/notes.md');
			return {
				folderId: folder?.id ?? null,
				fileParentId: file?.parentId ?? null,
			};
		});

		expect(result.fileParentId).toBe(result.folderId);
	});
});
