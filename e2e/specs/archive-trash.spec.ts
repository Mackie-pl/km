import { test, expect } from '../fixtures/test';

/**
 * Archive & Trash E2E — context-menu Archive, delete-to-trash, and the
 * /archive page (Archived + Trash tabs, restore, permanent delete).
 */
test.describe('Archive & Trash', () => {
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

	/** Create a file through the test hook. */
	async function createFile(
		page: import('@playwright/test').Page,
		path: string,
		content: string,
	): Promise<void> {
		await page.evaluate(
			async ({ path, content }) => {
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
				await km.vaultStore.createFile(path, content);
			},
			{ path, content },
		);
	}

	test('archives via context menu, then restores from the Archive page', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('Archive E2E');
		await createFile(page, 'keep-note', '# Keep');
		await createFile(page, 'arch-note', '# Archive me');

		const archNote = page.getByRole('button', { name: 'arch-note' }).first();
		await expect(archNote).toBeVisible();

		// Right-click → Archive
		await archNote.click({ button: 'right' });
		await page.getByRole('button', { name: 'Archive', exact: true }).click();

		// Gone from the tree, other note untouched
		await expect(archNote).toBeHidden();
		await expect(
			page.getByRole('button', { name: 'keep-note' }).first(),
		).toBeVisible();

		// Open the Archive page via the sidebar link
		await page.getByRole('link', { name: 'Archive' }).click();
		await page.waitForFunction(
			() => window.location.pathname === '/archive',
		);
		await expect(page.getByText('arch-note')).toBeVisible();

		// Restore → back in the tree
		await page.getByRole('button', { name: 'Restore' }).click();
		await expect(
			page.getByRole('button', { name: 'arch-note' }).first(),
		).toBeVisible();
	});

	test('delete sends to trash and restores from the Trash tab', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('Trash E2E');
		await createFile(page, 'trash-note', '# Trash me');

		const note = page.getByRole('button', { name: 'trash-note' }).first();
		await expect(note).toBeVisible();

		// Right-click → Delete (no confirmation dialog anymore)
		await note.click({ button: 'right' });
		await page.getByRole('button', { name: 'Delete', exact: true }).click();
		await expect(note).toBeHidden();

		// Archive page → Trash tab
		await page.getByRole('link', { name: 'Archive' }).click();
		await page.getByRole('button', { name: /^Trash \(/ }).click();
		await expect(page.getByText('trash-note')).toBeVisible();

		// Restore → recreated in the tree
		await page.getByRole('button', { name: 'Restore' }).click();
		await expect(
			page.getByRole('button', { name: 'trash-note' }).first(),
		).toBeVisible();
	});

	test('delete forever asks for confirmation and purges the record', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('Purge E2E');
		await createFile(page, 'doomed-note', '# Doomed');

		const note = page.getByRole('button', { name: 'doomed-note' }).first();
		await note.click({ button: 'right' });
		await page.getByRole('button', { name: 'Delete', exact: true }).click();

		await page.getByRole('link', { name: 'Archive' }).click();
		await page.getByRole('button', { name: /^Trash \(1\)/ }).click();
		await page.getByRole('button', { name: 'Delete forever' }).click();

		// Confirmation dialog appears; confirm it
		await expect(page.getByText('Permanently delete')).toBeVisible();
		await page
			.getByRole('button', { name: 'Delete Forever', exact: true })
			.click();

		await expect(
			page.getByRole('button', { name: /^Trash \(0\)/ }),
		).toBeVisible();
		await expect(
			page.getByText('doomed-note', { exact: true }),
		).toBeHidden();
	});
});
