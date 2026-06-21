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
		const { GitTokenStore } = await import('../auth');
		const store = new GitTokenStore();
		await store.setToken(TEST_REPO, TEST_TOKEN);
		const retrieved = await store.getToken(TEST_REPO);
		expect(retrieved).toBe(TEST_TOKEN);

		const req = indexedDB.open('git-token-store', 1);
		const raw = await new Promise<unknown>((resolve) => {
			req.onsuccess = () => {
				const db = req.result;
				const tx = db.transaction('tokens', 'readonly');
				const store_ = tx.objectStore('tokens');
				const getReq = store_.get(TEST_REPO);
				getReq.onsuccess = () => {
					resolve(getReq.result);
				};
				getReq.onerror = () => {
					resolve(null);
				};
				tx.oncomplete = () => {
					db.close();
				};
			};
			req.onupgradeneeded = () => {
				resolve(null);
			};
		});
		expect(raw).not.toBe(TEST_TOKEN);
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
