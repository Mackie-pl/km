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

		it('should NOT create conflict copy when remote matches last-synced base (stale remote)', async () => {
			const ws = createMockWorkspace({
				activeSyncAdapters: ['test-fs', 'remote-1'],
			});
			const { vault } = setupVaultStore(ws);
			await vault.init();

			// v1 synced with remote-1 (equal-content pull records the base)
			await vault.createFile('note.md', 'v1');
			await vault.applyExternalFile('note.md', 'v1', 'remote-1');

			// Local edit → v2 pending; remote still serves stale v1
			const entry = vault.getByPath('note.md');
			await vault.updateFile(entry!.id, 'v2');
			await vault.applyExternalFile('note.md', 'v1', 'remote-1');

			// No conflict copy; local edit and its pending flag survive
			expect(vault.getByPath('note.conflict-remote-1.md')).toBeUndefined();
			const after = vault.getByPath('note.md');
			expect(after?.content).toBe('v2');
			expect(after?.pendingAdapters).toContain('remote-1');
		});

		it('should fast-forward (no conflict) when local matches base and remote moved forward, even while pending for another adapter', async () => {
			const ws = createMockWorkspace({
				activeSyncAdapters: ['test-fs', 'remote-1'],
			});
			const { vault } = setupVaultStore(ws);
			await vault.init();

			// v1 created and synced with remote-1; still pending for test-fs
			// (mirrors a note pending only for a broken gdrive adapter).
			await vault.createFile('note.md', 'v1');
			await vault.applyExternalFile('note.md', 'v1', 'remote-1');
			const entry = vault.getByPath('note.md');
			expect(entry?.pendingAdapters).toEqual(['test-fs']);

			// remote-1 (the disk) moved forward to v2 via an external editor.
			// Local is still exactly the base → nothing local to lose.
			await vault.applyExternalFile('note.md', 'v2', 'remote-1');

			// No conflict copy; main note adopts the newer content
			expect(vault.getByPath('note.conflict-remote-1.md')).toBeUndefined();
			const after = vault.getByPath('note.md');
			expect(after?.content).toBe('v2');
			// Still pending for the other adapter so v2 propagates onward
			expect(after?.pendingAdapters).toContain('test-fs');
		});

		it('should create conflict copy when remote diverged from base, once per remote version', async () => {
			const ws = createMockWorkspace({
				activeSyncAdapters: ['test-fs', 'remote-1'],
			});
			const { vault } = setupVaultStore(ws);
			await vault.init();

			await vault.createFile('note.md', 'v1');
			await vault.applyExternalFile('note.md', 'v1', 'remote-1');
			const entry = vault.getByPath('note.md');
			await vault.updateFile(entry!.id, 'v2');

			// Remote diverged to v3 → real conflict
			await vault.applyExternalFile('note.md', 'v3', 'remote-1');
			const conflict = vault.getByPath('note.conflict-remote-1.md');
			expect(conflict?.content).toBe('v3');
			expect(vault.getByPath('note.md')?.content).toBe('v2');

			// Same remote content pulled again (e.g. next poll) → no second copy
			await vault.applyExternalFile('note.md', 'v3', 'remote-1');
			expect(
				vault.getByPath('note.conflict-remote-1 (2).md'),
			).toBeUndefined();
		});

		it('should not nest conflict suffixes when a conflict copy itself conflicts', async () => {
			const ws = createMockWorkspace({
				activeSyncAdapters: ['test-fs', 'remote-1'],
			});
			const { vault } = setupVaultStore(ws);
			await vault.init();

			// A conflict copy with local pending changes and unknown base
			await vault.createFile('fizjo.conflict-remote-1.md', 'local');
			await vault.applyExternalFile(
				'fizjo.conflict-remote-1.md',
				'remote',
				'remote-1',
			);

			expect(
				vault.getByPath('fizjo.conflict-remote-1.conflict-remote-1.md'),
			).toBeUndefined();
			// Reduced to the original stem, deduped against the existing copy
			const deduped = vault.getByPath('fizjo.conflict-remote-1 (2).md');
			expect(deduped?.content).toBe('remote');
		});

		it('should dedupe conflict paths instead of duplicating them', async () => {
			const ws = createMockWorkspace({
				activeSyncAdapters: ['test-fs', 'remote-1'],
			});
			const { vault } = setupVaultStore(ws);
			await vault.init();

			await vault.createFile('note.md', 'local');
			await vault.createFile('note.conflict-remote-1.md', 'occupied');

			await vault.applyExternalFile('note.md', 'remote', 'remote-1');

			// Existing copy untouched; new copy got a unique deduped path
			expect(vault.getByPath('note.conflict-remote-1.md')?.content).toBe(
				'occupied',
			);
			expect(
				vault.getByPath('note.conflict-remote-1 (2).md')?.content,
			).toBe('remote');
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
