import { describe, it, expect, beforeEach } from 'vitest';
import {
	EncryptedStore,
	encryptWith,
	type EncryptedStoreConfig,
} from '../crypto-store';

const CFG: EncryptedStoreConfig = {
	dbName: 'crypto-store-test',
	dbVersion: 1,
	recordStore: 'records',
	recordKeyPath: 'key',
	cipherField: 'cipher',
	keyStore: 'keys',
	masterKeyId: 'master',
};

describe('EncryptedStore', () => {
	let store: EncryptedStore;

	beforeEach(() => {
		// Fresh IndexedDB universe is provided per-test by vitest.setup.ts.
		store = new EncryptedStore(CFG);
	});

	it('round-trips an encrypted value', async () => {
		await store.setValue('k', 'secret-value');
		expect(await store.getValue('k')).toBe('secret-value');
	});

	it('returns null for an unknown key', async () => {
		expect(await store.getValue('missing')).toBeNull();
	});

	it('stores ciphertext, not plaintext', async () => {
		await store.setValue('k', 'plaintext');
		const cipher = await store.readCipher('k');
		expect(cipher).not.toBeNull();
		expect(cipher).not.toBe('plaintext');
	});

	it('deletes a record', async () => {
		await store.setValue('k', 'v');
		await store.deleteRecord('k');
		expect(await store.getValue('k')).toBeNull();
	});

	it('throws on an undecryptable record (with custom message)', async () => {
		await store.writeCipher('k', 'not-valid-ciphertext!!');
		await expect(
			store.getValue('k', { errorMessage: 'custom boom' }),
		).rejects.toThrow('custom boom');
	});

	it('migrates a value encrypted under a legacy key', async () => {
		const legacyRaw = crypto.getRandomValues(new Uint8Array(32));
		const legacyKey = await crypto.subtle.importKey(
			'raw',
			legacyRaw,
			{ name: 'AES-GCM' },
			false,
			['encrypt', 'decrypt'],
		);
		const legacyCipher = await encryptWith('legacy-secret', legacyKey);
		await store.writeCipher('k', legacyCipher);

		// First read decrypts via the legacy fallback...
		expect(
			await store.getValue('k', {
				getLegacyKeys: () => Promise.resolve([legacyKey]),
			}),
		).toBe('legacy-secret');

		// ...and re-encrypts under the current key (ciphertext changed).
		expect(await store.readCipher('k')).not.toBe(legacyCipher);
		// Subsequent reads work without the legacy key.
		expect(await store.getValue('k')).toBe('legacy-secret');
	});
});
