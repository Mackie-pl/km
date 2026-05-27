import { test, expect } from '../fixtures/test';

/**
 * Set platform to "browser mode" so the sync button can appear.
 * The E2E Tauri mock sets isDesktopTauri=true by default, which hides
 * the button unconditionally. Browser-mode tests call this first.
 */
async function setBrowserMode(page: typeof test.prototype.page): Promise<void> {
	await page.evaluate(() => {
		const km = (window as unknown as Record<string, unknown>)[
			'__KM_TEST__'
		] as {
			platformService: {
				isDesktopTauri: { set: (v: boolean) => void };
				isDesktop: { set: (v: boolean) => void };
			};
		};
		km.platformService.isDesktopTauri.set(false);
		km.platformService.isDesktop.set(true);
	});
}

/**
 * Sync button visibility E2E tests.
 *
 * The "Sync now" button should only appear in the header when:
 * 1. Running in browser (not desktop Tauri)
 * 2. Background auto-sync has failed (syncFailed signal = true)
 *
 * It should auto-hide on successful sync, and show a spinner while syncing.
 */
test.describe('Sync button visibility', () => {
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

	// ──────────── S1: BUTTON HIDDEN WHEN SYNC SUCCEEDS ────────────
	test('S1: button hidden when auto-sync succeeds', async ({ page }) => {
		await setBrowserMode(page);

		// Set up a workspace with a test-fs adapter — sync should succeed
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
				};
				syncEngine: {
					syncAll: () => Promise<void>;
				};
			};

			const id = 'btn-s1';
			km.workspaceService.addWorkspace({
				id,
				name: 'Button-S1',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Run a full sync cycle — should succeed with test-fs adapter
			await km.syncEngine.syncAll();
		});

		await page.waitForTimeout(500);

		// Button should NOT be visible (sync succeeded, no error)
		const button = page.locator(
			'button[aria-label="Sync now — auto-sync failed"]',
		);
		await expect(button).toHaveCount(0);
	});

	// ──────────── S2: BUTTON VISIBLE ON SYNC FAILURE ────────────
	test('S2: button visible on sync failure', async ({ page }) => {
		await setBrowserMode(page);

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
				};
				syncEngine: {
					syncFailed: { set: (v: boolean) => void };
					lastSyncError: { set: (v: string | null) => void };
				};
			};

			const id = 'btn-s2';
			km.workspaceService.addWorkspace({
				id,
				name: 'Button-S2',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [
					{
						adapterId: 'test-fs',
						path: 'test:/s2-root',
					},
				],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Simulate a sync failure
			km.syncEngine.syncFailed.set(true);
			km.syncEngine.lastSyncError.set(
				'Permission denied: test-fs adapter not available',
			);
		});

		await page.waitForTimeout(500);

		// Button SHOULD be visible
		const button = page.locator(
			'button[aria-label="Sync now — auto-sync failed"]',
		);
		await expect(button).toHaveCount(1);
		await expect(button).toBeVisible();
	});

	// ──────────── S3: BUTTON HIDDEN ON DESKTOP TAURI ────────────
	test('S3: button hidden on desktop Tauri', async ({ page }) => {
		// The Tauri mock already sets isDesktopTauri=true by default.
		// Do NOT call setBrowserMode — we want the native-Tauri path.

		// Set syncFailed to ensure we'd see the button if the Tauri
		// check weren't there
		await page.evaluate(async () => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				syncEngine: {
					syncFailed: { set: (v: boolean) => void };
					lastSyncError: { set: (v: string | null) => void };
				};
			};
			km.syncEngine.syncFailed.set(true);
			km.syncEngine.lastSyncError.set('Test error');
		});

		await page.waitForTimeout(500);

		// Button should NOT be visible because we're on Tauri desktop
		const button = page.locator(
			'button[aria-label="Sync now — auto-sync failed"]',
		);
		await expect(button).toHaveCount(0);
	});

	// ──────────── S4: CLICKING BUTTON CLEARS ERROR ON SUCCESS ────────────
	test('S4: clicking button clears error on success', async ({ page }) => {
		await setBrowserMode(page);

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
				};
				syncEngine: {
					syncFailed: { set: (v: boolean) => void };
					lastSyncError: { set: (v: string | null) => void };
				};
			};

			const id = 'btn-s4';
			km.workspaceService.addWorkspace({
				id,
				name: 'Button-S4',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [
					{
						adapterId: 'test-fs',
						path: 'test:/s4-root',
					},
				],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Set a fake error
			km.syncEngine.syncFailed.set(true);
			km.syncEngine.lastSyncError.set('Temporary error');
		});

		await page.waitForTimeout(500);

		// Verify button is visible
		const button = page.locator(
			'button[aria-label="Sync now — auto-sync failed"]',
		);
		await expect(button).toHaveCount(1);

		// Click it — syncAll should succeed and clear the error
		await button.click();

		// Wait for sync to complete
		await page.waitForTimeout(2000);

		// After successful sync, button should disappear
		await expect(button).toHaveCount(0);
	});

	// ──────────── S5: SPINNER DURING SYNC ────────────
	test('S5: spinner icon during sync', async ({ page }) => {
		await setBrowserMode(page);

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
				};
				syncEngine: {
					syncFailed: { set: (v: boolean) => void };
					lastSyncError: { set: (v: string | null) => void };
					isSyncing: { set: (v: boolean) => void };
				};
			};

			const id = 'btn-s5';
			km.workspaceService.addWorkspace({
				id,
				name: 'Button-S5',
				activeSyncAdapters: ['test-fs'],
				adapterConfigs: [],
			});
			km.workspaceService.activateWorkspace(id);
			await km.vaultStore.init();

			// Set error state so button is visible
			km.syncEngine.syncFailed.set(true);
			km.syncEngine.lastSyncError.set('Transient error');
		});

		await page.waitForTimeout(500);

		// Now set isSyncing to true to trigger the spinner
		await page.evaluate(() => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				syncEngine: {
					isSyncing: { set: (v: boolean) => void };
				};
			};
			km.syncEngine.isSyncing.set(true);
		});

		await page.waitForTimeout(200);

		// The refresh icon should have the animate-spin class
		const spinner = page.locator(
			'button[aria-label="Sync now — auto-sync failed"] svg',
		);
		await expect(spinner).toHaveClass(/animate-spin/);

		// Clean up
		await page.evaluate(() => {
			const km = (window as unknown as Record<string, unknown>)[
				'__KM_TEST__'
			] as {
				syncEngine: {
					isSyncing: { set: (v: boolean) => void };
					syncFailed: { set: (v: boolean) => void };
					lastSyncError: { set: (v: string | null) => void };
				};
			};
			km.syncEngine.isSyncing.set(false);
			km.syncEngine.syncFailed.set(false);
			km.syncEngine.lastSyncError.set(null);
		});
	});
});
