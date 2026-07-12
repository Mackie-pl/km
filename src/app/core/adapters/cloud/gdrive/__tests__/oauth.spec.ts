import { describe, it, expect, beforeEach } from 'vitest';
import {
	requestAccessToken,
	renewAccessToken,
	browserDriver,
} from '../oauth';

interface TokenClientConfig {
	client_id: string;
	scope: string;
	callback: (resp: {
		access_token?: string;
		expires_in?: number;
		error?: string;
		error_description?: string;
	}) => void;
	error_callback?: (err: { type: string; message?: string }) => void;
}

/**
 * Install a fake Google Identity Services global. `handler` runs when the app
 * calls `requestAccessToken({ prompt })`, receiving the client config + the
 * prompt override so a test can drive callback/error_callback and assert which
 * prompt (`''` interactive vs `'none'` silent) was requested.
 */
function mockGis(
	handler: (cfg: TokenClientConfig, override: { prompt?: string }) => void,
): void {
	(window as unknown as { google: unknown }).google = {
		accounts: {
			oauth2: {
				initTokenClient: (cfg: TokenClientConfig) => ({
					requestAccessToken: (override: { prompt?: string } = {}) => {
						handler(cfg, override);
					},
				}),
			},
		},
	};
}

describe('browser GDrive OAuth (GIS token model)', () => {
	beforeEach(() => {
		delete (window as unknown as { google?: unknown }).google;
	});

	it('renewAccessToken requests a silent token (prompt: none) and returns it', async () => {
		let seenPrompt: string | undefined;
		mockGis((cfg, override) => {
			seenPrompt = override.prompt;
			cfg.callback({ access_token: 'silent-tok', expires_in: 3600 });
		});

		const tok = await renewAccessToken();
		expect(seenPrompt).toBe('none');
		expect(tok?.accessToken).toBe('silent-tok');
		expect(tok?.expiresAt).toBeGreaterThan(Date.now());
	});

	it('renewAccessToken resolves null when GIS needs interaction', async () => {
		mockGis((cfg) => {
			cfg.error_callback?.({
				type: 'popup_failed_to_open',
				message: 'blocked',
			});
		});
		expect(await renewAccessToken()).toBeNull();
	});

	it('renewAccessToken resolves null when the token response is an error', async () => {
		mockGis((cfg) => {
			cfg.callback({ error: 'interaction_required' });
		});
		expect(await renewAccessToken()).toBeNull();
	});

	it('requestAccessToken (interactive) uses prompt:"" and rejects on denial', async () => {
		let seenPrompt: string | undefined;
		mockGis((cfg, override) => {
			seenPrompt = override.prompt;
			cfg.error_callback?.({ type: 'access_denied', message: 'denied' });
		});

		await expect(requestAccessToken()).rejects.toThrow('denied');
		expect(seenPrompt).toBe('');
	});

	it('browserDriver.renew is silent, signIn is interactive', async () => {
		mockGis((cfg, override) => {
			cfg.callback({
				access_token:
					override.prompt === 'none' ? 'renewed' : 'signed-in',
				expires_in: 3600,
			});
		});

		const renewed = await browserDriver.renew({
			accessToken: 'x',
			expiresAt: 0,
		});
		expect(renewed?.accessToken).toBe('renewed');

		const signedIn = await browserDriver.signIn();
		expect(signedIn.accessToken).toBe('signed-in');
	});
});
