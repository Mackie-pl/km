import type { NoteMetadata } from '@core/types/note-metadata';

/**
 * Regex matching a YAML frontmatter block at the very start of a file.
 * Captures everything between the opening `---\n` and closing `\n---\n`.
 */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

/**
 * Parse a note's content, extracting YAML frontmatter (if present).
 *
 * Only `icon`, `tags`, and `createdAt` keys are recognised from the
 * YAML frontmatter. `updatedAt` is silently dropped — VaultEntry
 * timestamps are authoritative.
 *
 * @param content - Raw note content (may include frontmatter)
 * @returns Extracted metadata and the body (content without frontmatter)
 */
export function parseFrontmatter(content: string): {
	metadata: NoteMetadata;
	body: string;
} {
	const match = FRONTMATTER_RE.exec(content);
	if (!match) {
		return { metadata: {}, body: content };
	}

	const yamlBlock = match[1];
	const body = content.slice(match[0].length);

	if (yamlBlock === undefined) {
		return { metadata: {}, body };
	}

	const lines = yamlBlock.split('\n');
	const metadata = parseYamlLines(lines);

	return { metadata, body };
}

/**
 * Parse lines of YAML key-value pairs into NoteMetadata.
 *
 * Recognises `icon` (string), `tags` (inline array or block array),
 * and `createdAt` (number). Silently drops `updatedAt`.
 */
function parseYamlLines(lines: string[]): NoteMetadata {
	const metadata: NoteMetadata = {};
	let currentKey: string | null = null;
	const currentTags: string[] = [];

	for (const line of lines) {
		const keyExec = /^(\w+):\s*(.*)$/.exec(line);
		if (keyExec) {
			currentKey = handleKeyLine(
				metadata,
				keyExec,
				currentKey,
				currentTags,
			);
			continue;
		}
		collectTagItem(line, currentKey, currentTags);
	}

	flushTags(metadata, currentKey, currentTags);
	return metadata;
}

/**
 * Handle a `key: value` line: flush any pending block tags, then apply the
 * value. Returns the new "current key" for subsequent block-array items.
 */
function handleKeyLine(
	metadata: NoteMetadata,
	keyExec: RegExpExecArray,
	currentKey: string | null,
	currentTags: string[],
): string | null {
	flushTags(metadata, currentKey, currentTags);

	const matchedKey = keyExec[1];
	const matchedValue = keyExec[2];
	if (matchedKey === undefined || matchedValue === undefined) {
		return currentKey;
	}

	const value = matchedValue.trim();
	if (value !== '') {
		applyKeyValue(metadata, matchedKey, value);
	}
	return matchedKey;
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
 * Apply a single key-value pair to NoteMetadata.
 * Supports `icon` (string), `tags` (inline `[a, b]` or single value),
 * and `createdAt` (number). Silently drops `updatedAt`.
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
 * `createdAt` is always written to the frontmatter block when present.
 * `icon` and `tags` are written only when non-empty.
 * If no metadata keys are present, the body is returned unchanged.
 *
 * @param metadata - The metadata to embed
 * @param body - The markdown body (without frontmatter)
 * @returns Full content with frontmatter prepended (if any)
 */
export function serializeFrontmatter(
	metadata: NoteMetadata,
	body: string,
): string {
	const lines = buildFrontmatterLines(metadata);
	if (lines.length === 0) return body;
	return lines.join('\n') + '\n' + body;
}

/**
 * Build the frontmatter YAML lines (including `---` fences).
 * Returns empty array if no metadata keys are present.
 */
function buildFrontmatterLines(metadata: NoteMetadata): string[] {
	const lines: string[] = [];
	appendCreatedAt(lines, metadata);
	appendIcon(lines, metadata);
	appendTags(lines, metadata);

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
