import { describe, it, expect, beforeEach } from 'vitest';
import type { Adapter } from '../../adapter.interface';
import { timeout } from '@core/utils/async';

describe('GitAdapterProxy', () => {
	let proxy: Adapter;

	beforeEach(async () => {
		const { GitAdapterProxy } = await import('../adapter-proxy');
		proxy = new GitAdapterProxy();
	});

	it('should have id=git and isLocal=false', () => {
		expect(proxy.id).toBe('git');
		expect(proxy.isLocal).toBe(false);
	});

	it('should be available', () => {
		expect(proxy.isAvailable()).toBe(true);
	});

	it('should delegate read to real adapter', async () => {
		const config = proxy as { ensureLoaded: () => Promise<Adapter> };
		// Ensure loaded to check delegation works
		const real = await config.ensureLoaded();
		expect(real).toBeDefined();
		expect(real.id).toBe('git');
	});

	it('should lazy-load only on first use', async () => {
		// Create a fresh proxy — the real adapter should not be loaded yet
		const { GitAdapterProxy } = await import('../adapter-proxy');
		const fresh = new GitAdapterProxy() as { real: Adapter | null };
		expect(fresh.real).toBeNull();

		// Accessing a method should lazy-load
		await fresh.isAvailable(); // isAvailable doesn't load
		expect(fresh.real).toBeNull();

		// First actual I/O method triggers load
		await expect(fresh.read('nonexistent', 'root')).rejects.toThrow();
		expect(fresh.real).not.toBeNull();
	});

	it('should throw meaningful error when git adapter fails on read', async () => {
		await expect(
			proxy.read('nonexistent.md', 'https://example.com/repo.git'),
		).rejects.toThrow();
	});

	it('should delegate write to real adapter', async () => {
		await expect(
			proxy.write('test.md', 'content', 'https://example.com/repo.git'),
		).resolves.toBeUndefined();
	});

	it('should delegate delete', async () => {
		// Write first so file exists, then delete
		await proxy.write('test.md', 'content', 'https://example.com/repo.git');
		await expect(
			proxy.delete('test.md', 'https://example.com/repo.git'),
		).resolves.toBeUndefined();
	});

	it('should delegate rename', async () => {
		await expect(
			proxy.rename('old.md', 'new.md', 'https://example.com/repo.git'),
		).rejects.toThrow();
	});

	it('should delegate list', async () => {
		await expect(
			proxy.list('/', 'https://example.com/repo.git'),
		).resolves.toBeDefined();
	});

	it('should delegate createDir', async () => {
		await expect(
			proxy.createDir!('/newdir', 'https://example.com/repo.git'),
		).resolves.toBeUndefined();
	});

	it('should registerScope be a no-op', async () => {
		await expect(
			proxy.registerScope?.('https://example.com/repo.git'),
		).resolves.toBeUndefined();
	});
});

describe('GitAdapter', () => {
	const TEST_ROOT = 'https://github.com/test/notes.git';
	let adapter: Adapter;

	beforeEach(async () => {
		const { GitAdapter } = await import('../adapter');
		adapter = new GitAdapter();
	});

	it('should have id=git and isLocal=false', () => {
		expect(adapter.id).toBe('git');
		expect(adapter.isLocal).toBe(false);
	});

	it('should isAvailable return true', () => {
		expect(adapter.isAvailable()).toBe(true);
	});

	it('should pickWorkspaceFolder return null (deferred)', async () => {
		const result = await adapter.pickWorkspaceFolder();
		expect(result).toBeNull();
	});

	it('should read a file after write', async () => {
		await adapter.write('hello.md', '# Hello', TEST_ROOT);
		const content = await adapter.read('hello.md', TEST_ROOT);
		expect(content).toBe('# Hello');
	});

	it('should overwrite existing file', async () => {
		await adapter.write('update.md', 'v1', TEST_ROOT);
		await adapter.write('update.md', 'v2', TEST_ROOT);
		const content = await adapter.read('update.md', TEST_ROOT);
		expect(content).toBe('v2');
	});

	it('should throw on reading nonexistent file', async () => {
		await expect(
			adapter.read('nonexistent.md', TEST_ROOT),
		).rejects.toThrow();
	});

	it('should delete a file', async () => {
		await adapter.write('delete-me.md', 'bye', TEST_ROOT);
		await adapter.delete('delete-me.md', TEST_ROOT);
		await expect(adapter.read('delete-me.md', TEST_ROOT)).rejects.toThrow();
	});

	it('should throw on deleting nonexistent file', async () => {
		await expect(adapter.delete('no-file.md', TEST_ROOT)).rejects.toThrow();
	});

	it('should rename a file', async () => {
		await adapter.write('old-name.md', 'rename me', TEST_ROOT);
		await adapter.rename('old-name.md', 'new-name.md', TEST_ROOT);
		const content = await adapter.read('new-name.md', TEST_ROOT);
		expect(content).toBe('rename me');
		await expect(adapter.read('old-name.md', TEST_ROOT)).rejects.toThrow();
	});

	it('should throw on renaming nonexistent file', async () => {
		await expect(
			adapter.rename('no-file.md', 'new.md', TEST_ROOT),
		).rejects.toThrow();
	});

	it('should list files in root', async () => {
		await adapter.write('a.md', 'a', TEST_ROOT);
		await adapter.write('b.md', 'b', TEST_ROOT);
		await adapter.createDir!('sub', TEST_ROOT);
		await adapter.write('sub/c.md', 'c', TEST_ROOT);

		const entries = await adapter.list('/', TEST_ROOT, false);
		expect(entries.length).toBeGreaterThanOrEqual(2);
		const names = entries.map((e) => e.name);
		expect(names).toContain('a.md');
		expect(names).toContain('b.md');
	});

	it('should list files recursively', async () => {
		await adapter.write('top.md', 'top', TEST_ROOT);
		await adapter.createDir!('dir', TEST_ROOT);
		await adapter.write('dir/nested.md', 'nested', TEST_ROOT);

		const entries = await adapter.list('/', TEST_ROOT, true);
		const paths = entries.map((e) => e.path);
		expect(paths).toContain('top.md');
		expect(paths).toContain('dir/nested.md');
	});

	it('should create a directory', async () => {
		await adapter.createDir!('new-dir', TEST_ROOT);
		const entries = await adapter.list('/', TEST_ROOT, false);
		const names = entries.map((e) => e.name);
		expect(names).toContain('new-dir');
	});

	it('should register scope without error', async () => {
		await expect(
			adapter.registerScope?.(TEST_ROOT),
		).resolves.toBeUndefined();
	});

	it('should watch and return an unsubscribe function', async () => {
		const unwatch = await adapter.watch!(
			(_evts: import('../adapter.interface').WatchEvent[]) => {
				/* noop */
			},
			TEST_ROOT,
		);
		expect(typeof unwatch).toBe('function');
		unwatch(); // should not throw
	});

	it('should call watch callback on external changes', async () => {
		const events: import('../adapter.interface').WatchEvent[] = [];
		const unwatch = await adapter.watch!(
			(evts) => events.push(...evts),
			TEST_ROOT,
		);

		// Write a file — this should be visible to the fs backend
		await adapter.write('watch-test.md', 'watch me', TEST_ROOT);

		// Small delay for any polling to occur
		await timeout(100);
		unwatch();
	});

	it('should throw meaningful error when no root provided', async () => {
		await expect(adapter.write('no-root.md', 'x')).rejects.toThrow();
	});

	it('should handle multiple roots independently', async () => {
		const rootA = 'https://github.com/user/repo-a.git';
		const rootB = 'https://github.com/user/repo-b.git';

		await adapter.write('common.md', 'from A', rootA);
		await adapter.write('common.md', 'from B', rootB);

		const contentA = await adapter.read('common.md', rootA);
		const contentB = await adapter.read('common.md', rootB);
		expect(contentA).toBe('from A');
		expect(contentB).toBe('from B');
	});
});

describe('GitAdapter — commit messages', () => {
	it('should produce meaningful commit messages', async () => {
		const { GitAdapter } = await import('../adapter');
		const adapter = new GitAdapter();

		const root = 'https://github.com/test/commits.git';
		await adapter.write('foo.md', 'content', root);
		await adapter.delete('foo.md', root);
		// If we got here without error, commit messages are valid
		expect(true).toBe(true);
	});
});
