import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DriveClient, type DriveAuth } from '../drive-client';

function json(obj: unknown, status = 200): Response {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('DriveClient', () => {
	const realFetch = globalThis.fetch;
	let fetchMock: ReturnType<typeof vi.fn>;
	let getToken: ReturnType<typeof vi.fn>;
	let forceRefresh: ReturnType<typeof vi.fn>;
	let auth: DriveAuth;
	let client: DriveClient;

	beforeEach(() => {
		fetchMock = vi.fn();
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		getToken = vi.fn(() => Promise.resolve('tok1'));
		forceRefresh = vi.fn(() => Promise.resolve('tok2'));
		auth = {
			getToken: getToken as unknown as DriveAuth['getToken'],
			forceRefresh: forceRefresh as unknown as DriveAuth['forceRefresh'],
		};
		client = new DriveClient(auth);
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('sends a bearer token on every request', async () => {
		fetchMock.mockResolvedValueOnce(json({ files: [] }));
		await client.listChildren('folder1');
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(
			(init.headers as Record<string, string>).Authorization,
		).toBe('Bearer tok1');
	});

	it('paginates listChildren across pages', async () => {
		fetchMock
			.mockResolvedValueOnce(
				json({ files: [{ id: 'a' }], nextPageToken: 'p2' }),
			)
			.mockResolvedValueOnce(json({ files: [{ id: 'b' }] }));
		const files = await client.listChildren('folder1');
		expect(files.map((f) => f.id)).toEqual(['a', 'b']);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('creates a file via a multipart upload carrying the content', async () => {
		fetchMock.mockResolvedValueOnce(json({ id: 'new', name: 'n.md' }));
		const file = await client.createFile('n.md', 'parent1', '# Body');
		expect(file.id).toBe('new');
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('uploadType=multipart');
		expect((init.headers as Record<string, string>)['Content-Type']).toContain(
			'multipart/related',
		);
		expect(init.body as string).toContain('# Body');
	});

	it('trashes a file (PATCH trashed=true)', async () => {
		fetchMock.mockResolvedValueOnce(json({ id: 'x' }));
		await client.trash('x');
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('/x');
		expect(init.method).toBe('PATCH');
		expect(init.body as string).toContain('"trashed":true');
	});

	it('refreshes once and retries on a 401', async () => {
		fetchMock
			.mockResolvedValueOnce(json({ error: 'unauthorized' }, 401))
			.mockResolvedValueOnce(json({ files: [] }));
		await client.listChildren('folder1');
		expect(forceRefresh).toHaveBeenCalledTimes(1);
		const [, retryInit] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(
			(retryInit.headers as Record<string, string>).Authorization,
		).toBe('Bearer tok2');
	});

	it('throws with status detail on a non-ok response', async () => {
		fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
		await expect(client.getContent('x')).rejects.toThrow('500');
	});

	it('lists only folders, paginated', async () => {
		fetchMock
			.mockResolvedValueOnce(
				json({ files: [{ id: 'f1' }], nextPageToken: 'p2' }),
			)
			.mockResolvedValueOnce(json({ files: [{ id: 'f2' }] }));
		const folders = await client.listFolders('parent');
		expect(folders.map((f) => f.id)).toEqual(['f1', 'f2']);
		const [url] = fetchMock.mock.calls[0] as [string];
		// URLSearchParams encodes spaces as '+'; normalize before matching.
		const query = decodeURIComponent(url).replace(/\+/g, ' ');
		expect(query).toContain(
			"mimeType='application/vnd.google-apps.folder'",
		);
		expect(query).toContain("'parent' in parents");
	});
});
