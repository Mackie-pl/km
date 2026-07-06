import { describe, it, expect, beforeEach } from 'vitest';
import type { Adapter } from '../../../adapter.interface';

describe('GDriveAdapterProxy', () => {
	let proxy: Adapter;

	beforeEach(async () => {
		const { GDriveAdapterProxy } = await import('../adapter-proxy');
		proxy = new GDriveAdapterProxy();
	});

	it('has id=gdrive and isLocal=false', () => {
		expect(proxy.id).toBe('gdrive');
		expect(proxy.isLocal).toBe(false);
	});

	it('is available in browser + desktop Tauri, but not Tauri-on-Android', () => {
		const w = window as { __TAURI_INTERNALS__?: unknown };
		const had = '__TAURI_INTERNALS__' in w;
		const prev = w.__TAURI_INTERNALS__;
		const realUa = navigator.userAgent;
		const setUa = (ua: string): void => {
			Object.defineProperty(navigator, 'userAgent', {
				value: ua,
				configurable: true,
			});
		};
		try {
			delete w.__TAURI_INTERNALS__;
			expect(proxy.isAvailable()).toBe(true); // browser

			w.__TAURI_INTERNALS__ = {};
			expect(proxy.isAvailable()).toBe(true); // desktop Tauri (non-Android UA)

			setUa('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36');
			expect(proxy.isAvailable()).toBe(false); // Tauri-on-Android
		} finally {
			if (had) w.__TAURI_INTERNALS__ = prev;
			else delete w.__TAURI_INTERNALS__;
			setUa(realUa);
		}
	});

	it('returns null from pickWorkspaceFolder (configured via form)', async () => {
		expect(await proxy.pickWorkspaceFolder()).toBeNull();
	});

	it('lazy-loads the real adapter only on first I/O', async () => {
		const { GDriveAdapterProxy } = await import('../adapter-proxy');
		const fresh = new GDriveAdapterProxy() as { real: Adapter | null };
		expect(fresh.real).toBeNull();

		fresh.isAvailable(); // does not load
		expect(fresh.real).toBeNull();

		// First real call loads the adapter. registerScope is a no-op that
		// resolves without touching the network/GIS (read() would block on the
		// GIS script load in jsdom).
		await (fresh as unknown as Adapter).registerScope!('root');
		expect(fresh.real).not.toBeNull();
	});
});
