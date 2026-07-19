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
import { openUrl } from '@tauri-apps/plugin-opener';
import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
import { GOOGLE_OAUTH_ANDROID_SCHEME } from '../config';
import { androidDriver } from '../oauth-android';

const fetchMock = driveFetch as Mock;
const openUrlMock = openUrl as Mock;
const onOpenUrlMock = onOpenUrl as Mock;
const getCurrentMock = getCurrent as Mock;

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

describe('androidDriver.signIn redirect capture', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		openUrlMock.mockReset().mockResolvedValue(undefined);
		onOpenUrlMock.mockReset().mockResolvedValue(() => undefined);
		getCurrentMock.mockReset().mockResolvedValue(null);
	});

	/** The `state` the driver put on the outgoing auth URL. */
	function sentState(): string {
		const url = openUrlMock.mock.calls[0]?.[0] as string;
		return new URL(url).searchParams.get('state') ?? '';
	}

	it('completes when the redirect only ever appears via getCurrent()', async () => {
		// The real failure: the intent is delivered to the existing activity and
		// onOpenUrl never fires, but getCurrent() holds the URL. Sign-in must
		// still finish once the app returns to the foreground.
		onOpenUrlMock.mockResolvedValue(() => undefined);
		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				access_token: 'tok',
				refresh_token: 'r1',
				expires_in: 3600,
			}),
		);

		const pending = androidDriver.signIn();
		await vi.waitFor(() => {
			expect(openUrlMock).toHaveBeenCalled();
		});

		// Redirect lands; only getCurrent() knows about it.
		getCurrentMock.mockResolvedValue([
			`${GOOGLE_OAUTH_ANDROID_SCHEME}:/oauth2redirect?code=abc&state=${sentState()}`,
		]);
		window.dispatchEvent(new Event('focus'));

		const set = await pending;
		expect(set.accessToken).toBe('tok');
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
	});

	it('ignores a leftover redirect from a previous attempt', async () => {
		// getCurrent() returns the last intent the app saw, which may be a stale
		// redirect. Consuming it would exchange a code whose PKCE verifier no
		// longer matches, so a mismatched state must not settle the flow.
		onOpenUrlMock.mockResolvedValue(() => undefined);
		getCurrentMock.mockResolvedValue([
			`${GOOGLE_OAUTH_ANDROID_SCHEME}:/oauth2redirect?code=stale&state=from-an-older-attempt`,
		]);

		const pending = androidDriver.signIn();
		await vi.waitFor(() => {
			expect(openUrlMock).toHaveBeenCalled();
		});
		window.dispatchEvent(new Event('focus'));

		// Give the poll a chance to (wrongly) settle.
		await new Promise((r) => setTimeout(r, 20));
		expect(fetchMock).not.toHaveBeenCalled();

		// The real redirect for THIS attempt still completes it.
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ access_token: 'tok2', expires_in: 3600 }),
		);
		getCurrentMock.mockResolvedValue([
			`${GOOGLE_OAUTH_ANDROID_SCHEME}:/oauth2redirect?code=fresh&state=${sentState()}`,
		]);
		window.dispatchEvent(new Event('focus'));

		expect((await pending).accessToken).toBe('tok2');
		expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('code=fresh');
	});
});
