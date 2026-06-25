import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter } from '../frontmatter-parser';

describe('parseFrontmatter', () => {
	it('returns empty metadata and full body when no frontmatter', () => {
		const { metadata, body } = parseFrontmatter('# Hello\n\nSome content.');
		expect(metadata).toEqual({});
		expect(body).toBe('# Hello\n\nSome content.');
	});

	it('returns empty metadata and full body for empty string', () => {
		const { metadata, body } = parseFrontmatter('');
		expect(metadata).toEqual({});
		expect(body).toBe('');
	});

	it('parses icon from frontmatter', () => {
		const { metadata, body } = parseFrontmatter(
			'---\nicon: "📝"\n---\n# Note body',
		);
		expect(metadata).toEqual({ icon: '📝' });
		expect(body).toBe('# Note body');
	});

	it('parses tags from inline array', () => {
		const { metadata, body } = parseFrontmatter(
			'---\ntags: [work, urgent]\n---\nContent',
		);
		expect(metadata).toEqual({ tags: ['work', 'urgent'] });
		expect(body).toBe('Content');
	});

	it('parses tags from block array', () => {
		const { metadata, body } = parseFrontmatter(
			'---\ntags:\n  - personal\n  - journal\n---\n# Journal entry',
		);
		expect(metadata).toEqual({ tags: ['personal', 'journal'] });
		expect(body).toBe('# Journal entry');
	});

	it('parses both icon and tags together', () => {
		const { metadata, body } = parseFrontmatter(
			'---\nicon: ⭐\ntags: [featured]\n---\nBody',
		);
		expect(metadata).toEqual({ icon: '⭐', tags: ['featured'] });
		expect(body).toBe('Body');
	});

	it('parses createdAt timestamp and drops updatedAt', () => {
		const { metadata } = parseFrontmatter(
			'---\ncreatedAt: 1718000000000\nupdatedAt: 1719000000000\nicon: 📄\n---\nBody',
		);
		expect(metadata).toEqual({ createdAt: 1718000000000, icon: '📄' });
	});

	it('does not mistake YAML-like content mid-file for frontmatter', () => {
		const content = '# Hello\n\n---\nnot frontmatter\n---\n';
		const { metadata, body } = parseFrontmatter(content);
		expect(metadata).toEqual({});
		expect(body).toBe(content);
	});

	it('handles tags with quoted values in block array', () => {
		const { metadata } = parseFrontmatter(
			'---\ntags:\n  - "tag one"\n  - "tag two"\n---\nBody',
		);
		expect(metadata).toEqual({ tags: ['tag one', 'tag two'] });
	});

	it('handles icon without quotes', () => {
		const { metadata } = parseFrontmatter('---\nicon: 🎯\n---\nBody');
		expect(metadata).toEqual({ icon: '🎯' });
	});

	it('captures unknown keys verbatim in preserved', () => {
		const { metadata, preserved, body } = parseFrontmatter(
			'---\nicon: 📝\naliases:\n  - Foo\n  - Bar\ncssclass: wide\n---\nBody',
		);
		expect(metadata).toEqual({ icon: '📝' });
		expect(preserved).toEqual([
			'aliases:',
			'  - Foo',
			'  - Bar',
			'cssclass: wide',
		]);
		expect(body).toBe('Body');
	});

	it('parses frontmatter with CRLF line endings', () => {
		const { metadata, body, preserved } = parseFrontmatter(
			'---\r\nicon: ⭐\r\ncustom: keep me\r\n---\r\n# Body',
		);
		expect(metadata).toEqual({ icon: '⭐' });
		expect(preserved).toEqual(['custom: keep me']);
		expect(body).toBe('# Body');
	});
});

describe('serializeFrontmatter', () => {
	it('returns body unchanged when no metadata', () => {
		const result = serializeFrontmatter({}, '# Just body');
		expect(result).toBe('# Just body');
	});

	it('prepends frontmatter with createdAt only', () => {
		const result = serializeFrontmatter(
			{ createdAt: 1718000000000 },
			'# Body',
		);
		expect(result).toBe('---\ncreatedAt: 1718000000000\n---\n# Body');
	});

	it('prepends frontmatter with createdAt and icon', () => {
		const result = serializeFrontmatter(
			{ createdAt: 1718000000000, icon: '📝' },
			'Body',
		);
		expect(result).toBe(
			'---\ncreatedAt: 1718000000000\nicon: "📝"\n---\nBody',
		);
	});

	it('prepends frontmatter with createdAt and tags', () => {
		const result = serializeFrontmatter(
			{ createdAt: 1718000000000, tags: ['work'] },
			'Body',
		);
		expect(result).toBe(
			'---\ncreatedAt: 1718000000000\ntags: ["work"]\n---\nBody',
		);
	});

	it('roundtrips createdAt correctly', () => {
		const original =
			'---\ncreatedAt: 1718000000000\nicon: 📝\ntags: [work]\n---\n# Note body.';
		const { metadata, body } = parseFrontmatter(original);
		const reconstructed = serializeFrontmatter(metadata, body);
		expect(reconstructed).toBe(
			'---\ncreatedAt: 1718000000000\nicon: "📝"\ntags: ["work"]\n---\n# Note body.',
		);
	});

	it('prepends frontmatter with icon', () => {
		const result = serializeFrontmatter({ icon: '📝' }, '# Body');
		expect(result).toBe('---\nicon: "📝"\n---\n# Body');
	});

	it('prepends frontmatter with tags', () => {
		const result = serializeFrontmatter(
			{ tags: ['work', 'urgent'] },
			'Body',
		);
		expect(result).toBe('---\ntags: ["work", "urgent"]\n---\nBody');
	});

	it('prepends frontmatter with icon and tags', () => {
		const result = serializeFrontmatter(
			{ icon: '📌', tags: ['personal'] },
			'Content',
		);
		expect(result).toBe(
			'---\nicon: "📌"\ntags: ["personal"]\n---\nContent',
		);
	});

	it('roundtrips correctly', () => {
		const original =
			'---\nicon: 📝\ntags: [work, urgent]\n---\n# Note\n\nSome text.';
		const { metadata, body } = parseFrontmatter(original);
		const reconstructed = serializeFrontmatter(metadata, body);
		// Serializer always quotes values for valid YAML
		expect(reconstructed).toBe(
			'---\nicon: "📝"\ntags: ["work", "urgent"]\n---\n# Note\n\nSome text.',
		);
	});

	it('preserves unknown keys through a parse → serialize round-trip', () => {
		const original =
			'---\nicon: 📝\naliases:\n  - Foo\n  - Bar\ncssclass: wide\n---\n# Note body';
		const { metadata, body, preserved } = parseFrontmatter(original);
		const reconstructed = serializeFrontmatter(metadata, body, preserved);
		expect(reconstructed).toBe(
			'---\nicon: "📝"\naliases:\n  - Foo\n  - Bar\ncssclass: wide\n---\n# Note body',
		);
	});

	it('keeps unknown keys when only managed keys change', () => {
		const original =
			'---\ncssclass: wide\nlinks:\n  - "[[Other]]"\n---\nBody';
		const { metadata, body, preserved } = parseFrontmatter(original);
		metadata.tags = ['added'];
		const reconstructed = serializeFrontmatter(metadata, body, preserved);
		expect(reconstructed).toBe(
			'---\ntags: ["added"]\ncssclass: wide\nlinks:\n  - "[[Other]]"\n---\nBody',
		);
	});

	it('round-trips a file that has only unknown keys', () => {
		const { metadata, body, preserved } = parseFrontmatter(
			'---\nauthor: jane\n---\nHello',
		);
		expect(metadata).toEqual({});
		expect(serializeFrontmatter(metadata, body, preserved)).toBe(
			'---\nauthor: jane\n---\nHello',
		);
	});
});
