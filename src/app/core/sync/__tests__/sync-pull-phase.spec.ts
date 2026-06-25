import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SyncPullPhase } from '../sync-pull-phase';
import { VaultStore } from '@vault/store';
import { createMockWorkspace, setupVaultStore } from '@core/__tests__/test-setup';
import type { Adapter, FileEntry } from '@core/adapters/adapter.interface';
import type { ActiveAdapterEntry } from '../sync-types';

/**
 * Minimal in-memory adapter for pull-phase tests. `list` is derived from the
 * `files` map by default but can be reassigned per-test to throw or return an
 * empty listing — the two failure modes that must NOT trigger orphan deletion.
 */
class FakeAdapter implements Adapter {
	readonly id = 'test-fs';
	readonly isLocal = true;
	readonly files = new Map<string, string>();

	isAvailable(): boolean {
		return true;
	}
	pickWorkspaceFolder(): Promise<null> {
		return Promise.resolve(null);
	}
	read(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`no such file: ${path}`);
		return Promise.resolve(content);
	}
	write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
		return Promise.resolve();
	}
	delete(path: string): Promise<void> {
		this.files.delete(path);
		return Promise.resolve();
	}
	rename(): Promise<void> {
		return Promise.resolve();
	}
	list(): Promise<FileEntry[]> {
		return Promise.resolve(
			[...this.files.keys()].map((path) => ({
				path,
				name: path.split('/').pop() ?? path,
				isDirectory: false,
				lastModified: 0,
			})),
		);
	}
}

interface PullTestContext {
	vault: VaultStore;
	adapter: FakeAdapter;
	pull: SyncPullPhase;
	adapters: ActiveAdapterEntry[];
}

function setup(): PullTestContext {
	const ws = createMockWorkspace();
	const { vault } = setupVaultStore(ws);
	const adapter = new FakeAdapter();
	const pull = new SyncPullPhase(vault);
	const adapters: ActiveAdapterEntry[] = [{ adapter, root: 'test:/root' }];
	return { vault, adapter, pull, adapters };
}

describe('SyncPullPhase — orphan detection safety', () => {
	beforeEach(() => {
		TestBed.resetTestingModule();
	});

	it('does not delete vault files when a later listing throws', async () => {
		const { vault, adapter, pull, adapters } = setup();
		await vault.init();

		adapter.files.set('a.md', 'hello');
		await pull.execute(adapters); // first pull imports a.md
		expect(vault.getByPath('a.md')).toBeDefined();

		const deleteSpy = vi.spyOn(vault, 'delete');
		adapter.list = () => {
			throw new Error('transient connection failure');
		};

		// Second pull fails — must surface an error but never delete.
		await expect(pull.execute(adapters)).rejects.toThrow();
		expect(deleteSpy).not.toHaveBeenCalled();
		expect(vault.getByPath('a.md')).toBeDefined();
	});

	it('does not delete vault files when a later listing is empty', async () => {
		const { vault, adapter, pull, adapters } = setup();
		await vault.init();

		adapter.files.set('a.md', 'hello');
		adapter.files.set('b.md', 'world');
		await pull.execute(adapters); // first pull imports both
		expect(vault.getByPath('a.md')).toBeDefined();
		expect(vault.getByPath('b.md')).toBeDefined();

		const deleteSpy = vi.spyOn(vault, 'delete');
		adapter.files.clear(); // remote now lists nothing

		await pull.execute(adapters);

		expect(deleteSpy).not.toHaveBeenCalled();
		expect(vault.getByPath('a.md')).toBeDefined();
		expect(vault.getByPath('b.md')).toBeDefined();
	});

	it('still orphan-deletes a single file genuinely removed from a non-empty listing', async () => {
		const { vault, adapter, pull, adapters } = setup();
		await vault.init();

		adapter.files.set('a.md', 'hello');
		adapter.files.set('b.md', 'world');
		await pull.execute(adapters); // first pull imports both

		adapter.files.delete('b.md'); // genuine deletion; listing still non-empty

		await pull.execute(adapters);

		expect(vault.getByPath('a.md')).toBeDefined();
		expect(vault.getByPath('b.md')).toBeUndefined();
	});
});
