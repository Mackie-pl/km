/**
 * Encrypted token store for git authentication tokens.
 *
 * Thin git-specific wrapper over the shared {@link EncryptedStore}
 * (AES-GCM + random master secret in IndexedDB). This module adds only the
 * git-specific concerns: the on-disk schema names (kept stable so existing
 * tokens keep decrypting) and the legacy fingerprint-derived key, retained as a
 * read-time migration fallback.
 *
 * History: an earlier version derived the key from userAgent + screen size +
 * timezone offset; those change with browser updates, monitors, travel, and DST,
 * which silently bricked decryption and stopped git sync with no error. The key
 * is now a random secret; the fingerprint scheme survives only so existing
 * tokens migrate transparently on first read.
 *
 * Threat model: protects tokens at rest from casual IndexedDB scraping. It does
 * NOT defend against script running in this origin (e.g. XSS) — such an attacker
 * can call `getToken()` directly.
 */

import { EncryptedStore, encryptWith } from '../crypto-store';

// Schema names are FROZEN — changing them orphans tokens already on disk.
const store = new EncryptedStore({
	dbName: 'git-token-store',
	dbVersion: 2,
	recordStore: 'tokens',
	recordKeyPath: 'repoUrl',
	cipherField: 'encryptedToken',
	keyStore: 'keys',
	masterKeyId: 'master',
});

// ── Legacy key (read-time migration fallback only) ──────────────────────────

/**
 * Derive the legacy AES-GCM key from the old device fingerprint. Retained ONLY
 * so tokens written by the previous scheme can still be read once and migrated.
 */
async function deriveLegacyKey(): Promise<CryptoKey> {
	const salt = 'km-test-git-token-store-v1';
	const fingerprint = getDeviceFingerprint();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(fingerprint + salt),
		{ name: 'PBKDF2' },
		false,
		['deriveKey'],
	);
	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt: new TextEncoder().encode(salt),
			iterations: 100_000,
			hash: 'SHA-256',
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

function getDeviceFingerprint(): string {
	const parts: string[] = [
		navigator.userAgent,
		navigator.language,
		String(screen.width),
		String(screen.height),
		String(new Date().getTimezoneOffset()),
	];
	if (typeof window !== 'undefined') {
		parts.push(window.location.origin);
	}
	return parts.join('||');
}

// ── Public API ──────────────────────────────────────────────────────────────

export class GitTokenStore {
	/**
	 * Retrieve the plaintext token for a repository URL.
	 *
	 * Returns null when no token has been stored (setup not complete). When a
	 * record EXISTS but cannot be decrypted, this THROWS rather than returning
	 * null — so callers that require auth (the push path) surface a real error
	 * instead of silently skipping the sync. A record encrypted by the legacy
	 * fingerprint scheme is decrypted once and transparently re-encrypted with
	 * the current key.
	 */
	getToken(repoUrl: string): Promise<string | null> {
		return store.getValue(repoUrl, {
			getLegacyKeys: async () => [await deriveLegacyKey()],
			errorMessage:
				`Stored git token for "${repoUrl}" could not be decrypted ` +
				'(it may have been created on a different device or app version). ' +
				'Re-enter the token in the workspace settings.',
		});
	}

	/** Encrypt and store a token for the given repository URL. */
	setToken(repoUrl: string, token: string): Promise<void> {
		return store.setValue(repoUrl, token);
	}

	/** Delete a stored token. No-op if the key does not exist. */
	deleteToken(repoUrl: string): Promise<void> {
		return store.deleteRecord(repoUrl);
	}
}

/** @internal Test-only seam for exercising the legacy-migration path. */
export const __testing = {
	/** Write a record encrypted with the legacy fingerprint key. */
	async writeLegacyRecord(repoUrl: string, token: string): Promise<string> {
		const encryptedToken = await encryptWith(token, await deriveLegacyKey());
		await store.writeCipher(repoUrl, encryptedToken);
		return encryptedToken;
	},
	/** Write a raw (already-encrypted or garbage) ciphertext string. */
	async writeRawRecord(repoUrl: string, encryptedToken: string): Promise<void> {
		await store.writeCipher(repoUrl, encryptedToken);
	},
	/** Read the raw stored ciphertext for a repo, or null. */
	async readRawCiphertext(repoUrl: string): Promise<string | null> {
		return store.readCipher(repoUrl);
	},
	/** Write a raw (possibly malformed) master-secret value to the keys store. */
	async writeRawSecret(secret: string): Promise<void> {
		await store.writeSecret(secret);
	},
	/** Reset the per-session key cache (so a deleted secret is re-read). */
	resetKeyCache(): void {
		store.resetKeyCache();
	},
};
