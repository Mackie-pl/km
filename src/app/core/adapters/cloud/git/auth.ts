/**
 * Encrypted token store for git authentication tokens.
 *
 * Tokens are AES-GCM encrypted before being written to IndexedDB. The key is a
 * random 256-bit secret generated once on this device and stored alongside the
 * tokens — NOT derived from a device fingerprint. (An earlier version derived
 * the key from userAgent + screen size + timezone offset; those change with
 * browser updates, monitors, travel, and DST, which silently bricked decryption
 * and stopped git sync with no error. The fingerprint scheme is kept only as a
 * read-time fallback so existing tokens migrate transparently.)
 *
 * Note on threat model: this protects tokens at rest from casual IndexedDB
 * scraping. It does NOT defend against an attacker who can run script in this
 * origin (e.g. XSS) — such an attacker can call `getToken()` directly.
 */

const DB_NAME = 'git-token-store';
const DB_VERSION = 2;
const TOKEN_STORE = 'tokens';
const KEY_STORE = 'keys';
const MASTER_KEY_ID = 'master';

/**
 * Open the IndexedDB database, creating/upgrading the schema if needed.
 * v2 adds the `keys` store that holds the random master secret.
 */
function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(TOKEN_STORE)) {
				db.createObjectStore(TOKEN_STORE, { keyPath: 'repoUrl' });
			}
			if (!db.objectStoreNames.contains(KEY_STORE)) {
				db.createObjectStore(KEY_STORE, { keyPath: 'id' });
			}
		};
		req.onsuccess = () => {
			resolve(req.result);
		};
		req.onerror = () => {
			reject(new Error(req.error?.message ?? 'IndexedDB open failed'));
		};
	});
}

// ── Key management ──────────────────────────────────────────────────────────

/** Cached per-session so concurrent calls share one key-load (and no race). */
let cachedKey: Promise<CryptoKey> | null = null;

/** The current AES-GCM key, derived from the stored random master secret. */
function getCryptoKey(): Promise<CryptoKey> {
	// Clear the cache on failure so a one-time error (e.g. transient IDB issue)
	// doesn't permanently wedge a rejected promise for the whole session.
	cachedKey ??= loadOrCreateKey().catch((err: unknown) => {
		cachedKey = null;
		throw err;
	});
	return cachedKey;
}

async function loadOrCreateKey(): Promise<CryptoKey> {
	const secret = await getOrCreateSecret();
	return crypto.subtle.importKey('raw', secret, { name: 'AES-GCM' }, false, [
		'encrypt',
		'decrypt',
	]);
}

/**
 * Read the stored 256-bit master secret, generating + persisting it if absent.
 * Stored as a base64 string (not a raw ArrayBuffer) to avoid structured-clone
 * realm quirks where the round-tripped buffer fails `importKey`'s type check.
 *
 * Self-healing: a missing, malformed, or wrong-length stored secret (e.g. left
 * by an earlier build that stored a raw ArrayBuffer) is replaced with a fresh
 * one rather than throwing — a corrupt secret must not crash git init. Any
 * tokens encrypted under the lost secret then fail to decrypt and surface a
 * re-enter-token error, which is the correct degradation.
 */
async function getOrCreateSecret(): Promise<Uint8Array<ArrayBuffer>> {
	const existing = await readSecret();
	const decoded = existing !== null ? tryDecodeSecret(existing) : null;
	if (decoded) return decoded;

	const secret = crypto.getRandomValues(new Uint8Array(32));
	const db = await openDb();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(KEY_STORE, 'readwrite');
		tx.objectStore(KEY_STORE).put({
			id: MASTER_KEY_ID,
			secret: arrayBufferToBase64(secret.buffer),
		});
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			reject(new Error(tx.error?.message ?? 'IndexedDB put (key) failed'));
		};
	});
	return secret;
}

/**
 * Decode a stored secret to a 32-byte view, or null if it is malformed.
 * Returns a `Uint8Array` (a TypedArray) rather than a bare `ArrayBuffer` because
 * some `SubtleCrypto.importKey` implementations only accept a TypedArray view.
 */
function tryDecodeSecret(encoded: string): Uint8Array<ArrayBuffer> | null {
	try {
		const buf = base64ToArrayBuffer(encoded);
		return buf.byteLength === 32 ? new Uint8Array(buf) : null;
	} catch {
		return null;
	}
}

function readSecret(): Promise<string | null> {
	return openDb().then(
		(db) =>
			new Promise<string | null>((resolve, reject) => {
				const tx = db.transaction(KEY_STORE, 'readonly');
				const req = tx.objectStore(KEY_STORE).get(MASTER_KEY_ID);
				req.onsuccess = () => {
					const rec = req.result as
						| { id: string; secret: string }
						| undefined;
					resolve(rec?.secret ?? null);
				};
				req.onerror = () => {
					reject(
						new Error(req.error?.message ?? 'IndexedDB get (key) failed'),
					);
				};
				tx.oncomplete = () => {
					db.close();
				};
			}),
	);
}

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

// ── Encryption helpers ──────────────────────────────────────────────────────

/** Encrypt plaintext with the given key. Returns base64(iv || ciphertext). */
async function encryptWith(plaintext: string, key: CryptoKey): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);
	const encrypted = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		encoded,
	);
	const combined = new Uint8Array(iv.length + encrypted.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(encrypted), iv.length);
	return arrayBufferToBase64(combined.buffer);
}

/** Decrypt base64(iv || ciphertext) with the given key, or null on failure. */
async function decryptWith(
	ciphertext: string,
	key: CryptoKey,
): Promise<string | null> {
	try {
		const combined = base64ToArrayBuffer(ciphertext);
		const iv = new Uint8Array(combined, 0, 12);
		const data = new Uint8Array(combined, 12);
		const decrypted = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv },
			key,
			data,
		);
		return new TextDecoder().decode(decrypted);
	} catch {
		return null;
	}
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		const byte = bytes[i];
		if (byte === undefined) break;
		binary += String.fromCharCode(byte);
	}
	return globalThis.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = globalThis.atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

// ── Record I/O ──────────────────────────────────────────────────────────────

interface TokenRecord {
	repoUrl: string;
	encryptedToken: string;
}

function readRecord(repoUrl: string): Promise<TokenRecord | null> {
	return openDb().then(
		(db) =>
			new Promise<TokenRecord | null>((resolve, reject) => {
				const tx = db.transaction(TOKEN_STORE, 'readonly');
				const req = tx.objectStore(TOKEN_STORE).get(repoUrl);
				req.onsuccess = () => {
					resolve((req.result as TokenRecord | undefined) ?? null);
				};
				req.onerror = () => {
					reject(new Error(req.error?.message ?? 'IndexedDB get failed'));
				};
				tx.oncomplete = () => {
					db.close();
				};
			}),
	);
}

function writeRecord(record: TokenRecord): Promise<void> {
	return openDb().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(TOKEN_STORE, 'readwrite');
				tx.objectStore(TOKEN_STORE).put(record);
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => {
					reject(new Error(tx.error?.message ?? 'IndexedDB put failed'));
				};
			}),
	);
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
	async getToken(repoUrl: string): Promise<string | null> {
		const record = await readRecord(repoUrl);
		if (!record) return null;

		const viaCurrent = await decryptWith(
			record.encryptedToken,
			await getCryptoKey(),
		);
		if (viaCurrent !== null) return viaCurrent;

		// Migration: a record written by the old fingerprint-derived key.
		const viaLegacy = await decryptWith(
			record.encryptedToken,
			await deriveLegacyKey(),
		);
		if (viaLegacy !== null) {
			await this.setToken(repoUrl, viaLegacy);
			return viaLegacy;
		}

		throw new Error(
			`Stored git token for "${repoUrl}" could not be decrypted ` +
				'(it may have been created on a different device or app version). ' +
				'Re-enter the token in the workspace settings.',
		);
	}

	/** Encrypt and store a token for the given repository URL. */
	async setToken(repoUrl: string, token: string): Promise<void> {
		const encryptedToken = await encryptWith(token, await getCryptoKey());
		await writeRecord({ repoUrl, encryptedToken });
	}

	/** Delete a stored token. No-op if the key does not exist. */
	async deleteToken(repoUrl: string): Promise<void> {
		const db = await openDb();
		return new Promise<void>((resolve, reject) => {
			const tx = db.transaction(TOKEN_STORE, 'readwrite');
			tx.objectStore(TOKEN_STORE).delete(repoUrl);
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => {
				reject(new Error(tx.error?.message ?? 'IndexedDB delete failed'));
			};
		});
	}
}

/** @internal Test-only seam for exercising the legacy-migration path. */
export const __testing = {
	/** Write a record encrypted with the legacy fingerprint key. */
	async writeLegacyRecord(repoUrl: string, token: string): Promise<string> {
		const encryptedToken = await encryptWith(token, await deriveLegacyKey());
		await writeRecord({ repoUrl, encryptedToken });
		return encryptedToken;
	},
	/** Write a raw (already-encrypted or garbage) ciphertext string. */
	async writeRawRecord(repoUrl: string, encryptedToken: string): Promise<void> {
		await writeRecord({ repoUrl, encryptedToken });
	},
	/** Read the raw stored ciphertext for a repo, or null. */
	async readRawCiphertext(repoUrl: string): Promise<string | null> {
		const record = await readRecord(repoUrl);
		return record?.encryptedToken ?? null;
	},
	/** Write a raw (possibly malformed) master-secret value to the keys store. */
	async writeRawSecret(secret: string): Promise<void> {
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(KEY_STORE, 'readwrite');
			tx.objectStore(KEY_STORE).put({ id: MASTER_KEY_ID, secret });
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => {
				reject(new Error(tx.error?.message ?? 'IndexedDB put (key) failed'));
			};
		});
	},
	/** Reset the per-session key cache (so a deleted secret is re-read). */
	resetKeyCache(): void {
		cachedKey = null;
	},
};
