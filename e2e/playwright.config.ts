import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for dotta (Angular + Tauri 2.0).
 *
 * Tests run against `ng serve` (browser mode, no Tauri backend).
 * Tauri APIs are mocked via addInitScript in the test fixture.
 *
 * @see {@link https://playwright.dev/docs/test-configuration}
 */
export default defineConfig({
	/* Where to find test files */
	testDir: './specs',

	/* Fail the build on CI if you accidentally left test.only in the source code */
	forbidOnly: !!process.env.CI,

	/* Retry once on CI, none locally */
	retries: process.env.CI ? 1 : 0,

	/* Parallelism — single worker locally avoids port conflicts */
	workers: process.env.CI ? 2 : 1,

	/* Reporters */
	reporter: [
		[process.env.CI ? 'github' : 'list'],
		['html', { outputFolder: '../dist/e2e-report' }],
	],

	/* Shared settings for all projects */
	use: {
		baseURL: 'http://localhost:1420',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},

	/* Project matrix — start with Chromium only, add others later */
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],

	/* Auto-start the Angular dev server before tests */
	webServer: {
		command: 'pnpm start',
		url: 'http://localhost:1420',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});