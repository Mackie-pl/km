import { describe, it, expect, beforeEach } from 'vitest';
import { PathIndex } from '../path-index';
import { GDRIVE_FOLDER_MIME, MARKDOWN_MIME } from '../config';
import type { DriveClient, DriveFile } from '../drive-client';

/** In-memory Drive stand-in covering the methods PathIndex calls. */
class FakeDrive {
	private seq = 0;
	private readonly byId = new Map<string, DriveFile>();
	private readonly kids = new Map<string, string[]>();

	add(parentId: string, name: string, isFolder: boolean): DriveFile {
		const id = `id${String(++this.seq)}`;
		const file: DriveFile = {
			id,
			name,
			mimeType: isFolder ? GDRIVE_FOLDER_MIME : MARKDOWN_MIME,
			modifiedTime: new Date(this.seq * 1000).toISOString(),
			parents: [parentId],
		};
		this.byId.set(id, file);
		const list = this.kids.get(parentId) ?? [];
		list.push(id);
		this.kids.set(parentId, list);
		return file;
	}

	listChildren(folderId: string): Promise<DriveFile[]> {
		const ids = this.kids.get(folderId) ?? [];
		return Promise.resolve(ids.map((id) => this.byId.get(id)!));
	}

	findChild(parentId: string, name: string): Promise<DriveFile | null> {
		const ids = this.kids.get(parentId) ?? [];
		const hit = ids
			.map((id) => this.byId.get(id)!)
			.find((f) => f.name === name);
		return Promise.resolve(hit ?? null);
	}

	createFolder(name: string, parentId: string): Promise<DriveFile> {
		return Promise.resolve(this.add(parentId, name, true));
	}

	asClient(): DriveClient {
		return this as unknown as DriveClient;
	}
}

describe('PathIndex', () => {
	let drive: FakeDrive;
	let index: PathIndex;

	beforeEach(() => {
		drive = new FakeDrive();
		// Seed: root/note.md, root/docs/, root/docs/guide.md
		drive.add('root', 'note.md', false);
		const docs = drive.add('root', 'docs', true);
		drive.add(docs.id, 'guide.md', false);
		index = new PathIndex(drive.asClient(), 'root');
	});

	it('builds the tree and resolves nested paths', async () => {
		await index.ensureBuilt();
		expect(index.getNode('note.md')?.isFolder).toBe(false);
		expect(index.getNode('docs')?.isFolder).toBe(true);
		expect(index.getNode('docs/guide.md')?.isFolder).toBe(false);
	});

	it('lists a directory non-recursively (immediate children only)', async () => {
		await index.ensureBuilt();
		const top = index.listDir('', false).map((e) => e.path).sort();
		expect(top).toEqual(['docs', 'note.md']);
	});

	it('lists recursively (whole subtree)', async () => {
		await index.ensureBuilt();
		const all = index.listDir('', true).map((e) => e.path).sort();
		expect(all).toEqual(['docs', 'docs/guide.md', 'note.md']);
	});

	it('reuses an existing folder and creates only missing segments', async () => {
		await index.ensureBuilt();
		const id = await index.ensureFolder('docs/sub');
		// "docs" reused, "sub" created.
		expect(index.getNode('docs/sub')?.id).toBe(id);
		expect(index.getNode('docs')?.id).toBeDefined();
	});

	it('removes a folder and its whole subtree', async () => {
		await index.ensureBuilt();
		index.remove('docs');
		expect(index.getNode('docs')).toBeUndefined();
		expect(index.getNode('docs/guide.md')).toBeUndefined();
		expect(index.getNode('note.md')).toBeDefined();
	});

	it('resolves an empty path to the root folder id', async () => {
		await index.ensureBuilt();
		expect(await index.ensureFolder('')).toBe('root');
	});
});
