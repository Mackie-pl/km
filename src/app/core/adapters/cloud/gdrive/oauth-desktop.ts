/**
 * Desktop OAuth driver — Authorization Code + PKCE over a 127.0.0.1 loopback.
 *
 * Flow (Tauri only):
 * 1. Ask Rust to bind a localhost server → port (`oauth_loopback_start`).
 * 2. Build the PKCE auth URL with `redirect_uri=http://127.0.0.1:<port>` and open
 *    it in the SYSTEM browser (the webview can't host Google's consent page).
 * 3. Rust catches the redirect and returns the `code` (`oauth_loopback_wait`).
 * 4. Exchange code → tokens at the token endpoint via {@link driveFetch}
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
import { arrayBufferToBase64 } from '../crypto-store';
import { driveFetch } from './http';
import {
	GOOGLE_AUTH_ENDPOINT,
	GOOGLE_OAUTH_DESKTOP_CLIENT_ID,
	GOOGLE_OAUTH_DESKTOP_CLIENT_SECRET,
	GOOGLE_OAUTH_SCOPES,
	GOOGLE_TOKEN_ENDPOINT,
} from './config';
import type { GDriveTokenSet } from './token-store';
import type { OAuthDriver } from './oauth-driver';

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function base64Url(buffer: ArrayBuffer): string {
	return arrayBufferToBase64(buffer)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function randomVerifier(): string {
	return base64Url(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

async function deriveChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(verifier),
	);
	return base64Url(digest);
}

// ── Token endpoint ───────────────────────────────────────────────────────────

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	error?: string;
	error_description?: string;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
	const res = await driveFetch(GOOGLE_TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString(),
	});
	const json = (await res.json()) as TokenResponse;
	if (!res.ok || json.error) {
		throw new Error(
			`Token request failed: ${json.error_description ?? json.error ?? String(res.status)}`,
		);
	}
	return json;
}

function toTokenSet(
	res: TokenResponse,
	fallbackRefresh?: string,
): GDriveTokenSet {
	if (!res.access_token) throw new Error('Token response missing access_token');
	const set: GDriveTokenSet = {
		accessToken: res.access_token,
		// Renew a minute early to avoid races with in-flight requests.
		expiresAt: Date.now() + ((res.expires_in ?? 3600) - 60) * 1000,
	};
	const refresh = res.refresh_token ?? fallbackRefresh;
	if (refresh) set.refreshToken = refresh;
	return set;
}

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
	const res = await postToken(
		new URLSearchParams({
			client_id: GOOGLE_OAUTH_DESKTOP_CLIENT_ID,
			client_secret: GOOGLE_OAUTH_DESKTOP_CLIENT_SECRET,
			code,
			code_verifier: verifier,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri,
		}),
	);
	return toTokenSet(res);
}

async function renew(
	current: GDriveTokenSet,
): Promise<GDriveTokenSet | null> {
	if (!current.refreshToken) return null;
	const res = await postToken(
		new URLSearchParams({
			client_id: GOOGLE_OAUTH_DESKTOP_CLIENT_ID,
			client_secret: GOOGLE_OAUTH_DESKTOP_CLIENT_SECRET,
			refresh_token: current.refreshToken,
			grant_type: 'refresh_token',
		}),
	);
	// A refresh response usually omits a new refresh_token — keep the old one.
	return toTokenSet(res, current.refreshToken);
}

export const desktopDriver: OAuthDriver = { signIn, renew };
