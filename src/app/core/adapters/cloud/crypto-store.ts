/**
 * Generic AES-GCM encrypted record store backed by IndexedDB.
 *
 * Shared by the cloud adapters (git PAT store, Google Drive OAuth token store)
 * so the crypto + master-secret + IndexedDB plumbing lives in one place rather
 * than being copy-pasted per adapter (which would also trip the jscpd gate).
 *
 * Each value is encrypted with a random 256-bit master secret generated once on
 * this device and stored alongside the records. The secret is held as a base64
 * string (not a raw ArrayBuffer) to avoid structured-clone realm quirks where a
 * round-tripped buffer fails `importKey`'s type check.
 *
 * Threat model: this protects values at rest from casual IndexedDB scraping. It
 * does NOT defend against an attacker who can run script in this origin (e.g.
 * XSS) — such an attacker can call the public read API directly.
 */

export interface EncryptedStoreConfig {
	/** IndexedDB database name. */
	dbName: string;
	/** Schema version. Bump when adding stores. */
	dbVersion: number;
	/** Object store holding the encrypted records. */
	recordStore: string;
	/** keyPath of the record store (the lookup key, e.g. 'repoUrl'). */
	recordKeyPath: string;
	/** Field on each record holding the base64 ciphertext. */
	cipherField: string;
	/** Object store holding the master secret. */
	keyStore: string;
	/** Record id of the master secret within {@link keyStore}. */
	masterKeyId: string;
}

// ── base64 helpers ───────────────────────────────────────────────────────────

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		const byte = bytes[i];
		if (byte === undefined) break;
		binary += String.fromCharCode(byte);
	}
	return globalThis.btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = globalThis.atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

// ── crypto helpers (key-parameterized so callers can supply legacy keys) ──────

/** Encrypt plaintext with the given key. Returns base64(iv || ciphertext). */
export async function encryptWith(
	plaintext: string,
	key: CryptoKey,
): Promise<string> {
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
export async function decryptWith(
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

// ── store ────────────────────────────────────────────────────────────────────

export class EncryptedStore {
	/** Cached per-instance so concurrent calls share one key-load (no race). */
	private cachedKey: Promise<CryptoKey> | null = null;

	constructor(private readonly cfg: EncryptedStoreConfig) {}

	/**
	 * Open the database, creating/upgrading both object stores if needed.
	 */
	private openDb(): Promise<IDBDatabase> {
		const { dbName, dbVersion, recordStore, recordKeyPath, keyStore } =
			this.cfg;
		return new Promise((resolve, reject) => {
			const req = indexedDB.open(dbName, dbVersion);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(recordStore)) {
					db.createObjectStore(recordStore, { keyPath: recordKeyPath });
				}
				if (!db.objectStoreNames.contains(keyStore)) {
					db.createObjectStore(keyStore, { keyPath: 'id' });
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

	// ── key management ───────────────────────────────────────────────────────

	/** The current AES-GCM key, derived from the stored random master secret. */
	getCryptoKey(): Promise<CryptoKey> {
		// Clear the cache on failure so a one-time error (e.g. transient IDB
		// issue) doesn't permanently wedge a rejected promise for the session.
		this.cachedKey ??= this.loadOrCreateKey().catch((err: unknown) => {
			this.cachedKey = null;
			throw err;
		});
		return this.cachedKey;
	}

	/** Reset the per-instance key cache (so a deleted secret is re-read). */
	resetKeyCache(): void {
		this.cachedKey = null;
	}

	private async loadOrCreateKey(): Promise<CryptoKey> {
		const secret = await this.getOrCreateSecret();
		return crypto.subtle.importKey('raw', secret, { name: 'AES-GCM' }, false, [
			'encrypt',
			'decrypt',
		]);
	}

	/**
	 * Read the stored master secret, generating + persisting it if absent.
	 *
	 * Self-healing: a missing, malformed, or wrong-length stored secret (e.g.
	 * left by an earlier build that stored a raw ArrayBuffer) is replaced with a
	 * fresh one rather than throwing — a corrupt secret must not crash init. Any
	 * values encrypted under the lost secret then fail to decrypt and surface a
	 * re-enter error, which is the correct degradation.
	 */
	private async getOrCreateSecret(): Promise<Uint8Array<ArrayBuffer>> {
		const existing = await this.readSecret();
		const decoded = existing !== null ? tryDecodeSecret(existing) : null;
		if (decoded) return decoded;

		const secret = crypto.getRandomValues(new Uint8Array(32));
		await this.writeSecret(arrayBufferToBase64(secret.buffer));
		return secret;
	}

	private readSecret(): Promise<string | null> {
		const { keyStore, masterKeyId } = this.cfg;
		return this.openDb().then(
			(db) =>
				new Promise<string | null>((resolve, reject) => {
					const tx = db.transaction(keyStore, 'readonly');
					const req = tx.objectStore(keyStore).get(masterKeyId);
					req.onsuccess = () => {
						const rec = req.result as
							| { id: string; secret: string }
							| undefined;
						resolve(rec?.secret ?? null);
					};
					req.onerror = () => {
						reject(
							new Error(
								req.error?.message ?? 'IndexedDB get (key) failed',
							),
						);
					};
					tx.oncomplete = () => {
						db.close();
					};
				}),
		);
	}

	/** Persist a (possibly raw/test) master-secret value to the key store. */
	writeSecret(secret: string): Promise<void> {
		const { keyStore, masterKeyId } = this.cfg;
		return this.openDb().then(
			(db) =>
				new Promise<void>((resolve, reject) => {
					const tx = db.transaction(keyStore, 'readwrite');
					tx.objectStore(keyStore).put({ id: masterKeyId, secret });
					tx.oncomplete = () => {
						db.close();
						resolve();
					};
					tx.onerror = () => {
						reject(
							new Error(
								tx.error?.message ?? 'IndexedDB put (key) failed',
							),
						);
					};
				}),
		);
	}

	// ── value API ──────────────────────────────────────────────────────────

	/** Encrypt + store a value under `key`. */
	async setValue(key: string, value: string): Promise<void> {
		const cipher = await encryptWith(value, await this.getCryptoKey());
		await this.writeCipher(key, cipher);
	}

	/**
	 * Decrypt + return the value under `key`. Returns null when no record
	 * exists. THROWS when a record exists but cannot be decrypted with the
	 * current key — callers that require the value surface a real error rather
	 * than silently treating it as absent.
	 *
	 * `getLegacyKeys` is invoked lazily (only when the current key fails) to
	 * attempt a transparent migration: the first legacy key that decrypts is
	 * re-encrypted under the current key. `errorMessage` overrides the thrown
	 * message so callers can give domain-specific guidance.
	 */
	async getValue(
		key: string,
		opts: {
			getLegacyKeys?: () => Promise<CryptoKey[]>;
			errorMessage?: string;
		} = {},
	): Promise<string | null> {
		const cipher = await this.readCipher(key);
		if (cipher === null) return null;

		const viaCurrent = await decryptWith(cipher, await this.getCryptoKey());
		if (viaCurrent !== null) return viaCurrent;

		if (opts.getLegacyKeys) {
			for (const legacy of await opts.getLegacyKeys()) {
				const viaLegacy = await decryptWith(cipher, legacy);
				if (viaLegacy !== null) {
					await this.setValue(key, viaLegacy);
					return viaLegacy;
				}
			}
		}

		throw new Error(
			opts.errorMessage ??
				`Stored value for "${key}" could not be decrypted ` +
					'(it may have been created on a different device or app version).',
		);
	}

	/** Read the raw base64 ciphertext for `key`, or null. */
	readCipher(key: string): Promise<string | null> {
		const { recordStore, cipherField } = this.cfg;
		return this.openDb().then(
			(db) =>
				new Promise<string | null>((resolve, reject) => {
					const tx = db.transaction(recordStore, 'readonly');
					const req = tx.objectStore(recordStore).get(key);
					req.onsuccess = () => {
						const rec = req.result as Record<string, string> | undefined;
						resolve(rec?.[cipherField] ?? null);
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

	/** Write a raw base64 ciphertext for `key`. */
	writeCipher(key: string, cipher: string): Promise<void> {
		const { recordStore, recordKeyPath, cipherField } = this.cfg;
		const record: Record<string, string> = {
			[recordKeyPath]: key,
			[cipherField]: cipher,
		};
		return this.openDb().then(
			(db) =>
				new Promise<void>((resolve, reject) => {
					const tx = db.transaction(recordStore, 'readwrite');
					tx.objectStore(recordStore).put(record);
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

	/** Delete the record under `key`. No-op if absent. */
	deleteRecord(key: string): Promise<void> {
		const { recordStore } = this.cfg;
		return this.openDb().then(
			(db) =>
				new Promise<void>((resolve, reject) => {
					const tx = db.transaction(recordStore, 'readwrite');
					tx.objectStore(recordStore).delete(key);
					tx.oncomplete = () => {
						db.close();
						resolve();
					};
					tx.onerror = () => {
						reject(
							new Error(tx.error?.message ?? 'IndexedDB delete failed'),
						);
					};
				}),
		);
	}
}

/**
 * Decode a stored secret to a 32-byte view, or null if it is malformed.
 * Returns a `Uint8Array` view (not a bare `ArrayBuffer`) because some
 * `SubtleCrypto.importKey` implementations only accept a TypedArray.
 */
function tryDecodeSecret(encoded: string): Uint8Array<ArrayBuffer> | null {
	try {
		const buf = base64ToArrayBuffer(encoded);
		return buf.byteLength === 32 ? new Uint8Array(buf) : null;
	} catch {
		return null;
	}
}
