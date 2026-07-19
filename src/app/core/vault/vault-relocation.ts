import { VAULT_ENTRY_TYPES, type VaultEntry } from './vault-entry';
import { resolveUniquePath } from './vault-utils';
import type { VaultStore } from './store';

/**
 * Rename/move logic for vault entries, extracted from VaultStore (same
 * pattern as VaultReconciler / VaultLifecycle: a plain class instantiated by
 * the store, driving it only through its public API).
 *
 * A rename/move sets one `pendingRenameFrom` on the top entry — the sync
 * push phase then calls `adapter.rename()`, which moves the whole subtree on
 * disk. Children of a moved folder get local-only path updates.
 */
export class VaultRelocation {
	constructor(private readonly store: VaultStore) {}

	/** Rename an entry in place (last path segment only). */
	async renameEntry(id: string, newName: string): Promise<void> {
		const entry = this.store.getById(id);
		if (!entry || entry.name === newName) return;

		// Rebuild path: replace last segment (the name)
		const parent = entry.path.split('/').slice(0, -1).join('/');
		const newPath = parent ? `${parent}/${newName}` : newName;

		await this.#relocate(entry, newPath);
	}

	/**
	 * Move an entry to an arbitrary new path (a rename that may change the
	 * parent, e.g. archiving into `.archive/...`).
	 */
	async moveEntry(id: string, newPath: string): Promise<void> {
		const entry = this.store.getById(id);
		if (!entry || entry.path === newPath) return;

		await this.#relocate(entry, newPath);
	}

	/**
	 * Ensure folder entries exist for every segment of `folderPath`
	 * (e.g. ".archive/projects"). Creates the missing ones so the tree can
	 * render and the push phase mkdirs them on adapters. No-op for ''.
	 */
	async ensureFolderPath(folderPath: string): Promise<void> {
		if (!folderPath) return;
		let current = '';
		for (const segment of folderPath.split('/')) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.store.getByPath(current)) {
				await this.store.createFolder(current);
			}
		}
	}

	/** Shared rename/move implementation. */
	async #relocate(entry: VaultEntry, newPath: string): Promise<void> {
		const oldPath = entry.path;

		const wsId = this.store.activeWorkspaceId();
		if (!wsId) return;

		const activeAdapters = this.store.getActiveSyncAdapters();
		const pendingAdapters = [
			...new Set([...entry.pendingAdapters, ...activeAdapters]),
		];

		// Resolve name conflicts — if the new path already exists, auto-dedup
		const resolvedPath = resolveUniquePath(newPath, (p) =>
			this.store.getByPath(p),
		);
		const resolvedName = resolvedPath.split('/').pop() ?? entry.name;
		const newParentPath = resolvedPath.split('/').slice(0, -1).join('/');
		const parentId = newParentPath
			? (this.store.getByPath(newParentPath)?.id ?? null)
			: null;

		const updated: VaultEntry = {
			...entry,
			name: resolvedName,
			path: resolvedPath,
			parentId,
			updatedAt: Date.now(),
			revision: entry.revision + 1,
			pendingAdapters,
			pendingRenameFrom: oldPath,
		};

		await this.store.put(updated);

		// Cascade to children if this is a folder
		if (entry.type === VAULT_ENTRY_TYPES.FOLDER) {
			await this.cascadeRenameChildren(
				entry,
				oldPath,
				resolvedPath,
				activeAdapters,
			);
		}
	}

	/** Update all children of a renamed/moved folder with new paths. */
	async cascadeRenameChildren(
		entry: VaultEntry,
		oldPath: string,
		newPath: string,
		activeAdapters: string[],
	): Promise<void> {
		const children = Array.from(
			this.store.getEntriesSnapshot().values(),
		).filter(
			(e) =>
				e.workspaceId === entry.workspaceId &&
				!e.deleted &&
				e.path.startsWith(oldPath + '/'),
		);

		const now = Date.now();
		const updates = children.map((child) => {
			const childNewPath = newPath + child.path.slice(oldPath.length);
			const childNewName = childNewPath.split('/').pop() ?? child.name;
			return {
				...child,
				name: childNewName,
				path: childNewPath,
				updatedAt: now,
				revision: child.revision + 1,
				pendingAdapters: [
					...new Set([...child.pendingAdapters, ...activeAdapters]),
				],
			};
		});

		await this.store.putMany(updates);
	}
}
