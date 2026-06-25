import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('GitTokenStore', () => {
	const TEST_REPO = 'https://github.com/test/repo.git';
	const TEST_TOKEN = 'ghp_abcdef123456';

	beforeEach(async () => {
		const { GitTokenStore } = await import('../auth');
		const store = new GitTokenStore();
		await store.deleteToken(TEST_REPO);
	});

	afterEach(async () => {
		const { GitTokenStore } = await import('../auth');
		const store = new GitTokenStore();
		await store.deleteToken(TEST_REPO);
	});

	it('should store and retrieve a token', async () => {
		const { GitTokenStore } = await import('../auth');
		const store = new GitTokenStore();
		await store.setToken(TEST_REPO, TEST_TOKEN);
		const retrieved = await store.getToken(TEST_REPO);
		expect(retrieved).toBe(TEST_TOKEN);
	});

	it('should return null for unknown repo', async () => {
		const { GitTokenStore } = await import('../auth');
		const store = new GitTokenStore();
		const result = await store.getToken(
			'https://github.com/unknown/repo.git',
		);
		expect(result).toBeNull();
	});

	it('should delete a stored token', async () => {
		const { GitTokenStore } = await import('../auth');
		const store = new GitTokenStore();
		await store.setToken(TEST_REPO, TEST_TOKEN);
		await store.deleteToken(TEST_REPO);
		const result = await store.getToken(TEST_REPO);
		expect(result).toBeNull();
	});

	it('should encrypt tokens — stored value should not be plaintext', async () => {
		const { GitTokenStore, __testing } = await import('../auth');
		const store = new GitTokenStore();
		await store.setToken(TEST_REPO, TEST_TOKEN);
		const retrieved = await store.getToken(TEST_REPO);
		expect(retrieved).toBe(TEST_TOKEN);

		const raw = await __testing.readRawCiphertext(TEST_REPO);
		expect(raw).not.toBeNull();
		expect(raw).not.toBe(TEST_TOKEN);
	});

	it('should transparently migrate a legacy-encrypted token', async () => {
		const { GitTokenStore, __testing } = await import('../auth');
		const store = new GitTokenStore();

		// Simulate a token written by the old fingerprint-derived scheme.
		const legacyCipher = await __testing.writeLegacyRecord(
			TEST_REPO,
			TEST_TOKEN,
		);

		// First read decrypts via the legacy fallback...
		expect(await store.getToken(TEST_REPO)).toBe(TEST_TOKEN);

		// ...and re-encrypts with the current key (ciphertext changed).
		const rawAfter = await __testing.readRawCiphertext(TEST_REPO);
		expect(rawAfter).not.toBeNull();
		expect(rawAfter).not.toBe(legacyCipher);

		// Subsequent reads still work against the migrated record.
		expect(await store.getToken(TEST_REPO)).toBe(TEST_TOKEN);
	});

	it('should throw (not return null) when a stored record cannot be decrypted', async () => {
		const { GitTokenStore, __testing } = await import('../auth');
		const store = new GitTokenStore();

		await __testing.writeRawRecord(TEST_REPO, 'not-valid-base64-ciphertext!!');

		await expect(store.getToken(TEST_REPO)).rejects.toThrow();
	});

	it('should self-heal a corrupt master secret instead of crashing', async () => {
		const { GitTokenStore, __testing } = await import('../auth');

		// Simulate a secret left by an earlier build that stored a raw buffer:
		// reading it back as a string yields un-decodable base64.
		await __testing.writeRawSecret('[object ArrayBuffer]');
		__testing.resetKeyCache();

		const store = new GitTokenStore();
		await store.setToken(TEST_REPO, TEST_TOKEN);
		expect(await store.getToken(TEST_REPO)).toBe(TEST_TOKEN);
	});

	it('should handle multiple repos independently', async () => {
		const { GitTokenStore } = await import('../auth');
		const store = new GitTokenStore();
		await store.setToken('https://github.com/repo-a.git', 'token-a');
		await store.setToken('https://github.com/repo-b.git', 'token-b');

		expect(await store.getToken('https://github.com/repo-a.git')).toBe(
			'token-a',
		);
		expect(await store.getToken('https://github.com/repo-b.git')).toBe(
			'token-b',
		);

		await store.deleteToken('https://github.com/repo-a.git');
		expect(
			await store.getToken('https://github.com/repo-a.git'),
		).toBeNull();
		expect(await store.getToken('https://github.com/repo-b.git')).toBe(
			'token-b',
		);
	});

	it('should deleteToken not throw when key is missing', async () => {
		const { GitTokenStore } = await import('../auth');
		const store = new GitTokenStore();
		await expect(
			store.deleteToken('https://github.com/nonexistent.git'),
		).resolves.toBeUndefined();
	});
});
