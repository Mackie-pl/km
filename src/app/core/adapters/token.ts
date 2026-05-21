import { InjectionToken } from '@angular/core';
import { Adapter } from './adapter.interface';

/**
 * Register storage adapter instances here via `app.config.ts` providers.
 *
 * @example
 * {
 *   provide: ADAPTERS,
 *   useFactory: () => [new TauriFsAdapter(), new BrowserFileSystemApiAdapter()],
 * }
 */
export const ADAPTERS = new InjectionToken<Adapter[]>(
	'Cloud storage strategies',
);
