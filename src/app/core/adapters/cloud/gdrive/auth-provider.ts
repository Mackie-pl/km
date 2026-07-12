/**
 * Shared Google Drive auth provider.
 *
 * Owns the OAuth token lifecycle (sign-in/renew via the per-runtime
 * {@link OAuthDriver} + the encrypted token store) and implements
 * {@link DriveAuth} so any {@link DriveClient} can use it. Exposed as a module
 * singleton ({@link gdriveAuth}) so the adapter (a plain class created in the
 * ADAPTERS factory) and the folder-picker UI (an Angular service) share ONE token
 * and ONE in-flight sign-in — otherwise a multi-file sync or a picker open could
 * each spawn their own Google consent flow.
 */

import { signal } from '@angular/core';
import { GDriveTokenStore } from './token-store';
import { getOAuthDriver, type OAuthDriver } from './oauth-driver';
import type { DriveAuth } from './drive-client';

/**
 * Thrown when a token is needed during BACKGROUND work (sync/watch) but can only
 * be obtained by an interactive sign-in — which we refuse to trigger without a
 * user gesture. The UI shows a "Reconnect" action (see {@link GDriveAuthProvider.needsReauth}).
 */
export class ReauthRequiredError extends Error {
	readonly code = 'GDriveReauthRequired';
	constructor() {
		super('Google Drive sign-in required — click Reconnect.');
		this.name = 'ReauthRequiredError';
	}
}

export class GDriveAuthProvider implements DriveAuth {
	private readonly tokenStore = new GDriveTokenStore();

	/** Shared in-flight silent acquisition, so concurrent callers share one renew. */
	#refreshing: Promise<string> | null = null;
	#driverPromise: Promise<OAuthDriver> | null = null;

	/**
	 * True when background renewal failed for lack of an interactive sign-in
	 * (browser, expired token, no refresh token). Drives the header's "Reconnect
	 * Google Drive" affordance. Never set on desktop, where `renew` is silent.
	 */
	readonly #reauth = signal(false);
	readonly needsReauth = this.#reauth.asReadonly();

	// Background callers (DriveClient during sync/watch) — silent only.
	getToken(): Promise<string> {
		return this.#accessToken(false, false);
	}

	forceRefresh(): Promise<string> {
		return this.#accessToken(true, false);
	}

	/** Interactive sign-in (call from a user gesture). Clears the reconnect flag. */
	async ensureSignedIn(): Promise<void> {
		const set = await this.tokenStore.get();
		if (set && set.expiresAt > Date.now()) {
			this.#reauth.set(false);
			return;
		}
		await this.#accessToken(true, true);
	}

	/** Deliberate user-initiated reconnect (e.g. the header button). */
	reconnect(): Promise<void> {
		return this.ensureSignedIn();
	}

	/**
	 * Forget the stored token and clear the reconnect flag. Called when no
	 * workspace uses Drive any more, so the app stops holding an orphaned token
	 * and stops prompting to reconnect. Idempotent — safe when never signed in.
	 */
	async signOut(): Promise<void> {
		this.#reauth.set(false);
		this.#refreshing = null;
		await this.tokenStore.clear();
	}

	/**
	 * Return a valid access token. Uses the cached one when fresh (unless
	 * `force`); otherwise acquires. `interactive` gates whether a sign-in UI may
	 * be shown — background callers pass false and get a {@link ReauthRequiredError}
	 * instead of a surprise popup. Silent calls share one in-flight request.
	 */
	async #accessToken(force: boolean, interactive: boolean): Promise<string> {
		if (!force) {
			const set = await this.tokenStore.get();
			if (set && set.expiresAt > Date.now()) return set.accessToken;
		}
		if (interactive) {
			// User-initiated — never blocked by a pending silent (rejecting) renew.
			return this.#acquire(true);
		}
		this.#refreshing ??= this.#acquire(false).finally(() => {
			this.#refreshing = null;
		});
		return this.#refreshing;
	}

	#driver(): Promise<OAuthDriver> {
		return (this.#driverPromise ??= getOAuthDriver());
	}

	/**
	 * Acquire + persist a fresh access token: renew from a stored refresh token
	 * when possible (silent, desktop). If that's impossible, sign in interactively
	 * — but only when `interactive`; otherwise flag reauth and throw.
	 */
	async #acquire(interactive: boolean): Promise<string> {
		const driver = await this.#driver();
		const current = await this.tokenStore.get();
		let next = current ? await driver.renew(current) : null;
		if (!next) {
			if (!interactive) {
				this.#reauth.set(true);
				throw new ReauthRequiredError();
			}
			next = await driver.signIn();
		}
		await this.tokenStore.set(next);
		this.#reauth.set(false);
		return next.accessToken;
	}
}

/** Process-wide singleton shared by the adapter and the folder picker. */
export const gdriveAuth = new GDriveAuthProvider();
