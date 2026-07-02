import { parseFrontmatter } from '@core/utils/frontmatter-parser';
import type { NoteMetadata } from '@core/types/note-metadata';

/**
 * Memoized frontmatter parser for vault files.
 *
 * Reuses the cached parse result while a file's content is unchanged, so the
 * `allFrontmatters` / `allTags` computeds don't reparse every file on each
 * recompute. A plain helper owned by VaultStore (mirrors the VaultReconciler /
 * VaultDatabase collaborator pattern) — not an Angular service.
 */
export class VaultFrontmatterIndex {
	readonly #cache = new Map<
		string,
		{ content: string; metadata: NoteMetadata }
	>();

	/** Parse a file's frontmatter, reusing the cached result when content is unchanged. */
	parse(id: string, content: string): NoteMetadata {
		const cached = this.#cache.get(id);
		// Explicit undefined check (not optional chaining) so TS narrows `cached`
		// for the `cached.metadata` access below.
		// eslint-disable-next-line @typescript-eslint/prefer-optional-chain
		if (cached !== undefined && cached.content === content) {
			return cached.metadata;
		}
		const { metadata } = parseFrontmatter(content);
		this.#cache.set(id, { content, metadata });
		return metadata;
	}

	/** Collect unique, lowercased tags across the given metadata list, sorted. */
	collectTags(all: NoteMetadata[]): string[] {
		const set = new Set<string>();
		for (const fm of all) {
			for (const tag of fm.tags ?? []) {
				set.add(tag.toLowerCase());
			}
		}
		return [...set].sort();
	}

	/** Drop all cached parses (workspace switch / reset). */
	clear(): void {
		this.#cache.clear();
	}
}
