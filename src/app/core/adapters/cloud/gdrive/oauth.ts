/**
 * Google sign-in via Google Identity Services (GIS) token model.
 *
 * Why not Authorization Code + PKCE? Google's "Web application" OAuth clients
 * require a `client_secret` for the token exchange even WITH PKCE — so a
 * secret-less code flow is impossible in a pure browser app, and this app has no
 * backend to hold a secret. GIS's token model (`initTokenClient`) is Google's
 * supported secret-less browser flow: it runs its own popup (no redirect route,
 * and immune to the COOP `window.closed` issue) and returns an access token
 * directly.
 *
 * Tradeoff: the token model issues NO refresh token. Access tokens are
 * short-lived (~1h) and renewed by calling `requestAccessToken` again — silent
 * when the user's Google session + grant are live, otherwise a quick popup. True
 * background refresh (for the deferred Tauri desktop phase) needs a Desktop
 * OAuth client + loopback, which can return a refresh token.
 */

import { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_SCOPES } from './config';
import type { GDriveTokenSet } from './token-store';
import type { OAuthDriver } from './oauth-driver';

// ── Minimal GIS typings (the library is loaded at runtime, not bundled) ──────

interface GisTokenResponse {
	access_token?: string;
	expires_in?: number;
	scope?: string;
	error?: string;
	error_description?: string;
}

interface GisTokenClient {
	requestAccessToken(overrideConfig?: { prompt?: string }): void;
}

interface GisErrorEvent {
	type: string;
	message?: string;
}

interface GisOAuth2 {
	initTokenClient(config: {
		client_id: string;
		scope: string;
		callback: (response: GisTokenResponse) => void;
		error_callback?: (error: GisErrorEvent) => void;
	}): GisTokenClient;
}

interface GoogleNamespace {
	accounts: { oauth2: GisOAuth2 };
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';

function gisGlobal(): GoogleNamespace | undefined {
	return (window as unknown as { google?: GoogleNamespace }).google;
}

let scriptLoader: Promise<void> | null = null;

/** Inject the GIS client script once (idempotent across calls). */
function loadGis(): Promise<void> {
	scriptLoader ??= new Promise<void>((resolve, reject) => {
		if (gisGlobal()?.accounts.oauth2) {
			resolve();
			return;
		}
		const script = document.createElement('script');
		script.src = GIS_SRC;
		script.async = true;
		script.onload = () => {
			resolve();
		};
		script.onerror = () => {
			scriptLoader = null; // allow a retry on the next attempt
			reject(new Error('Failed to load Google Identity Services'));
		};
		document.head.appendChild(script);
	});
	return scriptLoader;
}

/**
 * Acquire a Drive access token. Resolves once GIS returns a token; the popup is
 * shown only when consent/sign-in is actually needed (call from a user gesture
 * for the first sign-in). Rejects on error or denial.
 */
export async function requestAccessToken(): Promise<GDriveTokenSet> {
	await loadGis();
	const oauth2 = gisGlobal()?.accounts.oauth2;
	if (!oauth2) throw new Error('Google Identity Services unavailable');

	return new Promise<GDriveTokenSet>((resolve, reject) => {
		const client = oauth2.initTokenClient({
			client_id: GOOGLE_OAUTH_CLIENT_ID,
			scope: GOOGLE_OAUTH_SCOPES.join(' '),
			callback: (resp) => {
				if (resp.error || !resp.access_token) {
					reject(
						new Error(
							resp.error_description ??
								resp.error ??
								'No access token returned',
						),
					);
					return;
				}
				resolve({
					accessToken: resp.access_token,
					// Renew a minute early to avoid races with in-flight requests.
					expiresAt: Date.now() + ((resp.expires_in ?? 3600) - 60) * 1000,
				});
			},
			error_callback: (err) => {
				reject(new Error(err.message ?? err.type));
			},
		});
		client.requestAccessToken({ prompt: '' });
	});
}

/**
 * Browser OAuth driver (GIS token model). There is no refresh token, so `renew`
 * is a no-op (null) — the provider falls back to `signIn`, and GIS itself returns
 * a token silently when the user's session + grant are still live.
 */
export const browserDriver: OAuthDriver = {
	signIn: () => requestAccessToken(),
	renew: () => Promise.resolve(null),
};
