import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// The android driver only touches deep-link/opener inside signIn; the renew path
// tested here hits only the token endpoint via driveFetch.
vi.mock('../http', () => ({ driveFetch: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({
	onOpenUrl: vi.fn(),
	getCurrent: vi.fn(),
}));

import { driveFetch } from '../http';
import { androidDriver } from '../oauth-android';

const fetchMock = driveFetch as Mock;

function jsonResponse(obj: unknown, status = 200): Response {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('androidDriver.renew', () => {
	beforeEach(() => {
		fetchMock.mockReset();
	});

	it('returns null without a refresh token', async () => {
		expect(
			await androidDriver.renew({ accessToken: 'x', expiresAt: 0 }),
		).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('posts a refresh_token grant with no secret and carries the token forward', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ access_token: 'fresh', expires_in: 3600 }),
		);
		const set = await androidDriver.renew({
			accessToken: 'old',
			expiresAt: 0,
			refreshToken: 'r1',
		});
		expect(set?.accessToken).toBe('fresh');
		expect(set?.refreshToken).toBe('r1'); // response omitted one → kept old

		const [url, init] = fetchMock.mock.calls[0] as [
			string,
			{ method?: string; body?: string },
		];
		expect(url).toContain('oauth2.googleapis.com/token');
		expect(init.method).toBe('POST');
		expect(init.body).toContain('grant_type=refresh_token');
		expect(init.body).toContain('refresh_token=r1');
		// Public client: no client_secret in the exchange.
		expect(init.body).not.toContain('client_secret');
	});

	it('throws on an error response', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ error: 'invalid_grant' }, 400),
		);
		await expect(
			androidDriver.renew({
				accessToken: 'old',
				expiresAt: 0,
				refreshToken: 'bad',
			}),
		).rejects.toThrow('invalid_grant');
	});
});
