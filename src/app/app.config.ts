import { provideTaiga } from '@taiga-ui/core';
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TuiDialogService } from '@taiga-ui/core/portals/dialog';

import { routes } from './app.routes';
import { ADAPTERS } from './core/adapters/token';
import { TauriFsAdapter } from './core/adapters/local/tauri-fs.adapter';
import { BrowserFileSystemApiAdapter } from './core/adapters/local/browser-file-system-api.adapter';
import { TestFsAdapter } from './core/adapters/test-fs.adapter';

export const appConfig: ApplicationConfig = {
	providers: [
		provideRouter(routes),
		// Taiga UI dialog service — enables modal dialogs
		TuiDialogService,
		provideTaiga(),
		// Register local storage adapters for workspace picking & file I/O
		{
			provide: ADAPTERS,
			useFactory: () => [
				new TauriFsAdapter(),
				new BrowserFileSystemApiAdapter(),
				new TestFsAdapter(),
			],
		},
	],
};
