/**
 * Path ↔ Drive-fileId index for one workspace folder.
 *
 * Drive addresses files by ID, but the `Adapter` contract is path-based. This
 * builds a cached tree of the workspace root (one recursive walk) and maps each
 * relative POSIX path to its Drive node, creating folder chains on demand for
 * writes. Drive permits duplicate names in a folder; collisions resolve
 * first-wins deterministically (and are logged).
 */

import { debugLog } from '@core/utils/debug-logger';
import { GDRIVE_FOLDER_MIME } from './config';
import type { DriveClient, DriveFile } from './drive-client';

export interface IndexedNode {
	id: string;
	name: string;
	isFolder: boolean;
	/** epoch-ms, 0 if unknown. */
	modifiedTime: number;
	md5?: string;
}

/** A node paired with its full relative path. */
export interface IndexedEntry extends IndexedNode {
	path: string;
}

/** Strip leading/trailing slashes and collapse to a clean POSIX-ish key. */
export function normalizePath(path: string): string {
	return path.replace(/^\/+|\/+$/g, '');
}

export function toIndexedNode(file: DriveFile): IndexedNode {
	const node: IndexedNode = {
		id: file.id,
		name: file.name,
		isFolder: file.mimeType === GDRIVE_FOLDER_MIME,
		modifiedTime: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
	};
	// Omit (don't set to undefined) under exactOptionalPropertyTypes.
	if (file.md5Checksum !== undefined) node.md5 = file.md5Checksum;
	return node;
}

export class PathIndex {
	/** Relative path → node. Root folder itself is implicit (path ''). */
	private readonly byPath = new Map<string, IndexedNode>();
	private built = false;

	constructor(
		private readonly client: DriveClient,
		readonly rootFolderId: string,
	) {}

	/** Build the tree once; subsequent calls are no-ops until {@link invalidate}. */
	async ensureBuilt(): Promise<void> {
		if (this.built) return;
		this.byPath.clear();
		await this.walk(this.rootFolderId, '');
		this.built = true;
	}

	/** Force a rebuild on the next {@link ensureBuilt}. */
	invalidate(): void {
		this.built = false;
	}

	private async walk(folderId: string, prefix: string): Promise<void> {
		const children = await this.client.listChildren(folderId);
		for (const child of children) {
			const path = prefix ? `${prefix}/${child.name}` : child.name;
			if (this.byPath.has(path)) {
				debugLog(`[GDrive] name collision at "${path}" — keeping first`);
				continue;
			}
			const node = toIndexedNode(child);
			this.byPath.set(path, node);
			if (node.isFolder) {
				await this.walk(node.id, path);
			}
		}
	}

	// ── lookups ──────────────────────────────────────────────────────────────

	getNode(path: string): IndexedNode | undefined {
		return this.byPath.get(normalizePath(path));
	}

	/** Entries directly under `dirPath` (or the whole subtree when recursive). */
	listDir(dirPath: string, recursive: boolean): IndexedEntry[] {
		const dir = normalizePath(dirPath);
		const prefix = dir ? `${dir}/` : '';
		const out: IndexedEntry[] = [];
		for (const [path, node] of this.byPath) {
			if (!path.startsWith(prefix) || path === dir) continue;
			const rest = path.slice(prefix.length);
			if (!recursive && rest.includes('/')) continue;
			out.push({ ...node, path });
		}
		return out;
	}

	// ── mutations (keep the cache in sync with writes) ─────────────────────────

	put(path: string, node: IndexedNode): void {
		this.byPath.set(normalizePath(path), node);
	}

	/** Remove a path and, if it's a folder, its whole subtree. */
	remove(path: string): void {
		const key = normalizePath(path);
		this.byPath.delete(key);
		const prefix = `${key}/`;
		for (const existing of this.byPath.keys()) {
			if (existing.startsWith(prefix)) this.byPath.delete(existing);
		}
	}

	/**
	 * Resolve the folder ID for `dirPath`, creating any missing folders along the
	 * way. Returns the workspace root for an empty path.
	 */
	async ensureFolder(dirPath: string): Promise<string> {
		const dir = normalizePath(dirPath);
		if (!dir) return this.rootFolderId;

		let parentId = this.rootFolderId;
		let prefix = '';
		for (const segment of dir.split('/')) {
			const path = prefix ? `${prefix}/${segment}` : segment;
			const existing = this.byPath.get(path);
			if (existing?.isFolder) {
				parentId = existing.id;
			} else {
				const created = await this.findOrCreateFolder(segment, parentId);
				this.byPath.set(path, toIndexedNode(created));
				parentId = created.id;
			}
			prefix = path;
		}
		return parentId;
	}

	/** Reuse an existing same-named folder if present, else create one. */
	private async findOrCreateFolder(
		name: string,
		parentId: string,
	): Promise<DriveFile> {
		const existing = await this.client.findChild(parentId, name);
		if (existing?.mimeType === GDRIVE_FOLDER_MIME) {
			return existing;
		}
		return this.client.createFolder(name, parentId);
	}
}
