import { test as base } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_PATH = resolve(__dirname, 'tauri-mock.js');

export type WorkspaceFixtures = {
	createFolderWorkspace: () => Promise<void>;
	createStandaloneWorkspace: (name: string) => Promise<void>;
};

export const test = base.extend<{
	workspace: WorkspaceFixtures;
}>({
	/* Inject Tauri APi mock via context-level init script (most reliable) */
	context: async ({ context }, use) => {
		await context.addInitScript({ path: MOCK_PATH });
		await use(context);
	},

	/* Workspace creation helpers */
	workspace: async ({ page }, use) => {
		async function createFolderWorkspace(): Promise<void> {
			// "Pick Workspace" on Welcome screen → navigates to wizard
			await page.getByRole('button', { name: /pick workspace/i }).click();
			await page.waitForFunction(
				() => window.location.pathname === '/workspace/new',
			);

			// Step 1: click "From Folder" card
			await page.getByText('From Folder').click();
			await page.waitForTimeout(400);

			// Step 2: click "Browse Folders" button
			await page.getByText('Browse Folders').click();
			await page.waitForTimeout(600);

			// Step 2: click "Continue →"
			await page.getByRole('button', { name: 'Continue' }).click();
			await page.waitForTimeout(400);

			// Step 3: click "Create Workspace"
			await page
				.getByRole('button', { name: /create workspace/i })
				.click();

			// Wait for SPA navigation away from wizard routes
			await page.waitForFunction(
				() => !window.location.pathname.includes('workspace'),
				{ timeout: 10000 },
			);
		}

		async function createStandaloneWorkspace(name: string): Promise<void> {
			// Navigate to wizard directly
			await page.goto('/workspace/new');
			await page.waitForFunction(
				() => window.location.pathname === '/workspace/new',
			);

			// Step 1: click "Standalone" card
			await page.getByText('Standalone').click();
			await page.waitForTimeout(400);

			// Step 2: type name and continue
			await page.locator('#workspace-name').fill(name);
			await page.getByRole('button', { name: 'Continue' }).click();
			await page.waitForTimeout(400);

			// Step 3: create
			await page
				.getByRole('button', { name: /create workspace/i })
				.click();

			// Wait for SPA navigation away from wizard routes
			await page.waitForFunction(
				() => !window.location.pathname.includes('workspace'),
				{ timeout: 10000 },
			);
		}

		await use({
			createFolderWorkspace,
			createStandaloneWorkspace,
		});
	},
});

export { expect } from '@playwright/test';
