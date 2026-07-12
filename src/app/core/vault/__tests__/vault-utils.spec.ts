import {
	hashContent,
	makeConflictName,
	parseConflictName,
} from '../vault-utils';

describe('vault-utils conflict-name helpers', () => {
	describe('parseConflictName', () => {
		it('parses a conflict copy name', () => {
			expect(parseConflictName('fizjo.conflict-gdrive.md')).toEqual({
				originalName: 'fizjo.md',
				adapterId: 'gdrive',
			});
		});

		it('parses a deduped conflict copy name', () => {
			expect(parseConflictName('fizjo.conflict-gdrive (2).md')).toEqual({
				originalName: 'fizjo.md',
				adapterId: 'gdrive',
			});
		});

		it('returns null for a regular name', () => {
			expect(parseConflictName('fizjo.md')).toBeNull();
			expect(parseConflictName('notes')).toBeNull();
		});
	});

	describe('makeConflictName', () => {
		it('builds a conflict name', () => {
			expect(makeConflictName('fizjo.md', 'gdrive')).toBe(
				'fizjo.conflict-gdrive.md',
			);
		});

		it('never nests conflict suffixes', () => {
			expect(makeConflictName('fizjo.conflict-gdrive.md', 'gdrive')).toBe(
				'fizjo.conflict-gdrive.md',
			);
			expect(
				makeConflictName(
					'fizjo.conflict-gdrive.conflict-gdrive.md',
					'gdrive',
				),
			).toBe('fizjo.conflict-gdrive.md');
		});

		it('handles extensionless names', () => {
			expect(makeConflictName('notes', 'gdrive')).toBe(
				'notes.conflict-gdrive',
			);
		});
	});

	describe('hashContent', () => {
		it('is stable and content-sensitive', () => {
			expect(hashContent('abc')).toBe(hashContent('abc'));
			expect(hashContent('abc')).not.toBe(hashContent('abd'));
			expect(hashContent('')).toBe(hashContent(''));
		});
	});
});
