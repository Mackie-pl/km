import { Injectable, computed, inject } from '@angular/core';
import { ARCHIVE_FOLDER } from '@core/utils/file-patterns';
import { VAULT_ENTRY_TYPES, VaultStore, type VaultEntry } from './store';

/** An archived entry plus its pre-archive path for display/restore. */
export interface ArchivedItem {
	entry: VaultEntry;
	/** Original vault path (archived path minus the `.archive/` prefix). */
	displayPath: string;
}

/**
 * Archive = move into the `.archive/` folder at the vault root, preserving
 * the entry's original relative path so restore is a prefix-strip. Archived
 * files are real synced content (visible on every device); they're only
 * hidden from the tree/search/tag UI via `VaultStore.visibleFiles()`.
 */
@Injectable({ providedIn: 'root' })
export class ArchiveService {
	private readonly vault = inject(VaultStore);

	/**
	 * Archived files for the Archived tab, each restorable individually.
	 * Folders under `.archive/` are scaffolding that preserves original
	 * locations — restoring a folder row could collide with a still-existing
	 * original folder, so files are the restore unit.
	 */
	readonly archivedItems = computed<ArchivedItem[]>(() =>
		this.vault
			.archivedEntries()
			.filter((e) => e.type === VAULT_ENTRY_TYPES.FILE)
			.map((entry) => ({
				entry,
				displayPath: stripArchivePrefix(entry.path),
			}))
			.sort((a, b) => a.displayPath.localeCompare(b.displayPath)),
	);

	/** Move an entry (and, for folders, its subtree) into `.archive/`. */
	async archive(id: string): Promise<void> {
		const entry = this.vault.getById(id);
		if (!entry || entry.deleted) return;

		const target = `${ARCHIVE_FOLDER}/${entry.path}`;
		const targetParent = target.split('/').slice(0, -1).join('/');
		await this.vault.ensureFolderPath(targetParent);
		await this.vault.moveEntry(id, target);
	}

	/** Move an archived entry back to its original location. */
	async restore(id: string): Promise<void> {
		const entry = this.vault.getById(id);
		if (!entry || entry.deleted) return;

		const target = stripArchivePrefix(entry.path);
		const targetParent = target.split('/').slice(0, -1).join('/');
		await this.vault.ensureFolderPath(targetParent);
		await this.vault.moveEntry(id, target);
	}
}

function stripArchivePrefix(path: string): string {
	return path.startsWith(ARCHIVE_FOLDER + '/')
		? path.slice(ARCHIVE_FOLDER.length + 1)
		: path;
}
