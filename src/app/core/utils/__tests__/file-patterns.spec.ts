import { describe, it, expect } from 'vitest';
import { isTempFilePath } from '../file-patterns';

describe('isTempFilePath', () => {
	it('ignores git empty-folder placeholders anywhere in the tree', () => {
		expect(isTempFilePath('.gitkeep')).toBe(true);
		expect(isTempFilePath('docs/.gitkeep')).toBe(true);
		expect(isTempFilePath('a/b/c/.gitkeep')).toBe(true);
	});

	it('ignores editor temp/swap files', () => {
		expect(isTempFilePath('notes.md.crswap')).toBe(true);
		expect(isTempFilePath('file.swp')).toBe(true);
		expect(isTempFilePath('backup.bak')).toBe(true);
		expect(isTempFilePath('notes.md~')).toBe(true);
	});

	it('treats real notes as note entries', () => {
		expect(isTempFilePath('notes.md')).toBe(false);
		expect(isTempFilePath('docs/guide.md')).toBe(false);
		// A real note that merely contains "gitkeep" in its name is fine.
		expect(isTempFilePath('gitkeep-howto.md')).toBe(false);
		expect(isTempFilePath('.gitignore')).toBe(false);
	});
});
