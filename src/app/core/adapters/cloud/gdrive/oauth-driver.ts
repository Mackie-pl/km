/**
 * OAuth driver seam — the per-runtime sign-in/renew strategy.
 *
 * - Browser → Google Identity Services token model ({@link ./oauth}).
 * - Tauri desktop → Auth Code + PKCE over a 127.0.0.1 loopback ({@link ./oauth-desktop}).
 * - Tauri Android → Auth Code + PKCE with a custom-scheme deep link ({@link ./oauth-android}).
 *
 * Each path is loaded via dynamic import so its runtime-specific dependencies
 * (GIS script vs Tauri `invoke`/opener/deep-link) never land in the other bundle.
 */

import { isAndroidRuntime, isTauriRuntime } from '@core/utils/tauri-runtime';
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
		if (isAndroidRuntime()) {
			const { androidDriver } = await import('./oauth-android');
			return androidDriver;
		}
		const { desktopDriver } = await import('./oauth-desktop');
		return desktopDriver;
	}
	const { browserDriver } = await import('./oauth');
	return browserDriver;
}
