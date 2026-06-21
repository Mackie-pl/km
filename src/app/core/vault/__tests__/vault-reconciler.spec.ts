import { TestBed } from '@angular/core/testing';
import {
	createMockWorkspace,
	setupVaultStore,
} from '@core/__tests__/test-setup';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VaultReconciler (via VaultStore public API)', () => {
	beforeEach(() => {
		TestBed.resetTestingModule();
	});

	describe('applyExternalFile', () => {
		it('should create a new entry for unknown path', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.applyExternalFile(
				'incoming.md',
				'external content',
				'remote-1',
			);

			const entry = vault.getByPath('incoming.md');
			expect(entry).toBeDefined();
			expect(entry?.content).toBe('external content');
		});

		it('should mark new entry as pending for other adapters', async () => {
			const ws = createMockWorkspace({
				activeSyncAdapters: ['test-fs', 'remote-2'],
			});
			const { vault } = setupVaultStore(ws);
			await vault.init();

			await vault.applyExternalFile('shared.md', 'content', 'remote-2');

			const entry = vault.getByPath('shared.md');
			expect(entry?.pendingAdapters).toContain('test-fs');
			expect(entry?.pendingAdapters).not.toContain('remote-2');
		});

		it('should overwrite existing entry with no pending changes', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('note.md', 'local content');
			const created = vault.getByPath('note.md');
			await vault.markAdapterSynced(created!.id, 'test-fs');

			await vault.applyExternalFile(
				'note.md',
				'external content',
				'remote-1',
			);

			const entry = vault.getByPath('note.md');
			expect(entry?.content).toBe('external content');
			expect(entry?.revision).toBe(2);
		});

		it('should create conflict copy when local pending changes exist and content differs', async () => {
			const ws = createMockWorkspace({
				activeSyncAdapters: ['test-fs', 'remote-1'],
			});
			const { vault } = setupVaultStore(ws);
			await vault.init();

			await vault.createFile('note.md', 'local change');

			// Conflict: local has pending changes, external comes in with different content
			await vault.applyExternalFile(
				'note.md',
				'external change',
				'remote-1',
			);

			// Original should still have local content
			const original = vault.getByPath('note.md');
			expect(original?.content).toBe('local change');

			// Conflict copy should exist with external content
			const conflict = vault.getByPath('note.conflict-remote-1.md');
			expect(conflict).toBeDefined();
			expect(conflict?.content).toBe('external change');
		});

		it('should NOT create conflict copy when external content matches local', async () => {
			const ws = createMockWorkspace({
				activeSyncAdapters: ['test-fs', 'remote-1'],
			});
			const { vault } = setupVaultStore(ws);
			await vault.init();

			await vault.createFile('note.md', 'same content');

			await vault.applyExternalFile(
				'note.md',
				'same content',
				'remote-1',
			);

			// No conflict — content matches, just remove remote-1 from pending
			const entry = vault.getByPath('note.md');
			expect(entry?.content).toBe('same content');
			expect(entry?.pendingAdapters).not.toContain('remote-1');

			// No conflict copy
			const conflict = vault.getByPath('note.conflict-remote-1.md');
			expect(conflict).toBeUndefined();
		});

		it('should restore a soft-deleted entry when external file appears', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('note.md', 'original');
			const created = vault.getByPath('note.md');
			await vault.delete(created!.id);
			expect(vault.getByPath('note.md')).toBeUndefined();

			await vault.applyExternalFile('note.md', 'restored', 'remote-1');

			const entry = vault.getByPath('note.md');
			expect(entry).toBeDefined();
			expect(entry?.content).toBe('restored');
			expect(entry?.deleted).toBe(false);
		});
	});

	describe('applyExternalFolder', () => {
		it('should create a folder entry for new path', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.applyExternalFolder('subdir', 'remote-1');

			const folder = vault.getByPath('subdir');
			expect(folder).toBeDefined();
			expect(folder?.type).toBe('folder');
		});

		it('should skip if folder already exists', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFolder('existing');
			await vault.applyExternalFolder('existing', 'remote-1');

			// Should not duplicate
			const folders = vault.folders();
			expect(folders.filter((f) => f.path === 'existing').length).toBe(1);
		});

		it('should skip if path is taken by a file', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('clash.md', 'i am a file');

			// Should not throw, just skip with warning
			await vault.applyExternalFolder('clash.md', 'remote-1');

			const entry = vault.getByPath('clash.md');
			expect(entry).toBeDefined();
			expect(entry?.type).toBe('file'); // Still a file
		});
	});

	describe('applyExternalRename', () => {
		it('should apply a clean external rename', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('old.md', 'content');
			const created = vault.getByPath('old.md');
			await vault.markAdapterSynced(created!.id, 'test-fs');

			await vault.applyExternalRename('old.md', 'new.md', 'remote-1');

			expect(vault.getByPath('old.md')).toBeUndefined();
			const renamed = vault.getByPath('new.md');
			expect(renamed).toBeDefined();
			expect(renamed?.name).toBe('new.md');
		});

		it('should preserve local changes as a new entry on rename conflict', async () => {
			const ws = createMockWorkspace({
				id: 'ws-1',
				activeSyncAdapters: ['test-fs', 'remote-1'],
			});
			const { vault } = setupVaultStore(ws);
			await vault.init();

			await vault.createFile('old.md', 'local pending change');
			// Don't mark synced — keep pending

			await vault.applyExternalRename('old.md', 'new.md', 'remote-1');

			// Original stays at old path
			const original = vault.getByPath('old.md');
			expect(original).toBeDefined();
			expect(original?.content).toBe('local pending change');

			// New name gets a separate entry
			const renamed = vault.getByPath('new.md');
			expect(renamed).toBeDefined();
			expect(renamed?.content).toBe('local pending change');
		});
	});
});
