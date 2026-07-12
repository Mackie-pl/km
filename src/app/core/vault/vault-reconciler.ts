import { isTempFilePath } from '@core/utils/file-patterns';
import { VAULT_ENTRY_TYPES, type VaultEntry } from './vault-entry';
import {
	hashContent,
	makeConflictName,
	makeVaultEntry,
	resolveUniquePath,
} from './vault-utils';
import type { VaultStore } from './store';
import { debugLog } from '@core/utils/debug-logger';

/**
 * Handles inbound sync reconciliation for VaultStore.
 *
 * Responsible for applying external file/folder/rename changes detected
 * during pull or watch events. Conflict resolution creates `.conflict-*`
 * copies when local changes are pending.
 *
 * This is a plain class instantiated by VaultStore — not an Angular service.
 */
export class VaultReconciler {
	constructor(private readonly store: VaultStore) {}

	// ──────────────────────────────────────────────
	// Helpers
	// ──────────────────────────────────────────────

	/**
	 * Standard preamble for inbound methods: ensure initialized and get wsId.
	 * Returns undefined if no workspace active.
	 */
	private async init(): Promise<string | null> {
		await this.store.ensureInitialized();
		return this.store.activeWorkspaceId();
	}

	/** Filter adapters except the source, preferring workspace adapters. */
	private adaptersExcept(adapterIds: string[], sourceId: string): string[] {
		return adapterIds.filter((a) => a !== sourceId);
	}

	/** Spread `updatedAt`, `revision+1`, and filtered pendingAdapters. */
	private revisionSpread(
		entry: VaultEntry,
		sourceAdapterId: string,
	): Partial<VaultEntry> {
		return {
			updatedAt: Date.now(),
			revision: entry.revision + 1,
			pendingAdapters: this.adaptersExcept(
				entry.pendingAdapters,
				sourceAdapterId,
			),
		};
	}

	/** Merge the just-seen remote content hash into an entry's sync bases. */
	private withSyncedHash(
		entry: Pick<VaultEntry, 'syncedHashes'>,
		sourceAdapterId: string,
		content: string,
	): Record<string, string> {
		return {
			...entry.syncedHashes,
			[sourceAdapterId]: hashContent(content),
		};
	}

	// ──────────────────────────────────────────────
	// Inbound sync — external file reconciliation
	// ──────────────────────────────────────────────

	/** Apply an external file change — delegates to case handlers. */
	async applyExternalFile(
		path: string,
		content: string,
		sourceAdapterId: string,
	): Promise<void> {
		// Defense: never create vault entries for temp/swap files.
		// The adapter should filter these, but this is an extra safety net.
		if (isTempFilePath(path)) return;

		const wsId = await this.init();
		if (!wsId) return;

		const existing = this.store.getByPath(path);

		if (!existing) {
			debugLog(
				`[Vault] new entry "${path}" from ${sourceAdapterId} (${String(content.length)}B)`,
			);
			await this.#applyNewExternalFile(
				path,
				content,
				sourceAdapterId,
				wsId,
			);
			return;
		}

		if (existing.deleted) {
			debugLog(
				`[Vault] restore "${path}" (was deleted) from ${sourceAdapterId} — entry ${existing.id}`,
			);
			await this.#restoreDeletedFile(existing, content, sourceAdapterId);
			return;
		}

		if (existing.pendingAdapters.length > 0) {
			debugLog(
				`[Vault] reconcile "${path}" from ${sourceAdapterId} — pending ${JSON.stringify(existing.pendingAdapters)}, content ${String(content.length)}B vs vault ${String((existing.content ?? '').length)}B`,
			);
			await this.#handleExternalFileWithPendingChanges(
				existing,
				path,
				content,
				sourceAdapterId,
				wsId,
			);
			return;
		}

		// Clean overwrite — skip if content hasn't actually changed
		// (avoiding revision-bombing from polling / repeated reads)
		if (existing.content === content) {
			debugLog(
				`[Vault] skip "${path}" from ${sourceAdapterId} — content unchanged (rev ${String(existing.revision)})`,
			);
			return;
		}

		debugLog(
			`[Vault] overwrite "${path}" from ${sourceAdapterId} — entry ${existing.id} rev ${String(existing.revision)}→${String(existing.revision + 1)}`,
		);
		await this.store.put({
			...existing,
			content,
			syncedHashes: this.withSyncedHash(existing, sourceAdapterId, content),
			...this.revisionSpread(existing, sourceAdapterId),
		});
	}

	/** Create a new entry for an external file that doesn't exist in the vault. */
	async #applyNewExternalFile(
		path: string,
		content: string,
		sourceAdapterId: string,
		wsId: string,
	): Promise<void> {
		const name = path.split('/').pop() ?? '';
		const adapters = this.adaptersExcept(
			this.store.getActiveSyncAdapters(),
			sourceAdapterId,
		);
		const parentPath = path.includes('/')
			? path.slice(0, path.lastIndexOf('/'))
			: '';
		const parentEntry = parentPath
			? this.store.getByPath(parentPath)
			: null;
		const entry = makeVaultEntry({
			workspaceId: wsId,
			name,
			path,
			content,
			pendingAdapters: adapters,
			parentId: parentEntry?.id ?? null,
		});
		entry.syncedHashes = { [sourceAdapterId]: hashContent(content) };
		debugLog(
			`[Vault] created entry ${entry.id} "${path}"${parentPath ? ` parent=${parentPath}` : ''} pending=${JSON.stringify(adapters)}`,
		);
		await this.store.put(entry);
	}

	/** Restore a soft-deleted entry when the external file reappears. */
	async #restoreDeletedFile(
		existing: VaultEntry,
		content: string,
		sourceAdapterId: string,
	): Promise<void> {
		await this.store.put({
			...existing,
			content,
			deleted: false,
			syncedHashes: this.withSyncedHash(existing, sourceAdapterId, content),
			...this.revisionSpread(existing, sourceAdapterId),
		});
		debugLog(
			`[Vault] restored "${existing.path}" entry ${existing.id} (was deleted)`,
		);
	}

	/** Handle external file when local pending changes exist — may create conflict copy. */
	async #handleExternalFileWithPendingChanges(
		existing: VaultEntry,
		path: string,
		content: string,
		sourceAdapterId: string,
		wsId: string,
	): Promise<void> {
		debugLog(
			`[Vault] Checking content conflict for "${path}" (pending adapters: ${String(existing.pendingAdapters)})`,
		);
		if (existing.content === content) {
			debugLog(
				`[Vault] conflict-free "${path}" — content matches, clearing ${sourceAdapterId} from pending ${JSON.stringify(existing.pendingAdapters)}`,
			);
			await this.store.put({
				...existing,
				syncedHashes: this.withSyncedHash(
					existing,
					sourceAdapterId,
					content,
				),
				pendingAdapters: this.adaptersExcept(
					existing.pendingAdapters,
					sourceAdapterId,
				),
			});
			return;
		}

		// Remote content is identical to what we last synced with this adapter:
		// the remote is merely BEHIND the pending local edit, not diverged.
		// Keep the local content pending — the push phase will update remote.
		// Without this check every pull that lands before a push completes
		// would spawn a bogus `.conflict-*` copy of the stale remote content.
		const base = existing.syncedHashes?.[sourceAdapterId];
		if (base !== undefined && base === hashContent(content)) {
			debugLog(
				`[Vault] stale remote "${path}" from ${sourceAdapterId} — matches last-synced base, keeping pending local edit (no conflict)`,
			);
			return;
		}

		// Local content is exactly what we last synced with this adapter, but the
		// remote moved forward: there is NO unsynced local edit for THIS adapter to
		// lose, so fast-forward to the remote instead of forking a conflict copy.
		// The entry may still be pending for OTHER adapters (e.g. a broken gdrive);
		// `revisionSpread` keeps those pending so the newer content propagates on.
		if (base !== undefined && base === hashContent(existing.content ?? '')) {
			debugLog(
				`[Vault] fast-forward "${path}" from ${sourceAdapterId} — local matches last-synced base, adopting newer remote content`,
			);
			await this.store.put({
				...existing,
				content,
				syncedHashes: this.withSyncedHash(
					existing,
					sourceAdapterId,
					content,
				),
				...this.revisionSpread(existing, sourceAdapterId),
			});
			return;
		}

		await this.handleExternalConflict(
			existing,
			path,
			content,
			sourceAdapterId,
			wsId,
		);
	}

	private async handleExternalConflict(
		existing: VaultEntry,
		path: string,
		content: string,
		sourceAdapterId: string,
		wsId: string,
	): Promise<void> {
		// Never nest suffixes (`x.conflict-a.conflict-a.md`) and never reuse a
		// taken path — a second conflict on the same file dedupes to `… (2)`.
		const conflictName = makeConflictName(existing.name, sourceAdapterId);
		const conflictPath = resolveUniquePath(
			existing.path.replace(existing.name, conflictName),
			(p) => this.store.getByPath(p),
		);
		const entry: VaultEntry = {
			id: crypto.randomUUID(),
			workspaceId: wsId,
			name: conflictPath.split('/').pop() ?? conflictName,
			path: conflictPath,
			type: VAULT_ENTRY_TYPES.FILE,
			parentId: existing.parentId,
			content,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			pendingAdapters: [],
			deleted: false,
			revision: 1,
		};
		await this.store.put(entry);
		// The conflicting remote version is now preserved in the copy; treat it
		// as the new base so the same remote content can't re-conflict, and so
		// the pending local edit wins the next push cleanly.
		await this.store.put({
			...existing,
			syncedHashes: this.withSyncedHash(existing, sourceAdapterId, content),
		});
		console.warn(
			`[Vault] Conflict "${path}": local vs ${sourceAdapterId} — created "${entry.name}" (${String(content.length)}B)`,
		);
	}

	// ──────────────────────────────────────────────
	// Inbound sync — external folder reconciliation
	// ──────────────────────────────────────────────

	/**
	 * Apply an external directory discovered during pull.
	 *
	 * If a folder entry already exists at this path: skip (already imported).
	 * If a file entry exists at this path: warn and skip (type conflict).
	 * Otherwise: create a new folder entry.
	 */
	async applyExternalFolder(
		path: string,
		sourceAdapterId: string,
	): Promise<void> {
		const wsId = await this.init();
		if (!wsId) return;

		const existing = this.store.getByPath(path);
		if (existing) {
			if (existing.type === VAULT_ENTRY_TYPES.FOLDER) return;
			console.warn(
				`[Vault] Path "${path}" is a file locally but external source has it as a directory — skipping`,
			);
			return;
		}

		const folderName = path.split('/').pop() ?? '';
		const folderAdapters = this.adaptersExcept(
			this.store.getActiveSyncAdapters(),
			sourceAdapterId,
		);

		const folderEntry = makeVaultEntry({
			workspaceId: wsId,
			name: folderName,
			path,
			type: VAULT_ENTRY_TYPES.FOLDER,
			pendingAdapters: folderAdapters,
		});
		await this.store.put(folderEntry);
	}

	// ──────────────────────────────────────────────
	// Inbound sync — external rename reconciliation
	// ──────────────────────────────────────────────

	/** Apply an external rename — delegates to case handlers. */
	async applyExternalRename(
		oldPath: string,
		newPath: string,
		sourceAdapterId: string,
	): Promise<void> {
		const wsId = await this.init();
		if (!wsId) return;

		const existing = this.store.getByPath(oldPath);
		if (!existing) {
			debugLog(
				`[Vault] rename skip: "${oldPath}" → "${newPath}" from ${sourceAdapterId} — no vault entry at old path`,
			);
			return;
		}

		const newName = newPath.split('/').pop() ?? '';

		if (existing.pendingAdapters.length > 0) {
			debugLog(
				`[Vault] rename conflict "${oldPath}" → "${newPath}" from ${sourceAdapterId} — pending ${JSON.stringify(existing.pendingAdapters)}`,
			);
			await this.handleExternalRenameConflict(
				existing,
				oldPath,
				newPath,
				newName,
				wsId,
				sourceAdapterId,
			);
			return;
		}

		debugLog(
			`[Vault] rename clean "${oldPath}" → "${newPath}" from ${sourceAdapterId} — entry ${existing.id}`,
		);
		await this.handleCleanExternalRename(
			existing,
			oldPath,
			newPath,
			newName,
			wsId,
			sourceAdapterId,
		);
	}

	private async handleExternalRenameConflict(
		existing: VaultEntry,
		_oldPath: string,
		newPath: string,
		newName: string,
		wsId: string,
		sourceAdapterId: string,
	): Promise<void> {
		const adapters = this.adaptersExcept(
			this.store.getActiveSyncAdapters(),
			sourceAdapterId,
		);
		await this.store.put(
			makeVaultEntry({
				workspaceId: wsId,
				name: newName,
				path: newPath,
				content: existing.content ?? '',
				pendingAdapters: adapters,
			}),
		);
		console.warn(
			`[Vault] External rename conflict for "${_oldPath}" → "${newPath}" — local changes preserved`,
		);
	}

	private async handleCleanExternalRename(
		existing: VaultEntry,
		oldPath: string,
		newPath: string,
		newName: string,
		wsId: string,
		sourceAdapterId: string,
	): Promise<void> {
		const adapters = this.store.getActiveSyncAdapters();

		const updated: VaultEntry = {
			...existing,
			name: newName,
			path: newPath,
			updatedAt: Date.now(),
			revision: existing.revision + 1,
			pendingAdapters: this.adaptersExcept(adapters, sourceAdapterId),
		};

		await this.store.put(updated);

		if (existing.type === VAULT_ENTRY_TYPES.FOLDER) {
			await this.store.cascadeRenameChildren(
				existing,
				oldPath,
				newPath,
				adapters,
			);
		}
	}
}
