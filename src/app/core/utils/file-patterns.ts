/**
 * Temp/swap file patterns — files that should never be treated as note entries.
 *
 * These are created by external editors (VS Code, Cursor, Vim, etc.) during
 * atomic saves and should be filtered out of:
 *   - filesystem watch events (tauri-fs.adapter.ts)
 *   - directory walks (walk-directory.ts)
 *   - external file reconciliation (vault-reconciler.ts)
 *   - push phase (sync-push-phase.ts)
 */

const TEMP_EXTENSIONS = [
	'.crswap',
	'.swp',
	'.swpx',
	'.tmp',
	'.bak',
] as const;

const TEMP_SUFFIXES = ['~'] as const;

/**
 * Check whether a file name or path matches known temp/swap file patterns.
 *
 * @param name - A file name (e.g. "notes.md.crswap") or full path.
 * @returns true if the file looks like a temp/swap file that should be ignored.
 */
export function isTempFilePath(name: string): boolean {
	const lower = name.toLowerCase();
	for (const ext of TEMP_EXTENSIONS) {
		if (lower.endsWith(ext)) return true;
	}
	for (const suffix of TEMP_SUFFIXES) {
		if (lower.endsWith(suffix)) return true;
	}
	return false;
}


