import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GDriveTokenSet } from '../token-store';

// Mock the OAuth driver seam so no real sign-in (GIS/loopback) is involved.
const { signIn, renew } = vi.hoisted(() => ({
	signIn: vi.fn(),
	renew: vi.fn(),
}));
vi.mock('../oauth-driver', () => ({
	getOAuthDriver: () => Promise.resolve({ signIn, renew }),
}));

import { GDriveAuthProvider, ReauthRequiredError } from '../auth-provider';

const future = (): number => Date.now() + 3_600_000;
const past = (): number => Date.now() - 1_000;

describe('GDriveAuthProvider', () => {
	beforeEach(() => {
		signIn.mockReset();
		renew.mockReset();
		renew.mockResolvedValue(null);
	});

	it('serves a cached token to background callers without re-acquiring', async () => {
		signIn.mockResolvedValue({ accessToken: 'tok', expiresAt: future() });
		const auth = new GDriveAuthProvider();

		await auth.ensureSignedIn(); // interactive → signIn → stores tok
		expect(await auth.getToken()).toBe('tok'); // cached, no acquire
		expect(signIn).toHaveBeenCalledTimes(1);
		expect(auth.needsReauth()).toBe(false);
	});

	it('renews silently via a refresh token (no interactive sign-in)', async () => {
		signIn.mockResolvedValue({
			accessToken: 'old',
			expiresAt: past(),
			refreshToken: 'r1',
		});
		const auth = new GDriveAuthProvider();
		await auth.ensureSignedIn(); // stores an already-expired token + r1

		renew.mockResolvedValue({
			accessToken: 'renewed',
			expiresAt: future(),
			refreshToken: 'r1',
		});
		expect(await auth.getToken()).toBe('renewed');
		expect(renew).toHaveBeenCalledTimes(1);
		expect(signIn).toHaveBeenCalledTimes(1); // NOT signed in again
		expect(auth.needsReauth()).toBe(false);
	});

	it('flags reauth and throws when a background caller cannot renew silently', async () => {
		const auth = new GDriveAuthProvider();

		await expect(auth.getToken()).rejects.toBeInstanceOf(
			ReauthRequiredError,
		);
		expect(signIn).not.toHaveBeenCalled(); // no surprise popup
		expect(auth.needsReauth()).toBe(true);
	});

	it('reconnect() signs in interactively and clears the reauth flag', async () => {
		const auth = new GDriveAuthProvider();
		await expect(auth.getToken()).rejects.toThrow(); // sets needsReauth
		expect(auth.needsReauth()).toBe(true);

		signIn.mockResolvedValue({ accessToken: 'fresh', expiresAt: future() });
		await auth.reconnect();
		expect(signIn).toHaveBeenCalledTimes(1);
		expect(auth.needsReauth()).toBe(false);
	});

	it('signOut() forgets the token and clears the reauth flag', async () => {
		signIn.mockResolvedValue({ accessToken: 'tok', expiresAt: future() });
		const auth = new GDriveAuthProvider();
		await auth.ensureSignedIn();
		expect(await auth.getToken()).toBe('tok');

		await auth.signOut();
		expect(auth.needsReauth()).toBe(false);

		// Token forgotten → a background caller now cannot get one silently.
		renew.mockResolvedValue(null);
		await expect(auth.getToken()).rejects.toBeInstanceOf(
			ReauthRequiredError,
		);
	});

	it('de-dupes concurrent silent renewals into one call', async () => {
		signIn.mockResolvedValue({
			accessToken: 'old',
			expiresAt: past(),
			refreshToken: 'r1',
		});
		const auth = new GDriveAuthProvider();
		await auth.ensureSignedIn();

		let resolve!: (v: GDriveTokenSet) => void;
		renew.mockReturnValue(
			new Promise<GDriveTokenSet>((r) => {
				resolve = r;
			}),
		);
		const a = auth.getToken();
		const b = auth.getToken();
		resolve({ accessToken: 'renewed', expiresAt: future(), refreshToken: 'r1' });

		expect(await a).toBe('renewed');
		expect(await b).toBe('renewed');
		expect(renew).toHaveBeenCalledTimes(1);
	});
});
