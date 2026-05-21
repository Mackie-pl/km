import { test, expect } from '../fixtures/test';

/**
 * Smoke tests — verify the app boots and basic UI is present without Tauri.
 */
test.describe('App bootstrap', () => {
	test('shows Welcome screen when no workspace is active', async ({
		page,
	}) => {
		await page.goto('/');

		// The app shows the NoWorkspaceComponent overlay
		await expect(page.getByText('Welcome')).toBeVisible();
		await expect(
			page.getByRole('button', { name: /pick workspace/i }),
		).toBeVisible();
	});

	test('picks workspace and navigates to main view', async ({
		workspace,
		page,
	}) => {
		await page.goto('/');
		await workspace.createFolderWorkspace();

		// After picking a folder, the sidebar should be visible
		await expect(page.getByText('Notes').first()).toBeVisible();
		// The empty state should be visible (no notes yet)
		await expect(page.getByText('No notes yet')).toBeVisible();
	});

	test('creates standalone workspace via wizard', async ({
		workspace,
		page,
	}) => {
		await workspace.createStandaloneWorkspace('My Test Vault');

		// After creation, the workspace name appears in the sidebar
		await expect(page.getByText('My Test Vault')).toBeVisible();
	});

	test('settings page opens and theme toggle works', async ({
		workspace,
		page,
	}) => {
		await page.goto('/');
		await workspace.createFolderWorkspace();

		// Navigate to settings
		await page.goto('/settings');

		// Theme section should be visible
		await expect(page.getByText('Appearance')).toBeVisible();

		// Click "Dark" theme button
		const darkButton = page.getByRole('button', { name: /dark/i });
		await darkButton.click();

		// Check that the dark class was added to <html>
		const htmlClass = await page.evaluate(() =>
			document.documentElement.classList.contains('dark'),
		);
		expect(htmlClass).toBe(true);
	});

	test('workspace config page lists workspaces', async ({
		workspace,
		page,
	}) => {
		await page.goto('/');
		await workspace.createFolderWorkspace();

		// Navigate to workspace config
		await page.goto('/workspace');

		// Should show the workspace we created (the list item in workspace config)
		await expect(
			page.getByRole('main').getByText('notes', { exact: true }),
		).toBeVisible();
	});
});
