import {
	VAULT_ENTRY_TYPES,
	type VaultEntryType,
	type VaultEntry,
} from './vault-entry';

/**
 * Given an intended path, return the first non-conflicting variant
 * by appending " (2)", " (3)", etc. if the path already exists.
 *
 * Examples:
 *   "New Folder"       → "New Folder"          (if free)
 *   "New Folder"       → "New Folder (2)"      (if "New Folder" exists)
 *   "note.md"          → "note (2).md"         (if "note.md" exists)
 *   "note.md"          → "note (3).md"         (if both "note.md" and "note (2).md" exist)
 */
export function resolveUniquePath(
	path: string,
	lookup: (candidate: string) => VaultEntry | undefined,
): string {
	let candidate = path;
	let counter = 2;
	while (lookup(candidate)) {
		const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')) : '';
		const stem = ext ? path.slice(0, path.lastIndexOf('.')) : path;
		candidate = `${stem} (${String(counter)})${ext}`;
		counter++;
	}
	return candidate;
}

/**
 * Create a VaultEntry with sensible defaults.
 * Replaces the old `makeEntry()` instance method to reduce boilerplate and jscpd clones.
 */
export function makeVaultEntry(overrides: {
	workspaceId: string;
	name: string;
	path: string;
	type?: VaultEntryType;
	content?: string;
	pendingAdapters: string[];
	parentId?: string | null;
}): VaultEntry {
	return {
		id: crypto.randomUUID(),
		parentId: overrides.parentId ?? null,
		type: overrides.type ?? VAULT_ENTRY_TYPES.FILE,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		deleted: false,
		revision: 1,
		workspaceId: overrides.workspaceId,
		name: overrides.name,
		path: overrides.path,
		pendingAdapters: overrides.pendingAdapters,
		...(overrides.content !== undefined
			? { content: overrides.content }
			: {}),
	};
}
