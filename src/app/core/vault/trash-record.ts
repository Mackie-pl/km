import type { VaultEntryType } from './vault-entry';

/**
 * One trashed entry, snapshotted at delete time into the device-local
 * IndexedDB `trash` store. Trash never syncs — it exists only on the device
 * that performed the delete (the deletion itself propagates to remotes).
 *
 * A folder delete produces one record per entry (the folder and every
 * descendant) sharing a `batchId`, so the whole delete restores atomically.
 */
export interface TrashRecord {
	/** The deleted entry's id (unique — entry ids are UUIDs). */
	id: string;
	workspaceId: string;
	/** Groups all records produced by a single delete action. */
	batchId: string;
	originalPath: string;
	name: string;
	type: VaultEntryType;
	content?: string;
	deletedAt: number;
}
