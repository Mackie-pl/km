import type { NoteMetadata } from '@core/types/note-metadata';

/**
 * Regex matching a YAML frontmatter block at the very start of a file.
 * Captures everything between the opening `---` and closing `---` fences.
 * Tolerant of CRLF (`\r\n`) line endings, which are common on Windows / Git.
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/** A top-level `key: value` line (keys may contain letters, digits, -, _). */
const KEY_RE = /^([A-Za-z0-9_-]+):\s*(.*)$/;

/** Keys this app owns and re-emits itself (everything else is preserved). */
const MANAGED_KEYS = new Set(['createdAt', 'icon', 'tags']);
/** Recognised but intentionally dropped — VaultEntry timestamps win. */
const DROPPED_KEYS = new Set(['updatedAt']);

/**
 * Parse a note's content, extracting YAML frontmatter (if present).
 *
 * `icon`, `tags`, and `createdAt` are surfaced as structured `metadata`.
 * `updatedAt` is dropped. Every OTHER top-level key is captured verbatim in
 * `preserved` (its raw lines, including block continuations) so a round-trip
 * through {@link serializeFrontmatter} keeps frontmatter written by other tools
 * (Obsidian aliases, custom fields, etc.) intact.
 *
 * @param content - Raw note content (may include frontmatter)
 * @returns Extracted metadata, the preserved unknown-key lines, and the body.
 */
export function parseFrontmatter(content: string): {
	metadata: NoteMetadata;
	body: string;
	preserved: string[];
} {
	const match = FRONTMATTER_RE.exec(content);
	if (!match) {
		return { metadata: {}, body: content, preserved: [] };
	}

	const yamlBlock = match[1];
	const body = content.slice(match[0].length);

	if (yamlBlock === undefined) {
		return { metadata: {}, body, preserved: [] };
	}

	const lines = yamlBlock.split(/\r?\n/);
	const { metadata, preserved } = parseYamlLines(lines);

	return { metadata, body, preserved };
}

/**
 * Parse frontmatter lines into recognised metadata + verbatim-preserved lines
 * for unknown keys.
 */
function parseYamlLines(lines: string[]): {
	metadata: NoteMetadata;
	preserved: string[];
} {
	const metadata: NoteMetadata = {};
	const preserved: string[] = [];
	const currentTags: string[] = [];
	let currentKey: string | null = null;
	let preservingUnknown = false;

	for (const line of lines) {
		const keyExec = KEY_RE.exec(line);
		if (keyExec) {
			flushTags(metadata, currentKey, currentTags);
			currentKey = keyExec[1] ?? null;
			preservingUnknown = applyTopLevelKey(metadata, keyExec, preserved);
			continue;
		}

		// Continuation line (indented value, block-list item, blank, comment).
		if (currentKey === 'tags') {
			collectTagItem(line, currentKey, currentTags);
		} else if (preservingUnknown) {
			preserved.push(line);
		}
	}

	flushTags(metadata, currentKey, currentTags);
	return { metadata, preserved };
}

/**
 * Handle a top-level `key:` line. Managed keys feed `metadata`; dropped keys are
 * discarded; anything else is pushed verbatim to `preserved`.
 *
 * @returns whether subsequent continuation lines should be preserved (i.e. the
 *          key is an unknown one whose block must be kept).
 */
function applyTopLevelKey(
	metadata: NoteMetadata,
	keyExec: RegExpExecArray,
	preserved: string[],
): boolean {
	const key = keyExec[1];
	const rawValue = keyExec[2];
	if (key === undefined || rawValue === undefined) return false;

	if (DROPPED_KEYS.has(key)) return false;

	if (MANAGED_KEYS.has(key)) {
		const value = rawValue.trim();
		if (value !== '') applyKeyValue(metadata, key, value);
		return false;
	}

	// Unknown key — preserve its line verbatim, and keep its continuation lines.
	preserved.push(keyExec.input);
	return true;
}

/** Collect a block-array `  - item` line into the pending tags accumulator. */
function collectTagItem(
	line: string,
	currentKey: string | null,
	currentTags: string[],
): void {
	const itemExec = /^\s+-\s+(.+)$/.exec(line);
	if (!itemExec || currentKey !== 'tags') return;
	const matched = itemExec[1];
	if (matched === undefined) return;
	const tag = stripQuotes(matched.trim());
	if (tag) currentTags.push(tag);
}

/**
 * Flush accumulated block-style tags into metadata when switching keys.
 */
function flushTags(
	metadata: NoteMetadata,
	key: string | null,
	tags: string[],
): void {
	if (key === 'tags' && tags.length > 0) {
		metadata.tags = [...tags];
		tags.length = 0;
	}
}

/**
 * Apply a single managed key-value pair to NoteMetadata.
 * Supports `icon` (string), `tags` (inline `[a, b]` or single value),
 * and `createdAt` (number).
 */
function applyKeyValue(
	metadata: NoteMetadata,
	key: string,
	value: string,
): void {
	switch (key) {
		case 'createdAt': {
			const num = Number(value);
			if (!Number.isNaN(num)) {
				metadata.createdAt = num;
			}
			break;
		}
		case 'icon': {
			const icon = stripQuotes(value);
			if (icon) metadata.icon = icon;
			break;
		}
		case 'tags':
			metadata.tags = parseTagValue(value);
			break;
	}
}

/**
 * Parse a tags YAML value — either inline array `[tag1, tag2]` or single tag.
 */
function parseTagValue(value: string): string[] {
	if (value.startsWith('[') && value.endsWith(']')) {
		const inner = value.slice(1, -1);
		return inner
			.split(',')
			.map((t) => stripQuotes(t.trim()))
			.filter((t): t is string => t.length > 0);
	}
	const tag = stripQuotes(value);
	return tag ? [tag] : [];
}

/**
 * Serialise metadata + body back into a full content string.
 *
 * Managed keys (`createdAt` when present, then non-empty `icon`/`tags`) are
 * written first, followed by any `preserved` unknown-key lines captured by
 * {@link parseFrontmatter}. If there is nothing to write, the body is returned
 * unchanged.
 *
 * @param metadata - The managed metadata to embed
 * @param body - The markdown body (without frontmatter)
 * @param preserved - Verbatim unknown-key lines to keep (from parseFrontmatter)
 * @returns Full content with frontmatter prepended (if any)
 */
export function serializeFrontmatter(
	metadata: NoteMetadata,
	body: string,
	preserved: string[] = [],
): string {
	const lines = buildFrontmatterLines(metadata, preserved);
	if (lines.length === 0) return body;
	return lines.join('\n') + '\n' + body;
}

/**
 * Build the frontmatter YAML lines (including `---` fences).
 * Returns empty array if there are no managed keys and nothing preserved.
 */
function buildFrontmatterLines(
	metadata: NoteMetadata,
	preserved: string[],
): string[] {
	const lines: string[] = [];
	appendCreatedAt(lines, metadata);
	appendIcon(lines, metadata);
	appendTags(lines, metadata);
	lines.push(...preserved);

	if (lines.length === 0) return lines;
	return ['---', ...lines, '---'];
}

/** Append the `createdAt` line when present. */
function appendCreatedAt(lines: string[], metadata: NoteMetadata): void {
	if (metadata.createdAt !== undefined) {
		lines.push(`createdAt: ${String(metadata.createdAt)}`);
	}
}

/** Append the `icon` line when non-empty. */
function appendIcon(lines: string[], metadata: NoteMetadata): void {
	if (metadata.icon) {
		lines.push(`icon: "${metadata.icon}"`);
	}
}

/** Append the inline `tags` array line when non-empty. */
function appendTags(lines: string[], metadata: NoteMetadata): void {
	if (metadata.tags && metadata.tags.length > 0) {
		const tagList = metadata.tags.map((t) => `"${t}"`).join(', ');
		lines.push(`tags: [${tagList}]`);
	}
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Strip surrounding single or double quotes from a string. */
function stripQuotes(s: string): string {
	return s.replace(/^['"](.*)['"]$/, '$1');
}
