import { test, expect } from '../fixtures/test';

/**
 * Milkdown / Crepe editor E2E tests.
 *
 * These tests define the contract the new editor component must satisfy.
 * Phase A: RED — no editor yet, all tests fail.
 * Phase F: GREEN — after implementation, all tests pass.
 */

test.describe('Editor (Milkdown Crepe)', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// Verify the test hook is available
		const hasHook = await page.evaluate(() => {
			return (
				typeof (window as unknown as Record<string, unknown>)[
					'__KM_TEST__'
				] === 'object'
			);
		});
		expect(hasHook).toBe(true);
	});

	// ──────────── SCENARIO 1: Lazy load gate ────────────
	test('Milkdown JS not loaded before navigating to editor route', async ({
		page,
	}) => {
		// Stay on root — no editor route yet
		await expect(page.getByText('Welcome')).toBeVisible();
		// No Crepe/Milkdown classes on the page
		const hasMilkdown = await page.evaluate(() => {
			return (
				document.querySelector('.milkdown') !== null ||
				document.querySelector('.crepe') !== null
			);
		});
		expect(hasMilkdown).toBe(false);
	});

	test('navigates to editor route and shows Crepe editor', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('Editor Test');
		await page.goto('/e/test-note');

		// The Crepe editor root should be in the DOM
		await expect(page.locator('.milkdown')).toBeVisible({ timeout: 5000 });
	});

	// ──────────── SCENARIO 2: Content from VaultStore ────────────
	test('content from VaultStore appears in editor', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('Editor Content Test');
		const testContent = '# Hello World\n\nThis is a **test**.';

		// Create a file in the vault via the test hook
		await page.evaluate(async (content) => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					createFile: (
						path: string,
						content: string,
					) => Promise<void>;
				};
			};
			await km.vaultStore.createFile('test-note', content);
		}, testContent);

		// Navigate to the editor
		await page.goto('/e/test-note');

		// The editor should contain the markdown content
		// Milkdown renders markdown as rich text, so "Hello World" should be visible as an H1
		await expect(
			page.locator('.milkdown h1').getByText('Hello World'),
		).toBeVisible({ timeout: 5000 });
	});

	// ──────────── SCENARIO 3: Auto-save on edit ────────────
	test('editing content auto-saves to VaultStore', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('Auto-save Test');

		// Create a file with initial content
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					createFile: (
						path: string,
						content: string,
					) => Promise<void>;
				};
			};
			await km.vaultStore.createFile('auto-save-note', 'Initial');
		});

		await page.goto('/e/auto-save-note');
		await page.waitForSelector('.milkdown', { timeout: 5000 });

		// Type additional content into the editor
		// Focus the editor and type
		await page.locator('.milkdown').click();
		await page.locator('.milkdown .ProseMirror').fill('Updated content');

		// Wait for the debounced save
		await page.waitForTimeout(1500);

		// Check vault store has the updated content
		const storedContent = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					getByPath: (
						path: string,
					) => { content?: string } | undefined;
				};
			};
			return km.vaultStore.getByPath('auto-save-note')?.content ?? '';
		});

		expect(storedContent).toContain('Updated content');
	});

	// ──────────── SCENARIO 4: External vault update → editor refresh ────────────
	test('external VaultStore change updates editor content via Slice', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('External Update Test');

		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					createFile: (
						path: string,
						content: string,
					) => Promise<void>;
				};
			};
			await km.vaultStore.createFile('external-note', 'Original');
		});

		await page.goto('/e/external-note');
		await page.waitForSelector('.milkdown', { timeout: 5000 });

		// Now simulate an external vault update
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					getByPath: (
						path: string,
					) => { id: string; content?: string } | undefined;
					updateFile: (id: string, content: string) => Promise<void>;
				};
			};
			const entry = km.vaultStore.getByPath('external-note');
			if (entry) {
				await km.vaultStore.updateFile(
					entry.id,
					'## Updated Externally',
				);
			}
		});

		// Wait for editor to react to the change
		await page.waitForTimeout(1000);

		// The editor should now display the new content
		await expect(
			page.locator('.milkdown h2').getByText('Updated Externally'),
		).toBeVisible({ timeout: 3000 });
	});

	// ──────────── SCENARIO 5: No regress on concurrent edit ────────────
	test('edit after external change does not regress', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('No Regress Test');

		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					createFile: (
						path: string,
						content: string,
					) => Promise<void>;
				};
			};
			await km.vaultStore.createFile('no-regress-note', 'Base content');
		});

		await page.goto('/e/no-regress-note');
		await page.waitForSelector('.milkdown', { timeout: 5000 });

		// Simulate external update
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					getByPath: (
						path: string,
					) => { id: string; content?: string } | undefined;
					updateFile: (id: string, content: string) => Promise<void>;
				};
			};
			const entry = km.vaultStore.getByPath('no-regress-note');
			if (entry) {
				await km.vaultStore.updateFile(
					entry.id,
					'External base content',
				);
			}
		});

		await page.waitForTimeout(500);

		// User types new content
		await page.locator('.milkdown .ProseMirror').fill('User wrote this');

		await page.waitForTimeout(1500);

		// Vault should have user content, not external content
		const storedContent = await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					getByPath: (
						path: string,
					) => { content?: string } | undefined;
				};
			};
			return km.vaultStore.getByPath('no-regress-note')?.content ?? '';
		});

		expect(storedContent).toContain('User wrote this');
	});

	// ──────────── SCENARIO 6: Cleanup on navigation ────────────
	test('editor destroys on navigation away', async ({ workspace, page }) => {
		await workspace.createStandaloneWorkspace('Cleanup Test');

		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					createFile: (
						path: string,
						content: string,
					) => Promise<void>;
				};
			};
			await km.vaultStore.createFile('cleanup-note', 'Clean me');
		});

		await page.goto('/e/cleanup-note');
		await page.waitForSelector('.milkdown', { timeout: 5000 });

		// Navigate away
		await page.goto('/settings');

		// Editor DOM should be gone
		const hasEditor = await page.evaluate(() => {
			return document.querySelector('.milkdown') !== null;
		});
		expect(hasEditor).toBe(false);
	});

	// ──────────── SCENARIO 7: Switching entries ────────────
	test('switching entryId loads new content', async ({ workspace, page }) => {
		await workspace.createStandaloneWorkspace('Switch Test');

		// Create two notes
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				vaultStore: {
					createFile: (
						path: string,
						content: string,
					) => Promise<void>;
				};
			};
			await km.vaultStore.createFile('note-a', '# Note A');
			await km.vaultStore.createFile('note-b', '# Note B');
		});

		// Navigate to note-a
		await page.goto('/e/note-a');
		await page.waitForSelector('.milkdown', { timeout: 5000 });
		await expect(
			page.locator('.milkdown h1').getByText('Note A'),
		).toBeVisible();

		// Navigate to note-b
		await page.goto('/e/note-b');
		await page.waitForSelector('.milkdown', { timeout: 5000 });
		await expect(
			page.locator('.milkdown h1').getByText('Note B'),
		).toBeVisible();

		// Note A content should not be visible
		await expect(
			page.locator('.milkdown h1').getByText('Note A'),
		).not.toBeVisible();
	});
});
