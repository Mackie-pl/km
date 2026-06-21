import { describe, it, expect } from 'vitest';

// ── Types ──────────────────────────────────────────────────────────────────

describe('GitCloneState', () => {
	it('should expose all clone states', async () => {
		const { GitCloneState } = await import('../types');
		expect(GitCloneState.NOT_CLONED).toBe('NOT_CLONED');
		expect(GitCloneState.CLONING).toBe('CLONING');
		expect(GitCloneState.READY).toBe('READY');
		expect(GitCloneState.ERROR).toBe('ERROR');
	});
});

describe('GitAuth', () => {
	it('should have token and optional username', () => {
		const auth: import('../types').GitAuth = {
			token: 'ghp_test123',
			username: 'user',
		};
		expect(auth.token).toBe('ghp_test123');
		expect(auth.username).toBe('user');

		const minimal: import('../types').GitAuth = { token: 'tok_abc' };
		expect(minimal.username).toBeUndefined();
	});
});

describe('GitFsBackend', () => {
	it('should satisfy isomorphic-git fs interface', async () => {
		const { createGitFsBackend } = await import('../fs');
		const fs = await createGitFsBackend('/tmp/test-repo');

		expect(typeof fs.promises.readFile).toBe('function');
		expect(typeof fs.promises.writeFile).toBe('function');
		expect(typeof fs.promises.mkdir).toBe('function');
		expect(typeof fs.promises.readdir).toBe('function');
		expect(typeof fs.promises.unlink).toBe('function');
		expect(typeof fs.promises.rename).toBe('function');
		expect(typeof fs.promises.stat).toBe('function');
	});

	it('should read and write files', async () => {
		const { createGitFsBackend } = await import('../fs');
		const fs = await createGitFsBackend('/test-repo');

		await fs.promises.writeFile('/test-repo/test.md', 'hello');
		const content = await fs.promises.readFile('/test-repo/test.md', 'utf8');
		expect(content).toBe('hello');
	});

	it('should list directory contents', async () => {
		const { createGitFsBackend } = await import('../fs');
		const fs = await createGitFsBackend('/test-repo');

		await fs.promises.writeFile('/test-repo/a.md', 'a');
		await fs.promises.writeFile('/test-repo/b.md', 'b');
		await fs.promises.mkdir('/test-repo/sub', { recursive: true });
		await fs.promises.writeFile('/test-repo/sub/c.md', 'c');

		const entries = await fs.promises.readdir('/test-repo');
		expect(entries).toContain('a.md');
		expect(entries).toContain('b.md');
		expect(entries).toContain('sub');
	});

	it('should delete files', async () => {
		const { createGitFsBackend } = await import('../fs');
		const fs = await createGitFsBackend('/test-repo');

		await fs.promises.writeFile('/test-repo/del.md', 'delete me');
		await fs.promises.unlink('/test-repo/del.md');
		await expect(
			fs.promises.readFile('/test-repo/del.md', 'utf8'),
		).rejects.toThrow();
	});

	it('should rename files', async () => {
		const { createGitFsBackend } = await import('../fs');
		const fs = await createGitFsBackend('/test-repo');

		await fs.promises.writeFile('/test-repo/old.md', 'content');
		await fs.promises.rename('/test-repo/old.md', '/test-repo/new.md');
		const content = await fs.promises.readFile('/test-repo/new.md', 'utf8');
		expect(content).toBe('content');
		await expect(
			fs.promises.readFile('/test-repo/old.md', 'utf8'),
		).rejects.toThrow();
	});

	it('should stat files and return metadata', async () => {
		const { createGitFsBackend } = await import('../fs');
		const fs = await createGitFsBackend('/test-repo');

		await fs.promises.writeFile('/test-repo/statted.md', 'data');
		const stat = await fs.promises.stat('/test-repo/statted.md');
		expect(stat).toHaveProperty('size');
		expect(stat).toHaveProperty('isDirectory');
		expect(stat.isDirectory()).toBe(false);
	});
});
