/**
 * Metadata that can be embedded in a note's YAML frontmatter.
 *
 * Only `icon`, `tags`, and `createdAt` are stored in frontmatter.
 * `updatedAt` is intentionally excluded — VaultEntry timestamps
 * are the single source of truth.
 */
export interface NoteMetadata {
	createdAt?: number;
	icon?: string;
	tags?: string[];
}

/** Default icon shown when a note has no frontmatter icon. */
export const DEFAULT_NOTE_ICON = '📄';
