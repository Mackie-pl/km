/**
 * Google Drive cloud adapter — implements the Adapter interface over the Drive
 * REST v3 API with OAuth 2.0 PKCE auth (browser path).
 *
 * Each `root` is a resolved Drive folder ID (the workspace's vault folder).
 * Per-root state — a {@link DriveClient} and a {@link PathIndex} — is cached so
 * CRUD and `watch()` share one path↔fileId map. Auth (token refresh) is a single
 * account for now, shared across roots.
 *
 * Responsibilities are split across the module:
 * - {@link DriveClient} — stateless REST calls + 401 refresh-retry.
 * - {@link PathIndex} — path↔fileId tree, folder creation.
 * - `oauth` — interactive sign-in + token refresh.
 * - This class — the Adapter contract + connect/folder-resolution orchestration.
 */

import type {
	Adapter,
	AdapterConfig,
	ConnectionTestResult,
	FileEntry,
	GDriveAdapterConfig,
	WatchEvent,
	WorkspacePickResult,
} from '../../adapter.interface';
import { DriveClient } from './drive-client';
import { PathIndex, toIndexedNode } from './path-index';
import { gdriveAuth } from './auth-provider';
import { GDriveSettingsStore } from './settings-store';
import { createDriveWatcher } from './watch';
import {
	DEFAULT_GDRIVE_FOLDER,
	DEFAULT_POLL_INTERVAL_MS,
	GDRIVE_FOLDER_MIME,
} from './config';

// ── path helpers ─────────────────────────────────────────────────────────────

function basename(path: string): string {
	const norm = path.replace(/^\/+|\/+$/g, '');
	const idx = norm.lastIndexOf('/');
	return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function parentDir(path: string): string {
	const norm = path.replace(/^\/+|\/+$/g, '');
	const idx = norm.lastIndexOf('/');
	return idx >= 0 ? norm.slice(0, idx) : '';
}

function assertRoot(root: string | undefined): string {
	if (!root) throw new Error('GDriveAdapter: no root folder configured');
	return root;
}

/** Heuristic: a long token of Drive-id characters with no path separators. */
function looksLikeDriveId(value: string): boolean {
	return /^[A-Za-z0-9_-]{24,}$/.test(value);
}

/** True for a DriveClient "Drive API 404" error (file id no longer exists). */
function isDriveNotFoundError(err: unknown): boolean {
	return err instanceof Error && err.message.startsWith('Drive API 404');
}

interface GDriveContext {
	client: DriveClient;
	index: PathIndex;
}

// ── Adapter ────────────────────────────────────────────────────────────────

export class GDriveAdapter implements Adapter {
	readonly id = 'gdrive';
	readonly isLocal = false;

	private readonly settingsStore = new GDriveSettingsStore();
	private readonly contexts = new Map<string, GDriveContext>();

	isAvailable(): boolean {
		return true;
	}

	pickWorkspaceFolder(): Promise<WorkspacePickResult | null> {
		// Cloud adapters are configured via the schema-driven form, not a picker.
		return Promise.resolve(null);
	}

	async read(path: string, root?: string): Promise<string> {
		const { index, client } = this.#context(assertRoot(root));
		await index.ensureBuilt();
		const node = index.getNode(path);
		if (!node || node.isFolder) {
			throw new Error(`GDriveAdapter: no such file "${path}"`);
		}
		return client.getContent(node.id);
	}

	async write(path: string, content: string, root?: string): Promise<void> {
		const { index, client } = this.#context(assertRoot(root));
		await index.ensureBuilt();
		const existing = index.getNode(path);
		if (existing && !existing.isFolder) {
			await client.updateContent(existing.id, content);
			return;
		}
		const parentId = await index.ensureFolder(parentDir(path));
		const file = await client.createFile(basename(path), parentId, content);
		index.put(path, toIndexedNode(file));
	}

	async delete(path: string, root?: string): Promise<void> {
		const { index, client } = this.#context(assertRoot(root));
		await index.ensureBuilt();
		const node = index.getNode(path);
		// Idempotent like the local FS adapters: the goal state is "absent on
		// remote". A file that never reached Drive (e.g. a locally-resolved
		// conflict copy) or was already trashed there counts as deleted —
		// throwing here would leave the entry pending and retry forever.
		if (!node) return;
		try {
			await client.trash(node.id);
		} catch (err) {
			if (!isDriveNotFoundError(err)) throw err;
		}
		index.remove(path);
	}

	async rename(
		oldPath: string,
		newPath: string,
		root?: string,
	): Promise<void> {
		const { index, client } = this.#context(assertRoot(root));
		await index.ensureBuilt();
		const node = index.getNode(oldPath);
		if (!node) throw new Error(`GDriveAdapter: nothing at "${oldPath}"`);

		const movingDirs = parentDir(oldPath) !== parentDir(newPath);
		const oldParentId = index.getNode(parentDir(oldPath))?.id;

		// Build without undefined values (exactOptionalPropertyTypes).
		const meta: {
			name?: string;
			addParents?: string;
			removeParents?: string;
		} = { name: basename(newPath) };
		if (movingDirs) {
			meta.addParents = await index.ensureFolder(parentDir(newPath));
			if (oldParentId !== undefined) meta.removeParents = oldParentId;
		}
		await client.updateMetadata(node.id, meta);

		// A folder move shifts every descendant path; rebuild lazily. A file move
		// is a single-entry remap.
		if (node.isFolder) {
			index.invalidate();
		} else {
			index.remove(oldPath);
			index.put(newPath, { ...node, name: basename(newPath) });
		}
	}

	async list(
		path: string,
		root?: string,
		recursive?: boolean,
	): Promise<FileEntry[]> {
		const { index } = this.#context(assertRoot(root));
		await index.ensureBuilt();
		return index.listDir(path, !!recursive).map((e) => ({
			path: e.path,
			name: e.name,
			isDirectory: e.isFolder,
			lastModified: e.modifiedTime,
		}));
	}

	async watch(
		callback: (events: WatchEvent[]) => void,
		root?: string,
	): Promise<() => void> {
		const resolvedRoot = assertRoot(root);
		const { index, client } = this.#context(resolvedRoot);
		await index.ensureBuilt();
		const { pollIntervalMs } = this.settingsStore.get(resolvedRoot);
		const watcher = createDriveWatcher(client, index, pollIntervalMs);
		watcher.start(callback);
		return () => {
			watcher.stop();
		};
	}

	async createDir(path: string, root?: string): Promise<void> {
		const { index } = this.#context(assertRoot(root));
		await index.ensureBuilt();
		await index.ensureFolder(path);
	}

	async testConnection(config: AdapterConfig): Promise<ConnectionTestResult> {
		const gdConfig = config as GDriveAdapterConfig;
		try {
			await gdriveAuth.ensureSignedIn();
			const client = new DriveClient(gdriveAuth);
			const folder = await this.#resolveFolder(client, gdConfig);

			// Write the resolved id back onto the (by-reference) config so the
			// saved workspace config uses a stable folder id as its root, and
			// seed the per-root settings for a fresh session's watch().
			gdConfig.path = folder.id;
			gdConfig.folderName = folder.name;
			this.settingsStore.set(folder.id, {
				pollIntervalMs: gdConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
				folderName: folder.name,
			});
			// Prime the context so the first sync reuses this client/index.
			this.contexts.set(folder.id, {
				client,
				index: new PathIndex(client, folder.id),
			});
			return { ok: true };
		} catch (err: unknown) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : 'Connection failed',
			};
		}
	}

	registerScope(): Promise<void> {
		// No OS-level scope to register for a cloud adapter.
		return Promise.resolve();
	}

	/**
	 * Drop cached per-root clients/indexes and forget the shared OAuth token.
	 * Invoked when no workspace uses Drive any more, so a removed Drive workspace
	 * stops the app prompting to reconnect. Idempotent.
	 */
	async disconnect(): Promise<void> {
		this.contexts.clear();
		await gdriveAuth.signOut();
	}

	// ── internals ──────────────────────────────────────────────────────────

	#context(root: string): GDriveContext {
		let ctx = this.contexts.get(root);
		if (!ctx) {
			const client = new DriveClient(gdriveAuth);
			ctx = { client, index: new PathIndex(client, root) };
			this.contexts.set(root, ctx);
		}
		return ctx;
	}

	/** Resolve the configured folder to a concrete id+name (creating if needed). */
	async #resolveFolder(
		client: DriveClient,
		config: GDriveAdapterConfig,
	): Promise<{ id: string; name: string }> {
		// `path` is typed as required but the form omits it when left blank.
		const raw = typeof config.path === 'string' ? config.path.trim() : '';

		if (raw && looksLikeDriveId(raw)) {
			const file = await client.getFile(raw);
			if (file.mimeType !== GDRIVE_FOLDER_MIME) {
				throw new Error('The provided Drive ID is not a folder');
			}
			return { id: file.id, name: file.name };
		}

		// Treat as a name or slash path under My Drive root; create as needed.
		const folderPath =
			raw !== '' ? raw : (config.folderName ?? DEFAULT_GDRIVE_FOLDER);
		const rootIndex = new PathIndex(client, 'root');
		const id = await rootIndex.ensureFolder(folderPath);
		return { id, name: basename(folderPath) };
	}
}
