/**
 * Google Drive watcher — detects inbound changes via the Changes API.
 *
 * The Changes feed is account-wide, so each poll filters changes to our
 * workspace subtree (by known folder/file ids). When something relevant moves,
 * the {@link PathIndex} is rebuilt and diffed against its previous snapshot to
 * emit precise create/modify/delete {@link WatchEvent}s — the same shape the git
 * adapter produces. Content for create/modify is re-read by the sync layer via
 * `adapter.read`, which resolves against the now-current shared index.
 *
 * Scheduling (interval, backoff, visibility pause) is delegated to the shared
 * {@link createBackoffPoller}. This is best-effort: the sync engine also
 * force-pulls browser adapters on tab focus, covering anything missed here.
 */

import type { WatchEvent } from '../../adapter.interface';
import { createBackoffPoller } from '../backoff-poller';
import type { DriveChange, DriveClient } from './drive-client';
import type { IndexedEntry, PathIndex } from './path-index';

export interface DriveWatcher {
	start(callback: (events: WatchEvent[]) => void): void;
	stop(): void;
}

/** Compare two path→node snapshots into precise file-level watch events. */
function diffSnapshots(
	before: Map<string, IndexedEntry>,
	after: Map<string, IndexedEntry>,
): WatchEvent[] {
	const events: WatchEvent[] = [];
	for (const [path, node] of after) {
		if (node.isFolder) continue;
		const prev = before.get(path);
		if (!prev) {
			events.push({ type: 'create', path });
		} else if (node.md5 !== prev.md5 || node.modifiedTime !== prev.modifiedTime) {
			events.push({ type: 'modify', path });
		}
	}
	for (const path of before.keys()) {
		if (!after.has(path)) events.push({ type: 'delete', path });
	}
	return events;
}

export function createDriveWatcher(
	client: DriveClient,
	index: PathIndex,
	pollIntervalMs: number,
): DriveWatcher {
	let pageToken: string | null = null;
	let callback: ((events: WatchEvent[]) => void) | null = null;

	const snapshot = (): Map<string, IndexedEntry> => {
		const map = new Map<string, IndexedEntry>();
		for (const entry of index.listDir('', true)) map.set(entry.path, entry);
		return map;
	};

	const isRelevant = (changes: DriveChange[]): boolean => {
		const allIds = new Set<string>([index.rootFolderId]);
		const folderIds = new Set<string>([index.rootFolderId]);
		for (const entry of index.listDir('', true)) {
			allIds.add(entry.id);
			if (entry.isFolder) folderIds.add(entry.id);
		}
		return changes.some(
			(c) =>
				(c.fileId !== undefined && allIds.has(c.fileId)) ||
				(c.file?.parents ?? []).some((p) => folderIds.has(p)),
		);
	};

	/** Drain all change pages from `from`, returning them + the next baseline. */
	const drainChanges = async (
		from: string,
	): Promise<{ changes: DriveChange[]; nextToken: string }> => {
		const changes: DriveChange[] = [];
		let token = from;
		for (;;) {
			const res = await client.listChanges(token);
			changes.push(...(res.changes ?? []));
			if (res.nextPageToken) {
				token = res.nextPageToken;
			} else {
				return { changes, nextToken: res.newStartPageToken ?? token };
			}
		}
	};

	const emitDiff = async (): Promise<void> => {
		const before = snapshot();
		index.invalidate();
		await index.ensureBuilt();
		const events = diffSnapshots(before, snapshot());
		if (events.length > 0) callback?.(events);
	};

	const poll = async (): Promise<void> => {
		// Seed the baseline so we only react to changes from now on.
		if (pageToken === null) {
			pageToken = await client.getStartPageToken();
			return;
		}
		const { changes, nextToken } = await drainChanges(pageToken);
		pageToken = nextToken;
		if (changes.length > 0 && isRelevant(changes)) {
			await emitDiff();
		}
	};

	const poller = createBackoffPoller({ poll, baseIntervalMs: pollIntervalMs });

	return {
		start: (cb: (events: WatchEvent[]) => void) => {
			callback = cb;
			// Kick off baseline acquisition eagerly (poll also self-seeds).
			void client
				.getStartPageToken()
				.then((t) => (pageToken = t))
				.catch(() => {
					/* poll() will retry seeding */
				});
			poller.start();
		},
		stop: () => {
			poller.stop();
			callback = null;
		},
	};
}
