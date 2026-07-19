import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
	createMockWorkspace,
	setupVaultStore,
} from '@core/__tests__/test-setup';
import { ArchiveService } from '@vault/archive.service';
import { TrashService } from '@vault/trash.service';
import type { VaultStore, VaultEntry } from '@vault/store';
import { SyncPushPhase } from '@core/sync/sync-push-phase';
import type { Adapter } from '@core/adapters/adapter.interface';
import { makeVaultEntry } from '@vault/vault-utils';

describe('Archive + Trash', () => {
	beforeEach(() => {
		TestBed.resetTestingModule();
	});

	// ── moveEntry ──────────────────────────────────────────────────────────

	describe('VaultStore.moveEntry', () => {
		it('moves a file to a new parent, setting pendingRenameFrom', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFolder('.archive');
			await vault.createFile('note.md', '# Hi');
			const entry = vault.getByPath('note.md');
			expect(entry).toBeDefined();
			if (!entry) return;

			await vault.moveEntry(entry.id, '.archive/note.md');

			const moved = vault.getById(entry.id);
			expect(moved?.path).toBe('.archive/note.md');
			expect(moved?.pendingRenameFrom).toBe('note.md');
			expect(moved?.parentId).toBe(vault.getByPath('.archive')?.id);
			expect(vault.getByPath('note.md')).toBeUndefined();
		});

		it('cascades child paths when moving a folder', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFolder('projects');
			await vault.createFile('projects/a.md', 'A');
			await vault.createFolder('.archive');
			const folder = vault.getByPath('projects');
			if (!folder) return;

			await vault.moveEntry(folder.id, '.archive/projects');

			expect(vault.getByPath('.archive/projects')).toBeDefined();
			const child = vault.getByPath('.archive/projects/a.md');
			expect(child).toBeDefined();
			// Only the moved root carries the rename marker
			expect(vault.getById(folder.id)?.pendingRenameFrom).toBe(
				'projects',
			);
			expect(child?.pendingRenameFrom).toBeUndefined();
		});

		it('auto-dedups when the target path is occupied', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();

			await vault.createFolder('.archive');
			await vault.createFile('.archive/note.md', 'old');
			await vault.createFile('note.md', 'new');
			const entry = vault.getByPath('note.md');
			if (!entry) return;

			await vault.moveEntry(entry.id, '.archive/note.md');

			expect(vault.getById(entry.id)?.path).toBe('.archive/note (2).md');
		});
	});

	// ── Archive service ────────────────────────────────────────────────────

	describe('ArchiveService', () => {
		it('archives preserving the relative path and hides it from visible views', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();
			const archive = TestBed.inject(ArchiveService);

			await vault.createFolder('projects');
			await vault.createFile('projects/plan.md', 'plan');
			const entry = vault.getByPath('projects/plan.md');
			if (!entry) return;

			await archive.archive(entry.id);

			expect(vault.getById(entry.id)?.path).toBe(
				'.archive/projects/plan.md',
			);
			// ensureFolderPath created the ancestors
			expect(vault.getByPath('.archive')?.type).toBe('folder');
			expect(vault.getByPath('.archive/projects')?.type).toBe('folder');
			// hidden from visible views, present in archived views
			expect(
				vault.visibleFiles().some((f) => f.id === entry.id),
			).toBe(false);
			expect(
				archive.archivedItems().some((i) => i.entry.id === entry.id),
			).toBe(true);
			// still resolvable by path (editor deep links)
			expect(vault.getByPath('.archive/projects/plan.md')).toBeDefined();
		});

		it('restores to the original location', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();
			const archive = TestBed.inject(ArchiveService);

			await vault.createFolder('projects');
			await vault.createFile('projects/plan.md', 'plan');
			const entry = vault.getByPath('projects/plan.md');
			if (!entry) return;

			await archive.archive(entry.id);
			await archive.restore(entry.id);

			expect(vault.getById(entry.id)?.path).toBe('projects/plan.md');
			expect(
				vault.visibleFiles().some((f) => f.id === entry.id),
			).toBe(true);
		});

		it('lists a folder archive as its files, with display paths', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();
			const archive = TestBed.inject(ArchiveService);

			await vault.createFolder('projects');
			await vault.createFile('projects/a.md', 'A');
			const folder = vault.getByPath('projects');
			if (!folder) return;

			await archive.archive(folder.id);

			const items = archive.archivedItems();
			expect(items.length).toBe(1);
			expect(items[0]?.entry.name).toBe('a.md');
			expect(items[0]?.displayPath).toBe('projects/a.md');
		});

		it('restores a file whose original folder still exists, without collision', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();
			const archive = TestBed.inject(ArchiveService);

			await vault.createFolder('projects');
			await vault.createFile('projects/plan.md', 'plan');
			const entry = vault.getByPath('projects/plan.md');
			if (!entry) return;

			await archive.archive(entry.id);
			await archive.restore(entry.id);

			expect(vault.getById(entry.id)?.path).toBe('projects/plan.md');
			// The original folder was reused, not duplicated
			expect(vault.getByPath('projects (2)')).toBeUndefined();
		});
	});

	// ── Trash service ──────────────────────────────────────────────────────

	describe('TrashService', () => {
		it('snapshots a folder delete as one batch and deletes the entries', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();
			const trash = TestBed.inject(TrashService);

			await vault.createFolder('projects');
			await vault.createFile('projects/a.md', 'A');
			const folder = vault.getByPath('projects');
			if (!folder) return;

			await trash.deleteToTrash(folder.id);

			expect(vault.getByPath('projects')).toBeUndefined();
			expect(vault.getByPath('projects/a.md')).toBeUndefined();
			const batches = trash.batches();
			expect(batches.length).toBe(1);
			expect(batches[0]?.count).toBe(2);
			expect(batches[0]?.root.originalPath).toBe('projects');
			expect(batches[0]?.daysRemaining).toBe(30);
		});

		it('restores a batch with content and pending adapters', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();
			const trash = TestBed.inject(TrashService);

			await vault.createFolder('projects');
			await vault.createFile('projects/a.md', 'A-content');
			const folder = vault.getByPath('projects');
			if (!folder) return;

			await trash.deleteToTrash(folder.id);
			const batchId = trash.batches()[0]?.batchId;
			expect(batchId).toBeDefined();
			if (!batchId) return;

			await trash.restore(batchId);

			const restored = vault.getByPath('projects/a.md');
			expect(restored?.content).toBe('A-content');
			expect(restored?.pendingAdapters).toContain('test-fs');
			expect(vault.getByPath('projects')?.type).toBe('folder');
			expect(trash.batches().length).toBe(0);
		});

		it('purges only records older than the retention window', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();
			const trash = TestBed.inject(TrashService);

			await vault.createFile('old.md', 'old');
			await vault.createFile('new.md', 'new');
			const oldEntry = vault.getByPath('old.md');
			const newEntry = vault.getByPath('new.md');
			if (!oldEntry || !newEntry) return;

			// Trash "old.md" 31 days ago, "new.md" now
			const now = Date.now();
			vi.spyOn(Date, 'now').mockReturnValue(
				now - 31 * 24 * 60 * 60 * 1000,
			);
			await trash.deleteToTrash(oldEntry.id);
			vi.spyOn(Date, 'now').mockReturnValue(now);
			await trash.deleteToTrash(newEntry.id);

			await trash.load();

			const names = trash.records().map((r) => r.name);
			expect(names).toEqual(['new.md']);
			vi.restoreAllMocks();
		});

		it('deleteForever and emptyTrash drop records permanently', async () => {
			const { vault } = setupVaultStore(createMockWorkspace());
			await vault.init();
			const trash = TestBed.inject(TrashService);

			await vault.createFile('a.md', 'a');
			await vault.createFile('b.md', 'b');
			const a = vault.getByPath('a.md');
			const b = vault.getByPath('b.md');
			if (!a || !b) return;

			await trash.deleteToTrash(a.id);
			await trash.deleteToTrash(b.id);
			expect(trash.batches().length).toBe(2);

			const first = trash.batches()[0]?.batchId;
			if (!first) return;
			await trash.deleteForever(first);
			expect(trash.batches().length).toBe(1);

			await trash.emptyTrash();
			expect(trash.batches().length).toBe(0);
		});
	});

	// ── Push-phase ordering ────────────────────────────────────────────────

	describe('SyncPushPhase ordering', () => {
		it('pushes folder creation before a rename into that folder', async () => {
			const ops: string[] = [];
			const adapter = {
				id: 'rec',
				isLocal: true,
				isAvailable: () => true,
				pickWorkspaceFolder: () => Promise.resolve(null),
				read: () => Promise.resolve(''),
				write: (path: string) => {
					ops.push(`write:${path}`);
					return Promise.resolve();
				},
				delete: (path: string) => {
					ops.push(`delete:${path}`);
					return Promise.resolve();
				},
				rename: (from: string, to: string) => {
					ops.push(`rename:${from}→${to}`);
					return Promise.resolve();
				},
				list: () => Promise.resolve([]),
				createDir: (path: string) => {
					ops.push(`mkdir:${path}`);
					return Promise.resolve();
				},
			} as unknown as Adapter;

			const base = {
				workspaceId: 'ws',
				pendingAdapters: ['rec'],
			};
			// Deliberately listed file-first — the sort must fix the order.
			const entries: VaultEntry[] = [
				makeVaultEntry({
					...base,
					name: 'note.md',
					path: '.archive/note.md',
				}),
				makeVaultEntry({
					...base,
					name: '.archive',
					path: '.archive',
					type: 'folder',
				}),
				{
					...makeVaultEntry({
						...base,
						name: 'gone.md',
						path: 'gone.md',
					}),
					deleted: true,
				},
			];
			entries[0] = { ...entries[0], pendingRenameFrom: 'note.md' };

			const fakeVault = {
				entriesNeedingSync: () => entries,
				markAdapterSynced: () => Promise.resolve(),
				clearPendingRename: () => Promise.resolve(),
			} as unknown as VaultStore;

			await new SyncPushPhase(fakeVault).execute([{ adapter }]);

			expect(ops).toEqual([
				'mkdir:.archive',
				'rename:note.md→.archive/note.md',
				'delete:gone.md',
			]);
		});
	});
});
