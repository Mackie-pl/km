/**
 * Non-note file patterns — files that should never be treated as note entries.
 *
 * Two kinds:
 *   1. Temp/swap files from external editors (VS Code, Cursor, Vim, etc.).
 *   2. VCS placeholder files — git's `.gitkeep` empty-folder marker.
 *
 * Both are filtered out of:
 *   - filesystem watch events (tauri-fs.adapter.ts)
 *   - directory walks (walk-directory.ts)
 *   - external file reconciliation (vault-reconciler.ts)
 *   - push phase (sync-push-phase.ts)
 *
 * `.gitkeep` deserves special mention: the Git adapter creates it on its own
 * remote (inside `createDir`) because git can't track empty folders. It must
 * NOT become a vault entry — otherwise it fans out to adapters that have real
 * folders and don't need it (e.g. Google Drive), and a folder-aware adapter
 * under-reporting it would trip orphan detection into deleting it everywhere.
 */

const TEMP_EXTENSIONS = [
	'.crswap',
	'.swp',
	'.swpx',
	'.tmp',
	'.bak',
] as const;

const TEMP_SUFFIXES = ['~'] as const;

/** Exact file names (any directory) that are placeholders, never notes. */
const IGNORED_FILENAMES = ['.gitkeep'] as const;

/**
 * Check whether a file name or path matches a known non-note pattern (temp/swap
 * file or VCS placeholder) and should be ignored.
 *
 * @param name - A file name (e.g. "notes.md.crswap") or full path
 *               (e.g. "docs/.gitkeep").
 * @returns true if the file should never be treated as a note entry.
 */
export function isTempFilePath(name: string): boolean {
	const lower = name.toLowerCase();
	const base = lower.slice(lower.lastIndexOf('/') + 1);
	if ((IGNORED_FILENAMES as readonly string[]).includes(base)) return true;
	for (const ext of TEMP_EXTENSIONS) {
		if (lower.endsWith(ext)) return true;
	}
	for (const suffix of TEMP_SUFFIXES) {
		if (lower.endsWith(suffix)) return true;
	}
	return false;
}

/**
 * Vault-root folder holding archived notes. Archived entries are real files
 * that sync normally across adapters (NOT part of `isTempFilePath` ignores) —
 * they are only hidden from the UI layer (tree, search, tag bar).
 */
export const ARCHIVE_FOLDER = '.archive';

/** True if `path` is the archive folder itself or lives inside it. */
export function isArchivedPath(path: string): boolean {
	return path === ARCHIVE_FOLDER || path.startsWith(ARCHIVE_FOLDER + '/');
}


