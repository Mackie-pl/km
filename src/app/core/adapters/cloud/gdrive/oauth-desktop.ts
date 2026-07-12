/**
 * Desktop OAuth driver — Authorization Code + PKCE over a 127.0.0.1 loopback.
 *
 * Flow (Tauri only):
 * 1. Ask Rust to bind a localhost server → port (`oauth_loopback_start`).
 * 2. Build the PKCE auth URL with `redirect_uri=http://127.0.0.1:<port>` and open
 *    it in the SYSTEM browser (the webview can't host Google's consent page).
 * 3. Rust catches the redirect and returns the `code` (`oauth_loopback_wait`).
 * 4. Exchange code → tokens at the token endpoint via {@link postTokenForm}
 *    (Rust-backed; the webview origin would otherwise be rejected).
 *
 * Unlike the browser, this yields a refresh token, so `renew` can mint fresh
 * access tokens silently (no browser) for true background sync.
 *
 * PKCE + the random-port loopback (only this app's server is listening) provide
 * the security, so no separate `state` round-trip is needed.
 */

import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
	deriveChallenge,
	postTokenForm,
	randomVerifier,
	renewWith,
} from './oauth-pkce';
import {
	GOOGLE_AUTH_ENDPOINT,
	GOOGLE_OAUTH_DESKTOP_CLIENT_ID,
	GOOGLE_OAUTH_DESKTOP_CLIENT_SECRET,
	GOOGLE_OAUTH_SCOPES,
} from './config';
import type { GDriveTokenSet } from './token-store';
import type { OAuthDriver } from './oauth-driver';

// ── Driver ───────────────────────────────────────────────────────────────────

async function signIn(): Promise<GDriveTokenSet> {
	const port = await invoke<number>('oauth_loopback_start');
	const redirectUri = `http://127.0.0.1:${String(port)}`;
	const verifier = randomVerifier();

	const authParams = new URLSearchParams({
		client_id: GOOGLE_OAUTH_DESKTOP_CLIENT_ID,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: GOOGLE_OAUTH_SCOPES.join(' '),
		code_challenge: await deriveChallenge(verifier),
		code_challenge_method: 'S256',
		access_type: 'offline',
		prompt: 'consent',
	});
	await openUrl(`${GOOGLE_AUTH_ENDPOINT}?${authParams.toString()}`);

	const code = await invoke<string>('oauth_loopback_wait');
	return postTokenForm(
		new URLSearchParams({
			client_id: GOOGLE_OAUTH_DESKTOP_CLIENT_ID,
			client_secret: GOOGLE_OAUTH_DESKTOP_CLIENT_SECRET,
			code,
			code_verifier: verifier,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri,
		}),
	);
}

const renew = renewWith({
	client_id: GOOGLE_OAUTH_DESKTOP_CLIENT_ID,
	client_secret: GOOGLE_OAUTH_DESKTOP_CLIENT_SECRET,
});

export const desktopDriver: OAuthDriver = { signIn, renew };
