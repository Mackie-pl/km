import { VAULT_ENTRY_TYPES, type VaultEntry } from './vault-entry';
import type { VaultStore } from './store';

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

	// ──────────────────────────────────────────────
	// Inbound sync — external file reconciliation
	// ──────────────────────────────────────────────

	/** Apply an external file change — delegates to case handlers. */
	async applyExternalFile(
		path: string,
		content: string,
		sourceAdapterId: string,
	): Promise<void> {
		const wsId = await this.init();
		if (!wsId) return;

		const existing = this.store.getByPath(path);

		if (!existing) {
			const name = path.split('/').pop() ?? '';
			const adapters = this.adaptersExcept(
				this.store.getActiveSyncAdapters(),
				sourceAdapterId,
			);
			await this.store.put(
				this.store.makeEntry({
					workspaceId: wsId,
					name,
					path,
					content,
					pendingAdapters: adapters,
				}),
			);
			return;
		}

		if (existing.deleted) {
			await this.store.put({
				...existing,
				content,
				deleted: false,
				...this.revisionSpread(existing, sourceAdapterId),
			});
			return;
		}

		console.log(
			`[Vault] External file entry detected for "${path}" from adapter "${sourceAdapterId}"`,
		);

		if (existing.pendingAdapters.length > 0) {
			console.warn(
				`[Vault] Local pending changes detected for "${path}" — checking for content conflicts`,
			);
			if (existing.content === content) {
				console.log(
					`[Vault] No content conflict for "${path}" — marking as synced with "${sourceAdapterId}"`,
				);
				await this.store.put({
					...existing,
					pendingAdapters: this.adaptersExcept(
						existing.pendingAdapters,
						sourceAdapterId,
					),
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
			return;
		}

		// Clean overwrite
		await this.store.put({
			...existing,
			content,
			...this.revisionSpread(existing, sourceAdapterId),
		});
	}

	private async handleExternalConflict(
		existing: VaultEntry,
		path: string,
		content: string,
		sourceAdapterId: string,
		wsId: string,
	): Promise<void> {
		const ext = existing.name.includes('.')
			? '.' + (existing.name.split('.').pop() ?? '')
			: '';
		const conflictName = `${existing.name.replace(/\.[^.]+$/, '')}.conflict-${sourceAdapterId}${ext}`;
		const conflictPath = existing.path.replace(existing.name, conflictName);
		const entry: VaultEntry = {
			id: crypto.randomUUID(),
			workspaceId: wsId,
			name: conflictName,
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
		console.warn(
			`[Vault] Conflict detected for "${path}" — created "${conflictName}"`,
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

		const folderEntry = this.store.makeEntry({
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
		if (!existing) return;

		const newName = newPath.split('/').pop() ?? '';

		if (existing.pendingAdapters.length > 0) {
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
			this.store.makeEntry({
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
			await this.cascadeRenameChildren(
				existing,
				oldPath,
				newPath,
				adapters,
			);
		}
	}

	private async cascadeRenameChildren(
		existing: VaultEntry,
		oldPath: string,
		newPath: string,
		activeAdapters: string[],
	): Promise<void> {
		const entriesSnapshot = this.store.getEntriesSnapshot();
		const children = Array.from(entriesSnapshot.values()).filter(
			(e) =>
				e.workspaceId === existing.workspaceId &&
				!e.deleted &&
				e.path.startsWith(oldPath + '/'),
		);

		for (const child of children) {
			const childNewPath = newPath + child.path.slice(oldPath.length);
			const childNewName = childNewPath.split('/').pop() ?? child.name;

			await this.store.put({
				...child,
				name: childNewName,
				path: childNewPath,
				updatedAt: Date.now(),
				revision: child.revision + 1,
				pendingAdapters: [
					...new Set([...child.pendingAdapters, ...activeAdapters]),
				],
			});
		}
	}
}
