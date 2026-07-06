import { provideTaiga } from '@taiga-ui/core';
import {
	ApplicationConfig,
	provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { TuiDialogService } from '@taiga-ui/core/portals/dialog';

import { routes } from './app.routes';
import { ADAPTERS } from './core/adapters/token';
import { TauriFsAdapter } from './core/adapters/local/tauri-fs.adapter';
import { BrowserFileSystemApiAdapter } from './core/adapters/local/browser-file-system-api.adapter';
import { TestFsAdapter } from './core/adapters/test-fs.adapter';
import { GitAdapterProxy } from './core/adapters/cloud/git/adapter-proxy';
import { GDriveAdapterProxy } from './core/adapters/cloud/gdrive/adapter-proxy';
import type { Adapter } from './core/adapters/adapter.interface';

/**
 * Check whether the Tauri runtime is available at bootstrap time.
 * Inlined helper — not using PlatformService since it's not ready yet.
 */
function isTauriRuntime(): boolean {
	return (
		typeof window !== 'undefined' &&
		(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] !=
			null
	);
}

export const appConfig: ApplicationConfig = {
	providers: [
		provideZonelessChangeDetection(),
		provideRouter(routes, withComponentInputBinding()),
		// Taiga UI dialog service — enables modal dialogs
		TuiDialogService,
		provideTaiga(),
		// Register storage adapters.
		// Desktop (Tauri)  → TauriFsAdapter for native file I/O via Rust.
		// Browser           → BrowserFileSystemApiAdapter via File System Access API.
		// TestFsAdapter is always available for E2E tests.
		{
			provide: ADAPTERS,
			useFactory: () => {
				const adapters: Adapter[] = [new TestFsAdapter()];
				if (isTauriRuntime()) {
					adapters.push(new TauriFsAdapter());
				} else {
					adapters.push(new BrowserFileSystemApiAdapter());
				}
				// Cloud adapters (lazy-loaded). Git is Tauri-only; GDrive is
				// browser-only for now (OAuth popup + CORS fetch) — each proxy
				// gates its own availability via isAvailable().
				adapters.push(new GitAdapterProxy());
				adapters.push(new GDriveAdapterProxy());
				return adapters;
			},
		},
	],
};
