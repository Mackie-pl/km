/**
 * OAuth driver seam — the per-runtime sign-in/renew strategy.
 *
 * - Browser → Google Identity Services token model ({@link ./oauth}).
 * - Tauri desktop → Auth Code + PKCE over a 127.0.0.1 loopback ({@link ./oauth-desktop}).
 * - Android (next phase) → a custom-scheme deep-link driver, slotted in here.
 *
 * Each path is loaded via dynamic import so its runtime-specific dependencies
 * (GIS script vs Tauri `invoke`/opener) never land in the other bundle.
 */

import { isTauriRuntime } from '@core/utils/tauri-runtime';
import type { GDriveTokenSet } from './token-store';

export interface OAuthDriver {
	/** Interactive sign-in (may open a popup / system browser). */
	signIn(): Promise<GDriveTokenSet>;
	/**
	 * Silently renew from a prior token set, or return null when that isn't
	 * possible without user interaction (the caller then falls back to signIn).
	 */
	renew(current: GDriveTokenSet): Promise<GDriveTokenSet | null>;
}

export async function getOAuthDriver(): Promise<OAuthDriver> {
	if (isTauriRuntime()) {
		const { desktopDriver } = await import('./oauth-desktop');
		return desktopDriver;
	}
	const { browserDriver } = await import('./oauth');
	return browserDriver;
}
