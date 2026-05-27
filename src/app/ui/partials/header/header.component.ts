import { Component, inject, output } from '@angular/core';
import { PlatformService } from '@services/platform.service';
import { SyncEngineService } from '@core/sync/sync-engine';
import { LucideMenu, LucideRefreshCw, LucideSettings } from '@lucide/angular';

/**
 * Top header bar — shows the app title, a hamburger menu on mobile,
 * and a settings gear icon.
 *
 * Purely presentational — emits events upward for sidebar toggle and settings.
 * The "Sync now" button is shown only when background auto-sync has failed.
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
	readonly syncEngine = inject(SyncEngineService);

	/** Emitted when the hamburger menu is clicked (mobile only) */
	readonly toggleSidebar = output();

	/** Emitted when the settings gear is clicked */
	readonly openSettings = output();

	/**
	 * Trigger a sync cycle (browser only — needs a user gesture for FS API permission).
	 * The engine manages its own syncFailed / isSyncing / lastSyncError signals.
	 */
	async syncNow(): Promise<void> {
		await this.syncEngine.syncAll();
	}
}
