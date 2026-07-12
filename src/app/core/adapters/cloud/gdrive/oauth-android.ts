/**
 * Android OAuth driver — Authorization Code + PKCE with a custom-scheme deep link.
 *
 * The Android webview can't host Google Identity Services, and a loopback server
 * is subpar on mobile (no auto-return, cleartext-to-localhost concerns). Google's
 * sanctioned mobile flow is an "Android" OAuth client (public, no secret) with a
 * reversed-domain custom-scheme redirect:
 *
 * 1. Build the PKCE auth URL with `redirect_uri=<scheme>:/oauth2redirect` and open
 *    it in the SYSTEM browser (Chrome) via the opener plugin.
 * 2. Google redirects to the custom scheme; the OS routes it back to this app as a
 *    deep link (an `<intent-filter>` on MainActivity), captured via
 *    `@tauri-apps/plugin-deep-link`.
 * 3. Exchange the `code` → tokens at the token endpoint via {@link postTokenForm}.
 *
 * `access_type=offline` yields a refresh token, so `renew` mints fresh access
 * tokens silently — background sync stays quiet, no re-consent.
 *
 * PKCE (public client, no secret) provides the security.
 */

import { openUrl } from '@tauri-apps/plugin-opener';
import {
	deriveChallenge,
	postTokenForm,
	randomVerifier,
	renewWith,
} from './oauth-pkce';
import {
	GOOGLE_AUTH_ENDPOINT,
	GOOGLE_OAUTH_ANDROID_CLIENT_ID,
	GOOGLE_OAUTH_ANDROID_SCHEME,
	GOOGLE_OAUTH_SCOPES,
	androidRedirectUri,
} from './config';
import type { GDriveTokenSet } from './token-store';
import type { OAuthDriver } from './oauth-driver';

/**
 * Resolve the redirect URL delivered to our custom scheme. Registers a one-shot
 * deep-link listener and also checks `getCurrent()` in case the redirect cold-
 * started the app (arriving before the listener was attached).
 */
async function waitForRedirect(): Promise<string> {
	const { onOpenUrl, getCurrent } = await import('@tauri-apps/plugin-deep-link');
	return new Promise<string>((resolve, reject) => {
		let unlisten: (() => void) | undefined;
		const settle = (url: string): void => {
			unlisten?.();
			resolve(url);
		};
		const match = (urls: string[] | null): string | undefined =>
			urls?.find((u) => u.startsWith(GOOGLE_OAUTH_ANDROID_SCHEME));

		onOpenUrl((urls) => {
			const hit = match(urls);
			if (hit) settle(hit);
		})
			.then((fn) => {
				unlisten = fn;
				return getCurrent();
			})
			.then((urls) => {
				const hit = match(urls);
				if (hit) settle(hit);
			})
			.catch(reject);
	});
}

/** Pull the `code` out of the redirect URL, surfacing an `error` if present. */
function parseRedirect(url: string): string {
	const params = new URLSearchParams(url.split('?')[1] ?? '');
	const error = params.get('error');
	if (error) throw new Error(`Google sign-in failed: ${error}`);
	const code = params.get('code');
	if (!code) throw new Error('No authorization code in redirect');
	return code;
}

async function signIn(): Promise<GDriveTokenSet> {
	const redirectUri = androidRedirectUri();
	const verifier = randomVerifier();

	const authParams = new URLSearchParams({
		client_id: GOOGLE_OAUTH_ANDROID_CLIENT_ID,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: GOOGLE_OAUTH_SCOPES.join(' '),
		code_challenge: await deriveChallenge(verifier),
		code_challenge_method: 'S256',
		access_type: 'offline',
		prompt: 'consent',
	});

	// Arm the deep-link listener BEFORE opening the browser so a fast redirect
	// can't race past us.
	const redirect = waitForRedirect();
	await openUrl(`${GOOGLE_AUTH_ENDPOINT}?${authParams.toString()}`);
	const code = parseRedirect(await redirect);

	// Public client: client_id + PKCE verifier, NO secret.
	return postTokenForm(
		new URLSearchParams({
			client_id: GOOGLE_OAUTH_ANDROID_CLIENT_ID,
			code,
			code_verifier: verifier,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri,
		}),
	);
}

// Public client: client_id only, NO secret.
const renew = renewWith({ client_id: GOOGLE_OAUTH_ANDROID_CLIENT_ID });

export const androidDriver: OAuthDriver = { signIn, renew };
