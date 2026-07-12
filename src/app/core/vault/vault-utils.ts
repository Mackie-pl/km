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
 * Fast 53-bit content hash (cyrb53) — synchronous, stable across sessions.
 * Used for `VaultEntry.syncedHashes` base-version comparisons, not security.
 */
export function hashContent(content: string, seed = 0): string {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < content.length; i++) {
		const ch = content.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (
		(h2 >>> 0).toString(36) + (h1 >>> 0).toString(36)
	);
}

/**
 * Matches `<stem>.conflict-<adapterId>[ (n)]<ext?>` conflict-copy file names,
 * including the " (2)" dedup suffix appended by resolveUniquePath.
 */
const CONFLICT_NAME_RE =
	/^(?<stem>.+)\.conflict-(?<adapter>[^.]+?)(?: \(\d+\))?(?<ext>\.[^.]+)?$/;

/**
 * Parse a conflict-copy file name. Returns the original name and the source
 * adapter id, or null if the name is not a conflict copy.
 *
 *   "fizjo.conflict-gdrive.md"     → { originalName: "fizjo.md", adapterId: "gdrive" }
 *   "fizjo.conflict-gdrive (2).md" → { originalName: "fizjo.md", adapterId: "gdrive" }
 */
export function parseConflictName(
	name: string,
): { originalName: string; adapterId: string } | null {
	const m = CONFLICT_NAME_RE.exec(name);
	if (!m?.groups) return null;
	return {
		originalName: `${m.groups['stem'] ?? ''}${m.groups['ext'] ?? ''}`,
		adapterId: m.groups['adapter'] ?? '',
	};
}

/**
 * Build a conflict-copy name for `name` and `adapterId`.
 * Never nests: a name that is already a conflict copy is reduced to its
 * original first, so a conflicted "fizjo.conflict-gdrive.md" yields
 * "fizjo.conflict-gdrive.md" again (the caller dedupes via resolveUniquePath),
 * not "fizjo.conflict-gdrive.conflict-gdrive.md".
 */
export function makeConflictName(name: string, adapterId: string): string {
	let base = name;
	for (
		let parsed = parseConflictName(base);
		parsed;
		parsed = parseConflictName(base)
	) {
		base = parsed.originalName;
	}
	const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
	const stem = ext ? base.slice(0, base.lastIndexOf('.')) : base;
	return `${stem}.conflict-${adapterId}${ext}`;
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
