import { inject, Injectable, signal } from '@angular/core';
import { AdaptersManager } from '@core/adapters/manager';
import {
	type AdapterConfig,
	getAdapterRoot,
} from '@core/adapters/adapter.interface';
import { WorkspaceService, type Workspace } from './workspace.service';

/**
 * Guards against a workspace whose folder access was lost out-of-band.
 *
 * On Android, a folder's SAF permission grant can disappear independently of
 * the persisted workspace list (app reinstall → new UID, the user revoking
 * access in system Settings, a backup restored to another device, or hitting
 * Android's persisted-URI limit). When that happens the workspace still looks
 * present but every read/write fails with an opaque `Permission Denial` deep
 * in the sync engine.
 *
 * This service verifies access when a workspace becomes active and, if the
 * grant is gone, surfaces a prompt to re-pick the folder (re-picking the same
 * folder re-grants access). Desktop adapters report access as always-OK, so
 * this is effectively an Android-only safety net.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceAccessService {
	private readonly workspaceService = inject(WorkspaceService);
	private readonly adapterManager = inject(AdaptersManager);

	/** Workspace whose folder access was lost; null when access is fine. */
	readonly accessLost = signal<Workspace | null>(null);

	/** Whether a re-pick is currently in progress. */
	readonly repicking = signal(false);

	/** Last re-pick error, surfaced for diagnostics. */
	readonly repickError = signal<string | null>(null);

	/**
	 * Verify `ws` still has access to each of its folder-backed adapter roots.
	 * Flags the workspace via {@link accessLost} on the first failed check.
	 * A workspace with no access-gated adapter (standalone / cloud-only) passes.
	 */
	async verify(ws: Workspace): Promise<void> {
		for (const config of ws.adapterConfigs) {
			const [adapter] = this.adapterManager.getAdaptersByIds([
				config.adapterId,
			]);
			if (!adapter?.verifyAccess) continue;

			const root = getAdapterRoot(config);
			if (!root) continue;

			const ok = await adapter.verifyAccess(root);
			if (!ok) {
				this.accessLost.set(ws);
				return;
			}
		}

		// Everything checked out — clear a prior flag for this workspace
		// (e.g. after a successful re-pick re-activated it).
		if (this.accessLost()?.id === ws.id) {
			this.accessLost.set(null);
		}
	}

	/**
	 * Re-run the folder picker to restore a lost grant, repointing the flagged
	 * workspace's folder config at the freshly-picked root. Re-picking the same
	 * folder re-grants SAF access; picking a different one moves the workspace.
	 */
	async repick(): Promise<void> {
		const ws = this.accessLost();
		if (!ws || this.repicking()) return;

		const adapter = this.adapterManager.getWorkspacePickerAdapter();
		if (!adapter) return;

		this.repicking.set(true);
		this.repickError.set(null);
		try {
			const result = await adapter.pickWorkspaceFolder();
			if (!result) {
				this.repickError.set('No folder selected.');
				return;
			}
			// Upsert the folder config with the new root. This mutates the
			// active-workspace signal, which re-triggers sync activation (and,
			// via the app-shell effect, a fresh access verification).
			this.workspaceService.setAdapterConfig(ws.id, {
				adapterId: adapter.id,
				path: result.path,
			} as AdapterConfig);
			this.accessLost.set(null);
		} catch (err) {
			this.repickError.set(
				err instanceof Error ? err.message : String(err),
			);
		} finally {
			this.repicking.set(false);
		}
	}

	/** Dismiss the prompt without re-granting (sync will keep failing). */
	dismiss(): void {
		this.accessLost.set(null);
	}
}
