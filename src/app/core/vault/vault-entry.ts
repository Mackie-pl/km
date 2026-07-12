// vault-entry.ts

export const VAULT_ENTRY_TYPES = { FILE: 'file', FOLDER: 'folder' } as const;
export type VaultEntryType =
	(typeof VAULT_ENTRY_TYPES)[keyof typeof VAULT_ENTRY_TYPES];

export interface VaultEntry {
	id: string;
	workspaceId: string;
	name: string;
	path: string;
	parentId: string | null;
	type: VaultEntryType;
	content?: string;
	createdAt: number;
	updatedAt: number;
	/** Adapter IDs that still need to receive this entry. Empty = fully synced. */
	pendingAdapters: string[];
	/**
	 * Per-adapter hash of the content last known to be in sync with that
	 * adapter (the merge "base"). Lets the reconciler distinguish a remote
	 * that actually changed from one that is merely behind a pending local
	 * edit — only the former is a real conflict.
	 */
	syncedHashes?: Record<string, string>;
	/** If set, the entry was renamed from this path — push phase calls rename() instead of write(). */
	pendingRenameFrom?: string;
	deleted: boolean;
	revision: number;
}
