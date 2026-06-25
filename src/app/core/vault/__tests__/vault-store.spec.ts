import { TestBed } from '@angular/core/testing';
import {
	createMockWorkspace,
	setupVaultStore,
} from '@core/__tests__/test-setup';
import { makeVaultEntry } from '@vault/vault-utils';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VaultStore', () => {
	beforeEach(() => {
		TestBed.resetTestingModule();
	});

	describe('workspace lifecycle', () => {
		it('should have null workspaceId when no workspace active', () => {
			const { vault } = setupVaultStore(null);
			expect(vault.activeWorkspaceId()).toBeNull();
		});

		it('should reflect active workspace ID', () => {
			const ws = createMockWorkspace({ id: 'ws-1' });
			const { vault } = setupVaultStore(ws);
			expect(vault.activeWorkspaceId()).toBe('ws-1');
		});
	});

	describe('createFile', () => {
		it('should create a file entry', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('note.md', '# Hello');
			await vault.createFile('todo.md', '- [ ] task');

			const files = vault.files();
			expect(files.length).toBe(2);
			expect(files[0]?.name).toBe('note.md');
			expect(files[1]?.name).toBe('todo.md');
		});

		it('should file be findable by path', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('readme.md', '# Readme');

			const entry = vault.getByPath('readme.md');
			expect(entry).toBeDefined();
			expect(entry?.content).toBe('# Readme');
		});

		it('should auto-dedup file name on collision', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('note.md', '# First');
			await vault.createFile('note.md', '# Second');

			const entry1 = vault.getByPath('note.md');
			const entry2 = vault.getByPath('note (2).md');

			expect(entry1).toBeDefined();
			expect(entry2).toBeDefined();
			expect(entry1?.content).toBe('# First');
			expect(entry2?.content).toBe('# Second');
		});

		it('should set pendingAdapters from active adapters', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('note.md', 'content');

			const entry = vault.getByPath('note.md');
			expect(entry?.pendingAdapters).toContain('test-fs');
		});

		it('should not create file without active workspace', async () => {
			const { vault } = setupVaultStore(null);
			await vault.init();

			await vault.createFile('note.md', 'content');
			expect(vault.files().length).toBe(0);
		});
	});

	describe('createFolder', () => {
		it('should create a folder entry', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFolder('Projects');

			const folders = vault.folders();
			expect(folders.length).toBe(1);
			expect(folders[0]?.name).toBe('Projects');
		});

		it('should auto-dedup folder name on collision', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFolder('New Folder');
			await vault.createFolder('New Folder');

			const folder1 = vault.getByPath('New Folder');
			const folder2 = vault.getByPath('New Folder (2)');
			expect(folder1).toBeDefined();
			expect(folder2).toBeDefined();
			expect(folder1?.type).toBe('folder');
			expect(folder2?.type).toBe('folder');
		});
	});

	describe('updateFile', () => {
		it('should update file content and increment revision', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('note.md', 'initial');
			const created = vault.getByPath('note.md');
			expect(created).toBeDefined();
			const createdId = created!.id;

			await vault.updateFile(createdId, 'updated content');
			const updated = vault.getByPath('note.md');

			expect(updated?.content).toBe('updated content');
			expect(updated?.revision).toBe(2);
		});

		it('should set pendingAdapters on update', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('note.md', 'initial');
			const created = vault.getByPath('note.md');
			const createdId = created!.id;

			// Mark as synced first
			await vault.markAdapterSynced(createdId, 'test-fs');
			expect(vault.getByPath('note.md')?.pendingAdapters.length).toBe(0);

			// Update should re-add pending adapters
			await vault.updateFile(createdId, 'updated');
			expect(vault.getByPath('note.md')?.pendingAdapters).toContain(
				'test-fs',
			);
		});

		it('should be no-op for non-existent entry', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.updateFile('non-existent-id', 'content');
			// Should not throw
			expect(vault.files().length).toBe(0);
		});
	});

	describe('delete', () => {
		it('should soft-delete a file', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('note.md', 'content');
			const entry = vault.getByPath('note.md');
			expect(entry).toBeDefined();

			await vault.delete(entry!.id);
			expect(vault.getByPath('note.md')).toBeUndefined();
			expect(vault.files().length).toBe(0);
		});

		it('should cascade delete to children when deleting a folder', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFolder('Projects');
			await vault.createFile('readme.md', 'root file');
			await vault.createFile(
				'overview.md',
				'project overview',
				'Projects',
			);

			// Verify children exist
			expect(vault.files().length).toBe(2);
			expect(vault.folders().length).toBe(1);

			// Delete the folder
			const projects = vault.getByPath('Projects');
			await vault.delete(projects!.id);

			// Child file gone
			expect(vault.getByPath('Projects/overview.md')).toBeUndefined();
			expect(vault.files().length).toBe(1); // Only root file remains
			expect(vault.folders().length).toBe(0);
		});
	});

	describe('renameEntry', () => {
		it('should rename a file', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('old-name.md', 'content');
			await vault.renameEntry(
				vault.getByPath('old-name.md')!.id,
				'new-name.md',
			);

			expect(vault.getByPath('old-name.md')).toBeUndefined();
			const renamed = vault.getByPath('new-name.md');
			expect(renamed).toBeDefined();
			expect(renamed?.name).toBe('new-name.md');
		});

		it('should set pendingRenameFrom on rename', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('old.md', 'content');
			await vault.renameEntry(vault.getByPath('old.md')!.id, 'new.md');

			const renamed = vault.getByPath('new.md');
			expect(renamed?.pendingRenameFrom).toBe('old.md');
		});

		it('should cascade rename folder children', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFolder('OldFolder');
			await vault.createFile('file.md', 'content', 'OldFolder');

			await vault.renameEntry(
				vault.getByPath('OldFolder')!.id,
				'NewFolder',
			);

			expect(vault.getByPath('OldFolder')).toBeUndefined();
			expect(vault.getByPath('NewFolder')).toBeDefined();
			expect(vault.getByPath('NewFolder/file.md')).toBeDefined();
		});

		it('should auto-dedup rename destination on collision', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('note.md', 'original');
			await vault.createFile('note (2).md', 'to be renamed');
			await vault.createFile('note (3).md', 'taken');

			// Rename note (2).md → note.md (collides with original)
			await vault.renameEntry(
				vault.getByPath('note (2).md')!.id,
				'note.md',
			);

			// Should get dedup'd to note (4).md (since 2 and 3 exist)
			expect(vault.getByPath('note (4).md')).toBeDefined();
		});
	});

	describe('entriesNeedingSync', () => {
		it('should return entries with pending adapters', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('a.md', 'aaa');
			await vault.createFile('b.md', 'bbb');

			expect(vault.entriesNeedingSync().length).toBe(2);

			// Mark one as synced
			const a = vault.getByPath('a.md');
			await vault.markAdapterSynced(a!.id, 'test-fs');

			expect(vault.entriesNeedingSync().length).toBe(1);
			expect(vault.entriesNeedingSync()[0]?.path).toBe('b.md');
		});
	});

	describe('markAdapterSynced', () => {
		it('should clear pendingRenameFrom when fully synced', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('old.md', 'content');
			await vault.renameEntry(vault.getByPath('old.md')!.id, 'new.md');

			const newEntry = vault.getByPath('new.md');
			expect(newEntry?.pendingRenameFrom).toBe('old.md');
			expect(newEntry?.pendingAdapters).toContain('test-fs');

			// Mark synced
			await vault.markAdapterSynced(newEntry!.id, 'test-fs');

			const synced = vault.getByPath('new.md');
			expect(synced?.pendingAdapters.length).toBe(0);
			expect(synced?.pendingRenameFrom).toBeUndefined();
		});
	});

	describe('path index + putMany', () => {
		it('frees a deleted path so it can be reused', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFile('note.md', 'first');
			const first = vault.getByPath('note.md')!;
			await vault.delete(first.id);
			expect(vault.getByPath('note.md')).toBeUndefined();

			await vault.createFile('note.md', 'second');
			const second = vault.getByPath('note.md');
			expect(second).toBeDefined();
			expect(second?.content).toBe('second');
			expect(second?.id).not.toBe(first.id);
		});

		it('keeps getByPath consistent after a folder rename cascade', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFolder('A');
			await vault.createFile('x.md', 'X', 'A');
			await vault.createFile('y.md', 'Y', 'A');

			await vault.renameEntry(vault.getByPath('A')!.id, 'B');

			expect(vault.getByPath('A/x.md')).toBeUndefined();
			expect(vault.getByPath('A/y.md')).toBeUndefined();
			expect(vault.getByPath('B/x.md')?.content).toBe('X');
			expect(vault.getByPath('B/y.md')?.content).toBe('Y');
		});

		it('putMany persists every entry and exposes them via getByPath', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();
			const wsId = vault.activeWorkspaceId()!;

			const mk = (name: string) =>
				makeVaultEntry({
					workspaceId: wsId,
					name,
					path: name,
					content: name,
					pendingAdapters: [],
				});

			await vault.putMany([mk('p1.md'), mk('p2.md'), mk('p3.md')]);

			expect(vault.files().length).toBe(3);
			expect(vault.getByPath('p1.md')?.content).toBe('p1.md');
			expect(vault.getByPath('p2.md')).toBeDefined();
			expect(vault.getByPath('p3.md')).toBeDefined();
		});
	});
});
