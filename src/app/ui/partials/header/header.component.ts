import { Component, computed, inject, output, signal } from '@angular/core';
import { PlatformService } from '@services/platform.service';
import { WorkspaceService } from '@services/workspace.service';
import { SyncEngineService } from '@core/sync/sync-engine';
import { LucideMenu, LucideRefreshCw, LucideSettings } from '@lucide/angular';

/**
 * Top header bar — shows the app title, a hamburger menu on mobile,
 * and a settings gear icon.
 *
 * Purely presentational — emits events upward for sidebar toggle and settings.
 */
@Component({
	selector: 'app-header',
	standalone: true,
	imports: [LucideMenu, LucideRefreshCw, LucideSettings],
	templateUrl: './header.component.html',
	styleUrl: './header.component.scss',
})
export class HeaderComponent {
	readonly platformService = inject(PlatformService);
	private readonly workspaceService = inject(WorkspaceService);
	private readonly syncEngine = inject(SyncEngineService);

	/** Emitted when the hamburger menu is clicked (mobile only) */
	readonly toggleSidebar = output();

	/** Emitted when the settings gear is clicked */
	readonly openSettings = output();

	/** Whether the active workspace has any sync adapters. */
	readonly hasActiveAdapters = computed(() => {
		const ws = this.workspaceService.activeWorkspace();
		if (!ws) return false;
		return ws.activeSyncAdapters.length > 0;
	});

	/** Current sync status for the UI indicator. */
	readonly syncStatus = signal<
		'idle' | 'syncing' | 'needs-permission' | 'error'
	>('idle');

	/**
	 * Trigger a sync cycle (browser only — needs a user gesture for FS API permission).
	 */
	async syncNow(): Promise<void> {
		this.syncStatus.set('syncing');
		try {
			const ws = this.workspaceService.activeWorkspace();
			if (!ws) {
				this.syncStatus.set('idle');
				return;
			}

			await this.syncEngine.forcePull();
			await this.syncEngine.scheduleSync();
			this.syncStatus.set('idle');
		} catch {
			this.syncStatus.set('error');
		}
	}
}
