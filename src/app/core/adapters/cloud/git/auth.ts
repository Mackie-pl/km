/**
 * Encrypted token store for git authentication tokens.
 *
 * Uses Web Crypto (SubtleCrypto) to encrypt tokens before writing to IndexedDB.
 * Tokens are AES-GCM encrypted with a key derived from a device fingerprint
 * and app salt. No plaintext obfuscation fallback — encryption is mandatory.
 */

const DB_NAME = 'git-token-store';
const DB_VERSION = 1;
const STORE_NAME = 'tokens';

/**
 * Open the IndexedDB database, creating it if needed.
 */
function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE_NAME)) {
				req.result.createObjectStore(STORE_NAME, {
					keyPath: 'repoUrl',
				});
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

// ── Encryption helpers ────────────────────────────────────────────────────

/**
 * Derive an AES-GCM key from a device fingerprint + app salt.
 * The key is not persisted — it's re-derived on each access.
 */
async function deriveKey(): Promise<CryptoKey> {
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

/**
 * Build a device fingerprint from available browser/JS context values.
 * Not truly unique, but sufficient to deter casual IndexedDB scraping.
 */
function getDeviceFingerprint(): string {
	const parts: string[] = [
		navigator.userAgent,
		navigator.language,
		String(screen.width),
		String(screen.height),
		// Timezone offset helps distinguish devices
		String(new Date().getTimezoneOffset()),
	];

	// Try to get a more stable identifier from the origin
	if (typeof window !== 'undefined') {
		parts.push(window.location.origin);
	}

	return parts.join('||');
}

/**
 * Encrypt a plaintext token using AES-GCM.
 * Returns base64-encoded ciphertext with embedded IV.
 */
async function encryptToken(plaintext: string): Promise<string> {
	const key = await deriveKey();
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);
	const encrypted = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		encoded,
	);
	// Combine IV + ciphertext for storage
	const combined = new Uint8Array(iv.length + encrypted.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(encrypted), iv.length);
	return arrayBufferToBase64(combined.buffer);
}

/**
 * Decrypt a base64-encoded ciphertext using AES-GCM.
 * Returns the original plaintext, or null if decryption fails.
 */
async function decryptToken(ciphertext: string): Promise<string | null> {
	try {
		const key = await deriveKey();
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

// ── Public API ────────────────────────────────────────────────────────────

export class GitTokenStore {
	/**
	 * Retrieve an encrypted token for the given repository URL.
	 * @returns The plaintext token, or null if not found.
	 */
	async getToken(repoUrl: string): Promise<string | null> {
		const db = await openDb();
		return new Promise<string | null>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const store = tx.objectStore(STORE_NAME);
			const req = store.get(repoUrl);
			req.onsuccess = () => {
				const record = req.result as
					| { repoUrl: string; encryptedToken: string }
					| undefined;
				if (!record) {
					resolve(null);
					return;
				}
				void decryptToken(record.encryptedToken).then(resolve);
			};
			req.onerror = () => {
				reject(new Error(req.error?.message ?? 'IndexedDB get failed'));
			};
			tx.oncomplete = () => {
				db.close();
			};
		});
	}

	/**
	 * Encrypt and store a token for the given repository URL.
	 */
	async setToken(repoUrl: string, token: string): Promise<void> {
		const db = await openDb();
		const encryptedToken = await encryptToken(token);
		return new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			store.put({ repoUrl, encryptedToken });
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => {
				reject(new Error(tx.error?.message ?? 'IndexedDB put failed'));
			};
		});
	}

	/**
	 * Delete a stored token for the given repository URL.
	 * No-op if the key does not exist.
	 */
	async deleteToken(repoUrl: string): Promise<void> {
		const db = await openDb();
		return new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			store.delete(repoUrl);
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => {
				reject(
					new Error(tx.error?.message ?? 'IndexedDB delete failed'),
				);
			};
		});
	}
}
