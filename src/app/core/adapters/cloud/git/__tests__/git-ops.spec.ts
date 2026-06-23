import { describe, it, expect } from 'vitest';
import git from 'isomorphic-git';
import { createGitFsBackend } from '../fs';
import {
	diffCommitFiles,
	isNonFastForwardError,
	mergeBaseOf,
	resetBranchToRemote,
} from '../git-ops';
import { GitCloneState, type RepoEntry } from '../types';

/**
 * Builds a throwaway RepoEntry backed by a fresh LightningFS clone dir.
 * No remote — we drive commits directly with isomorphic-git.
 */
async function makeRepo(): Promise<RepoEntry> {
	const cloneDir = `/__difftest_${Math.random().toString(36).slice(2)}`;
	const fs = await createGitFsBackend(cloneDir);
	await git.init({ fs, dir: cloneDir, defaultBranch: 'main' });
	return {
		cloneDir,
		fs,
		state: GitCloneState.READY,
		error: null,
		branch: 'main',
		authorName: 'Test',
		authorEmail: 'test@example.com',
		commitLock: Promise.resolve(),
	};
}

const AUTHOR = { name: 'Test', email: 'test@example.com' };

describe('diffCommitFiles', () => {
	it('reports created, modified, and deleted files between two commits', async () => {
		const repo = await makeRepo();
		const { fs, cloneDir } = repo;

		// Commit 1: a.md + keep.md
		await fs.promises.writeFile(`${cloneDir}/a.md`, 'A1');
		await fs.promises.writeFile(`${cloneDir}/keep.md`, 'K');
		await git.add({ fs, dir: cloneDir, filepath: 'a.md' });
		await git.add({ fs, dir: cloneDir, filepath: 'keep.md' });
		const oid1 = await git.commit({
			fs,
			dir: cloneDir,
			author: AUTHOR,
			message: 'c1',
		});

		// Commit 2: modify a.md, add nested/b.md, leave keep.md untouched
		await fs.promises.writeFile(`${cloneDir}/a.md`, 'A2');
		await fs.promises
			.mkdir(`${cloneDir}/nested`, { recursive: true })
			.catch(() => undefined);
		await fs.promises.writeFile(`${cloneDir}/nested/b.md`, 'B1');
		await git.add({ fs, dir: cloneDir, filepath: 'a.md' });
		await git.add({ fs, dir: cloneDir, filepath: 'nested/b.md' });
		const oid2 = await git.commit({
			fs,
			dir: cloneDir,
			author: AUTHOR,
			message: 'c2',
		});

		const events = await diffCommitFiles(repo, oid1, oid2);
		const byPath = new Map(events.map((e) => [e.path, e.type]));

		expect(byPath.get('a.md')).toBe('modify');
		expect(byPath.get('nested/b.md')).toBe('create');
		// Unchanged file must not be reported.
		expect(byPath.has('keep.md')).toBe(false);
	});

	it('reports a deletion between two commits', async () => {
		const repo = await makeRepo();
		const { fs, cloneDir } = repo;

		await fs.promises.writeFile(`${cloneDir}/gone.md`, 'bye');
		await git.add({ fs, dir: cloneDir, filepath: 'gone.md' });
		const oid1 = await git.commit({
			fs,
			dir: cloneDir,
			author: AUTHOR,
			message: 'c1',
		});

		await git.remove({ fs, dir: cloneDir, filepath: 'gone.md' });
		await fs.promises.unlink(`${cloneDir}/gone.md`).catch(() => undefined);
		const oid2 = await git.commit({
			fs,
			dir: cloneDir,
			author: AUTHOR,
			message: 'c2',
		});

		const events = await diffCommitFiles(repo, oid1, oid2);
		expect(events).toEqual([{ type: 'delete', path: 'gone.md' }]);
	});

	it('returns no events when the trees are identical', async () => {
		const repo = await makeRepo();
		const { fs, cloneDir } = repo;
		await fs.promises.writeFile(`${cloneDir}/x.md`, 'X');
		await git.add({ fs, dir: cloneDir, filepath: 'x.md' });
		const oid = await git.commit({
			fs,
			dir: cloneDir,
			author: AUTHOR,
			message: 'c1',
		});

		const events = await diffCommitFiles(repo, oid, oid);
		expect(events).toEqual([]);
	});
});

describe('isNonFastForwardError', () => {
	it('detects a client-side PushRejectedError (not-fast-forward)', () => {
		expect(
			isNonFastForwardError({
				code: 'PushRejectedError',
				data: { reason: 'not-fast-forward' },
			}),
		).toBe(true);
	});

	it('ignores other PushRejectedError reasons (e.g. tag-exists)', () => {
		expect(
			isNonFastForwardError({
				code: 'PushRejectedError',
				data: { reason: 'tag-exists' },
			}),
		).toBe(false);
	});

	it('detects a server-side GitPushError with a non-fast-forward ref', () => {
		expect(
			isNonFastForwardError({
				code: 'GitPushError',
				data: {
					result: {
						refs: {
							'refs/heads/main': {
								error: 'failed to update ref — fetch first',
							},
						},
					},
				},
			}),
		).toBe(true);
	});

	it('returns false for a GitPushError whose refs have no error', () => {
		expect(
			isNonFastForwardError({
				code: 'GitPushError',
				data: { result: { refs: { 'refs/heads/main': { error: null } } } },
			}),
		).toBe(false);
	});

	it('returns false for unrelated errors and non-objects', () => {
		expect(isNonFastForwardError(new Error('network down'))).toBe(false);
		expect(isNonFastForwardError(null)).toBe(false);
		expect(isNonFastForwardError('nope')).toBe(false);
	});
});

describe('mergeBaseOf', () => {
	it('returns the common ancestor of a commit and its descendant', async () => {
		const repo = await makeRepo();
		const { fs, cloneDir } = repo;
		await fs.promises.writeFile(`${cloneDir}/a.md`, 'A1');
		await git.add({ fs, dir: cloneDir, filepath: 'a.md' });
		const base = await git.commit({
			fs,
			dir: cloneDir,
			author: AUTHOR,
			message: 'base',
		});
		await fs.promises.writeFile(`${cloneDir}/a.md`, 'A2');
		await git.add({ fs, dir: cloneDir, filepath: 'a.md' });
		const tip = await git.commit({
			fs,
			dir: cloneDir,
			author: AUTHOR,
			message: 'tip',
		});

		expect(await mergeBaseOf(repo, tip, base)).toBe(base);
	});
});

describe('resetBranchToRemote', () => {
	it('moves the branch ref and working tree back to origin/<branch>', async () => {
		const repo = await makeRepo();
		const { fs, cloneDir } = repo;

		// Commit C1 (a.md=A1, b.md=B) and pin it as the remote-tracking ref.
		await fs.promises.writeFile(`${cloneDir}/a.md`, 'A1');
		await fs.promises.writeFile(`${cloneDir}/b.md`, 'B');
		await git.add({ fs, dir: cloneDir, filepath: 'a.md' });
		await git.add({ fs, dir: cloneDir, filepath: 'b.md' });
		const c1 = await git.commit({
			fs,
			dir: cloneDir,
			author: AUTHOR,
			message: 'c1',
		});
		await git.writeRef({
			fs,
			dir: cloneDir,
			ref: 'refs/remotes/origin/main',
			value: c1,
			force: true,
		});

		// Local advances past the remote: modify a.md, drop b.md, add c.md → C2.
		await fs.promises.writeFile(`${cloneDir}/a.md`, 'A2');
		await git.remove({ fs, dir: cloneDir, filepath: 'b.md' });
		await fs.promises.unlink(`${cloneDir}/b.md`).catch(() => undefined);
		await fs.promises.writeFile(`${cloneDir}/c.md`, 'C');
		await git.add({ fs, dir: cloneDir, filepath: 'a.md' });
		await git.add({ fs, dir: cloneDir, filepath: 'c.md' });
		await git.commit({ fs, dir: cloneDir, author: AUTHOR, message: 'c2' });

		expect(await resetBranchToRemote(repo)).toBe(true);

		// Branch ref is back at C1, and HEAD lists exactly C1's tree.
		const head = await git.resolveRef({ fs, dir: cloneDir, ref: 'HEAD' });
		expect(head).toBe(c1);
		const files = await git.listFiles({ fs, dir: cloneDir, ref: 'HEAD' });
		expect(files.sort()).toEqual(['a.md', 'b.md']);

		// Working tree is restored to the C1 content.
		const a = await fs.promises.readFile(`${cloneDir}/a.md`, 'utf8');
		expect(a.toString()).toBe('A1');
		const cGone = await fs.promises
			.stat(`${cloneDir}/c.md`)
			.then(() => true)
			.catch(() => false);
		expect(cGone).toBe(false);
	});

	it('is a no-op (false) when there is no remote-tracking ref', async () => {
		const repo = await makeRepo();
		const { fs, cloneDir } = repo;
		await fs.promises.writeFile(`${cloneDir}/a.md`, 'A');
		await git.add({ fs, dir: cloneDir, filepath: 'a.md' });
		await git.commit({ fs, dir: cloneDir, author: AUTHOR, message: 'c1' });

		expect(await resetBranchToRemote(repo)).toBe(false);
	});
});
