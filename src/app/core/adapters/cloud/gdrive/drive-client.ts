/**
 * Thin Google Drive REST v3 client.
 *
 * Stateless aside from auth: every request fetches a (possibly refreshed) bearer
 * token from the injected {@link DriveAuth}; a 401 triggers one forced refresh +
 * retry before surfacing. Knows nothing about paths — that mapping lives in
 * {@link PathIndex}. Network goes through {@link driveFetch}, which uses native
 * `fetch` in the browser and Rust-backed `plugin-http` under Tauri.
 */

import {
	DRIVE_CHANGES_API,
	DRIVE_FILES_API,
	DRIVE_UPLOAD_API,
	GDRIVE_FOLDER_MIME,
	MARKDOWN_MIME,
} from './config';
import { driveFetch } from './http';

/** Token provider the client uses for every call. */
export interface DriveAuth {
	/** A currently-valid access token (refreshing transparently if near expiry). */
	getToken(): Promise<string>;
	/** Force a refresh after a 401 and return the new token. */
	forceRefresh(): Promise<string>;
}

/** Subset of Drive's file resource the adapter cares about. */
export interface DriveFile {
	id: string;
	name: string;
	mimeType: string;
	modifiedTime?: string;
	md5Checksum?: string;
	parents?: string[];
	trashed?: boolean;
}

export interface DriveChange {
	fileId?: string;
	removed?: boolean;
	file?: DriveFile;
}

const FILE_FIELDS = 'id,name,mimeType,modifiedTime,md5Checksum,parents,trashed';

/** Plain-object request shape (avoids spreading the union `HeadersInit`). */
interface DriveRequestInit {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
}

export class DriveClient {
	constructor(private readonly auth: DriveAuth) {}

	// ── core request (bearer + 401 refresh-retry) ─────────────────────────────

	private async request(
		url: string,
		init: DriveRequestInit = {},
	): Promise<Response> {
		const send = (token: string): Promise<Response> =>
			driveFetch(url, {
				method: init.method ?? 'GET',
				body: init.body ?? null,
				headers: {
					...(init.headers ?? {}),
					Authorization: `Bearer ${token}`,
				},
			});

		let res = await send(await this.auth.getToken());
		if (res.status === 401) {
			res = await send(await this.auth.forceRefresh());
		}
		if (!res.ok) {
			const detail = await res.text().catch(() => '');
			throw new Error(`Drive API ${String(res.status)}: ${detail || url}`);
		}
		return res;
	}

	private async requestJson<T>(
		url: string,
		init?: DriveRequestInit,
	): Promise<T> {
		const res = await this.request(url, init);
		return (await res.json()) as T;
	}

	// ── reads ──────────────────────────────────────────────────────────────

	/** Fetch the raw text content of a file. */
	async getContent(fileId: string): Promise<string> {
		const res = await this.request(
			`${DRIVE_FILES_API}/${fileId}?alt=media`,
		);
		return res.text();
	}

	/** Fetch a single file's metadata. */
	getFile(fileId: string): Promise<DriveFile> {
		return this.requestJson<DriveFile>(
			`${DRIVE_FILES_API}/${fileId}?fields=${FILE_FIELDS}`,
		);
	}

	/** Run a paginated `files.list` query, collecting all pages. */
	private async listAll(q: string, orderBy?: string): Promise<DriveFile[]> {
		const out: DriveFile[] = [];
		let pageToken: string | undefined;
		do {
			const params = new URLSearchParams({
				q,
				fields: `nextPageToken, files(${FILE_FIELDS})`,
				pageSize: '1000',
			});
			if (orderBy) params.set('orderBy', orderBy);
			if (pageToken) params.set('pageToken', pageToken);
			const page = await this.requestJson<{
				files?: DriveFile[];
				nextPageToken?: string;
			}>(`${DRIVE_FILES_API}?${params.toString()}`);
			out.push(...(page.files ?? []));
			pageToken = page.nextPageToken;
		} while (pageToken);
		return out;
	}

	/** List the direct, non-trashed children of a folder. */
	listChildren(folderId: string): Promise<DriveFile[]> {
		return this.listAll(`'${folderId}' in parents and trashed=false`);
	}

	/**
	 * List only the non-trashed sub-folders of a folder, sorted by name.
	 * Used by the folder-picker UI to browse the Drive tree.
	 */
	listFolders(folderId: string): Promise<DriveFile[]> {
		return this.listAll(
			`'${folderId}' in parents and trashed=false and ` +
				`mimeType='${GDRIVE_FOLDER_MIME}'`,
			'name',
		);
	}

	/**
	 * Find a non-trashed child by exact name within a folder, or null.
	 * The name is escaped for the Drive query language (single quotes, backslash).
	 */
	async findChild(folderId: string, name: string): Promise<DriveFile | null> {
		const safe = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
		const params = new URLSearchParams({
			q: `'${folderId}' in parents and name='${safe}' and trashed=false`,
			fields: `files(${FILE_FIELDS})`,
			pageSize: '10',
		});
		const page = await this.requestJson<{ files?: DriveFile[] }>(
			`${DRIVE_FILES_API}?${params.toString()}`,
		);
		return page.files?.[0] ?? null;
	}

	// ── writes ───────────────────────────────────────────────────────────────

	/** Create a folder under `parentId` and return it. */
	createFolder(name: string, parentId: string): Promise<DriveFile> {
		return this.requestJson<DriveFile>(
			`${DRIVE_FILES_API}?fields=${FILE_FIELDS}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name,
					mimeType: GDRIVE_FOLDER_MIME,
					parents: [parentId],
				}),
			},
		);
	}

	/** Create a text file with content via a multipart upload. */
	createFile(
		name: string,
		parentId: string,
		content: string,
	): Promise<DriveFile> {
		const boundary = `kmt${Math.random().toString(36).slice(2)}`;
		const metadata = JSON.stringify({ name, parents: [parentId] });
		const body =
			`--${boundary}\r\n` +
			'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
			`${metadata}\r\n` +
			`--${boundary}\r\n` +
			`Content-Type: ${MARKDOWN_MIME}\r\n\r\n` +
			`${content}\r\n` +
			`--${boundary}--`;
		return this.requestJson<DriveFile>(
			`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=${FILE_FIELDS}`,
			{
				method: 'POST',
				headers: {
					'Content-Type': `multipart/related; boundary=${boundary}`,
				},
				body,
			},
		);
	}

	/** Overwrite a file's content via a media upload. */
	async updateContent(fileId: string, content: string): Promise<void> {
		await this.request(
			`${DRIVE_UPLOAD_API}/${fileId}?uploadType=media`,
			{
				method: 'PATCH',
				headers: { 'Content-Type': MARKDOWN_MIME },
				body: content,
			},
		);
	}

	/** Update a file's metadata: rename and/or move between parents. */
	updateMetadata(
		fileId: string,
		opts: { name?: string; addParents?: string; removeParents?: string },
	): Promise<DriveFile> {
		const params = new URLSearchParams({ fields: FILE_FIELDS });
		if (opts.addParents) params.set('addParents', opts.addParents);
		if (opts.removeParents) params.set('removeParents', opts.removeParents);
		const body: Record<string, string> = {};
		if (opts.name !== undefined) body['name'] = opts.name;
		return this.requestJson<DriveFile>(
			`${DRIVE_FILES_API}/${fileId}?${params.toString()}`,
			{
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			},
		);
	}

	/** Move a file to the trash (recoverable from the Drive UI). */
	async trash(fileId: string): Promise<void> {
		await this.request(`${DRIVE_FILES_API}/${fileId}?fields=id`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ trashed: true }),
		});
	}

	// ── changes (for watch) ────────────────────────────────────────────────

	/** Baseline page token marking "now" in the change stream. */
	async getStartPageToken(): Promise<string> {
		const res = await this.requestJson<{ startPageToken: string }>(
			`${DRIVE_CHANGES_API}/startPageToken`,
		);
		return res.startPageToken;
	}

	/** List changes since `pageToken`. */
	listChanges(pageToken: string): Promise<{
		changes?: DriveChange[];
		newStartPageToken?: string;
		nextPageToken?: string;
	}> {
		const params = new URLSearchParams({
			pageToken,
			fields: `newStartPageToken, nextPageToken, changes(fileId, removed, file(${FILE_FIELDS}))`,
			pageSize: '100',
		});
		return this.requestJson(`${DRIVE_CHANGES_API}?${params.toString()}`);
	}
}
