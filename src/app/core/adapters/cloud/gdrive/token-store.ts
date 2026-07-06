/**
 * Encrypted store for the Google Drive OAuth token set.
 *
 * Thin wrapper over the shared {@link EncryptedStore}: the whole token set is
 * JSON-serialized and AES-GCM encrypted at rest in IndexedDB. Phase 1 assumes a
 * single Google account, keyed `'primary'`; the key parameter is kept so
 * multi-account support can slot in later.
 *
 * Unlike the git PAT store, an undecryptable record degrades to `null` (forcing
 * a re-sign-in) rather than throwing — losing the refresh token is recoverable
 * by signing in again, and a thrown error here would wedge every Drive call.
 */

import { EncryptedStore } from '../crypto-store';

export interface GDriveTokenSet {
	accessToken: string;
	/** Absolute epoch-ms expiry of the access token. */
	expiresAt: number;
	/**
	 * Long-lived refresh token. Present only on the desktop (Auth Code) flow —
	 * the browser GIS token model issues none.
	 */
	refreshToken?: string;
}

const DEFAULT_ACCOUNT = 'primary';

const store = new EncryptedStore({
	dbName: 'gdrive-token-store',
	dbVersion: 1,
	recordStore: 'tokens',
	recordKeyPath: 'account',
	cipherField: 'encrypted',
	keyStore: 'keys',
	masterKeyId: 'master',
});

export class GDriveTokenStore {
	/** Read the stored token set, or null if absent/undecryptable. */
	async get(account: string = DEFAULT_ACCOUNT): Promise<GDriveTokenSet | null> {
		const raw = await store.getValue(account).catch(() => null);
		if (raw === null) return null;
		try {
			return JSON.parse(raw) as GDriveTokenSet;
		} catch {
			return null;
		}
	}

	/** Encrypt and persist the token set. */
	set(set: GDriveTokenSet, account: string = DEFAULT_ACCOUNT): Promise<void> {
		return store.setValue(account, JSON.stringify(set));
	}

	/** Delete the stored token set. No-op if absent. */
	clear(account: string = DEFAULT_ACCOUNT): Promise<void> {
		return store.deleteRecord(account);
	}
}
