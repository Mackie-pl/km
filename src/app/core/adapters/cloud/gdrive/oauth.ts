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
 * short-lived (~1h) and renewed by calling `requestAccessToken` again. We renew
 * with `prompt: 'none'` (see {@link renewAccessToken}), which returns a token
 * silently — no popup, no user gesture — as long as the user's Google session +
 * grant are live, and fails cleanly otherwise so the caller can fall back to an
 * interactive sign-in. This is what avoids a manual reconnect every ~hour: the
 * token auto-renews for as long as the Google session lasts (days/weeks), and a
 * gesture is only needed once that session itself expires or the grant is
 * revoked. True background refresh with the tab CLOSED still isn't possible in a
 * pure browser app (no refresh token); that needs the Desktop/Android Auth-Code
 * flow, which the Tauri drivers use.
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
 * Acquire a Drive access token from GIS with the given `prompt`.
 * `''` shows UI when consent/sign-in is needed (interactive); `'none'` never
 * shows UI and fails if interaction would be required (silent renew).
 * Rejects on error, denial, or when a silent request can't complete.
 */
function acquireToken(prompt: '' | 'none'): Promise<GDriveTokenSet> {
	return loadGis().then(
		() =>
			new Promise<GDriveTokenSet>((resolve, reject) => {
				const oauth2 = gisGlobal()?.accounts.oauth2;
				if (!oauth2) {
					reject(new Error('Google Identity Services unavailable'));
					return;
				}
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
							expiresAt:
								Date.now() +
								((resp.expires_in ?? 3600) - 60) * 1000,
						});
					},
					error_callback: (err) => {
						reject(new Error(err.message ?? err.type));
					},
				});
				client.requestAccessToken({ prompt });
			}),
	);
}

/**
 * Interactive acquire — shows the Google popup when consent/sign-in is needed.
 * Call from a user gesture (first sign-in, or the header's Reconnect button).
 * Rejects on error or denial.
 */
export function requestAccessToken(): Promise<GDriveTokenSet> {
	return acquireToken('');
}

/**
 * Silent renew via `prompt: 'none'`: GIS returns a token WITHOUT any UI while the
 * user's Google session + prior grant are live, so a background sync/watch can
 * refresh the ~1h access token with no user gesture. Resolves null on any failure
 * (interaction required, session gone, popup would be needed) — the provider then
 * flags a reconnect instead, exactly as before. Safe to call in the background.
 */
export function renewAccessToken(): Promise<GDriveTokenSet | null> {
	return acquireToken('none').catch(() => null);
}

/**
 * Browser OAuth driver (GIS token model). No refresh token exists, so `renew`
 * asks GIS for a silent (`prompt: 'none'`) token — successful while the Google
 * session is alive — and returns null otherwise so the provider falls back to an
 * interactive `signIn`. `current` is unused: GIS renews off the browser's Google
 * session, not a stored refresh token.
 */
export const browserDriver: OAuthDriver = {
	signIn: () => requestAccessToken(),
	renew: () => renewAccessToken(),
};
