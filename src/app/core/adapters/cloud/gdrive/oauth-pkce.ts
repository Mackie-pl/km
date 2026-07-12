/**
 * Shared PKCE + token-exchange helpers for the Auth-Code flows.
 *
 * Both the desktop (127.0.0.1 loopback) and android (custom-scheme deep-link)
 * drivers run Authorization Code + PKCE and exchange the code at the same token
 * endpoint over {@link driveFetch}. Their crypto + token-parsing code is
 * identical, so it lives here — one implementation, no jscpd duplication.
 */

import { arrayBufferToBase64 } from '../crypto-store';
import { driveFetch } from './http';
import { GOOGLE_TOKEN_ENDPOINT } from './config';
import type { GDriveTokenSet } from './token-store';

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function base64Url(buffer: ArrayBuffer): string {
	return arrayBufferToBase64(buffer)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

/** A fresh, high-entropy PKCE `code_verifier`. */
export function randomVerifier(): string {
	return base64Url(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

/** The S256 `code_challenge` for a given verifier. */
export async function deriveChallenge(verifier: string): Promise<string> {
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

/**
 * POST a form-encoded body to the Google token endpoint and parse the result
 * into a {@link GDriveTokenSet}. `fallbackRefresh` is carried forward when a
 * refresh-token grant response omits a new refresh token (as Google usually
 * does).
 */
export async function postTokenForm(
	body: URLSearchParams,
	fallbackRefresh?: string,
): Promise<GDriveTokenSet> {
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
	return toTokenSet(json, fallbackRefresh);
}

/**
 * Build a driver `renew` from its static credentials (the only thing that
 * differs between desktop and android: desktop adds a `client_secret`, android
 * doesn't). Returns null when there's no refresh token — the caller then falls
 * back to interactive `signIn`. A refresh response usually omits a new refresh
 * token, so the current one is carried forward.
 */
export function renewWith(
	credentials: Record<string, string>,
): (current: GDriveTokenSet) => Promise<GDriveTokenSet | null> {
	return async (current) => {
		if (!current.refreshToken) return null;
		return postTokenForm(
			new URLSearchParams({
				...credentials,
				refresh_token: current.refreshToken,
				grant_type: 'refresh_token',
			}),
			current.refreshToken,
		);
	};
}
