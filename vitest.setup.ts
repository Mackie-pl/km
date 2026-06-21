import 'fake-indexeddb/auto';
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

/**
 * Clear all entries from the vault-db IndexedDB store.
 * Called from each test file's beforeEach to prevent state leaking across files.
 */
async function clearVaultDb(): Promise<void> {
	const req = indexedDB.open('vault-db', 5);
	req.onupgradeneeded = () => {
		if (!req.result.objectStoreNames.contains('entries')) {
			req.result.createObjectStore('entries', { keyPath: 'id' });
		}
	};
	await new Promise<void>((resolve) => {
		req.onsuccess = () => {
			const db = req.result;
			try {
				const tx = db.transaction('entries', 'readwrite');
				tx.objectStore('entries').clear();
				tx.oncomplete = () => { db.close(); resolve(); };
				tx.onerror = () => { db.close(); resolve(); };
			} catch {
				db.close();
				resolve();
			}
		};
		req.onerror = () => resolve();
	});
}
globalThis.__clearVaultDb = clearVaultDb;