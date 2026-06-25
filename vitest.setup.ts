import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
	BrowserDynamicTestingModule,
	platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

TestBed.initTestEnvironment(
	BrowserDynamicTestingModule,
	platformBrowserDynamicTesting(),
);

// Polyfill crypto.randomUUID for jsdom (not available in JSDOM)
if (typeof globalThis.crypto?.randomUUID !== 'function') {
	Object.defineProperty(globalThis, 'crypto', {
		value: {
			...globalThis.crypto,
			randomUUID: () =>
				'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
					const r = (Math.random() * 16) | 0;
					const v = c === 'x' ? r : (r & 0x3) | 0x8;
					return v.toString(16);
				}),
		},
		writable: false,
	});
}

// Give every test a fresh IndexedDB universe.
//
// All tests share one global `indexedDB`, and the SyncEngine's constructor
// effects fire async work on a live workspace (auto forcePull + startWatching,
// plus a 1s-debounced scheduleSync). Those timers/watchers can outlive a test
// and write into the shared `vault-db`, corrupting a later test (e.g. the
// orphan-detection test intermittently losing its imported file). Merely
// clearing rows can't beat a timer that fires mid-test.
//
// Swapping in a brand-new IDBFactory before each test means a prior engine's
// stray writes go to the now-discarded factory, while the new test starts from
// an empty DB with the correct schema rebuilt by VaultDatabase.open().
beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
});