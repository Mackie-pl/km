import { test, expect } from '../fixtures/test';

/**
 * Sidebar file highlighting E2E tests — TDD contract.
 *
 * Phase A: RED — no highlight logic exists yet, all tests fail.
 * Phase F: GREEN — after implementing activeEntryPath in sidebar, all tests pass.
 */
test.describe('Sidebar file highlighting', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		const hasHook = await page.evaluate(() => {
			return (
				typeof (window as unknown as Record<string, unknown>)[
					'__KM_TEST__'
				] === 'object'
			);
		});
		expect(hasHook).toBe(true);
	});

	test('highlights the clicked file in the sidebar', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('Highlight Test');

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
			await km.vaultStore.createFile('file-alpha', '# Alpha');
			await km.vaultStore.createFile('file-beta', '# Beta');
		});

		await page.goto('/e/file-alpha');

		const alphaBtn = page
			.getByRole('button', { name: 'file-alpha' })
			.first();
		await expect(alphaBtn).toHaveAttribute('data-active', 'true');

		const betaBtn = page.getByRole('button', { name: 'file-beta' }).first();
		await expect(betaBtn).not.toHaveAttribute('data-active');
	});

	test('only one file is highlighted at a time', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('Single Highlight');

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
			await km.vaultStore.createFile('note-one', '# One');
			await km.vaultStore.createFile('note-two', '# Two');
		});

		await page.goto('/e/note-one');
		const oneBtn = page.getByRole('button', { name: 'note-one' }).first();
		await expect(oneBtn).toHaveAttribute('data-active', 'true');

		await page.goto('/e/note-two');
		const twoBtn = page.getByRole('button', { name: 'note-two' }).first();
		await expect(oneBtn).not.toHaveAttribute('data-active');
		await expect(twoBtn).toHaveAttribute('data-active', 'true');
	});

	test('navigating to a file route highlights the matching entry', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('Direct Nav');

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
			await km.vaultStore.createFile('direct-note', '# Direct');
		});

		await page.goto('/e/direct-note');
		const noteBtn = page
			.getByRole('button', { name: 'direct-note' })
			.first();
		await expect(noteBtn).toHaveAttribute('data-active', 'true');
	});

	test('no highlight when on a non-editor route', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('No Highlight');

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
			await km.vaultStore.createFile('settings-note', '# Settings');
		});

		await page.goto('/settings');
		const activeEntries = page.locator('[data-active="true"]');
		await expect(activeEntries).toHaveCount(0);
	});
});
