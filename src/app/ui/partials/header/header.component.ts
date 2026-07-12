import { Component, computed, inject, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { PlatformService } from '@services/platform.service';
import { WorkspaceService } from '@services/workspace.service';
import { SyncEngineService } from '@core/sync/sync-engine';
import {
	LucideChevronLeft,
	LucideCloud,
	LucideRefreshCw,
	LucideSearch,
	LucideSettings,
} from '@lucide/angular';
import { SearchService } from '@core/services/search.service';
import { AgentsService } from '@core/agents/agents.service';
import { AskButtonComponent } from '@ui/partials/ask-button/ask-button.component';
import { gdriveAuth } from '@core/adapters/cloud/gdrive/auth-provider';

interface Breadcrumb {
	parents: string;
	current: string;
}

/**
 * Top header bar — breadcrumb for the current location, a back button on
 * mobile (to the vault home screen), and the search / Ask / settings actions.
 *
 * The "Sync now" button is shown only when background auto-sync has failed.
 */
@Component({
	selector: 'app-header',
	standalone: true,
	imports: [
		LucideChevronLeft,
		LucideCloud,
		LucideRefreshCw,
		LucideSearch,
		LucideSettings,
		AskButtonComponent,
	],
	templateUrl: './header.component.html',
	styleUrl: './header.component.scss',
})
export class HeaderComponent {
	readonly platformService = inject(PlatformService);
	readonly syncEngine = inject(SyncEngineService);
	readonly searchService = inject(SearchService);
	private readonly workspaceService = inject(WorkspaceService);
	private readonly agentsService = inject(AgentsService);
	private readonly router = inject(Router);

	/** Set when Google Drive's token expired and a manual reconnect is needed. */
	readonly gdriveNeedsReauth = gdriveAuth.needsReauth;

	/**
	 * Show the reconnect prompt only when the CURRENT workspace actually uses
	 * Drive. The reauth flag is a global singleton, so without this gate a stale
	 * flag from another (or a since-removed) Drive workspace would surface on a
	 * workspace that has no Drive adapter at all.
	 */
	readonly showReconnect = computed(
		() =>
			this.gdriveNeedsReauth() &&
			(this.workspaceService
				.activeWorkspace()
				?.activeSyncAdapters.includes('gdrive') ??
				false),
	);

	/** Emitted when the settings gear is clicked */
	readonly openSettings = output();

	/** Mobile back button → returns to the vault home screen. */
	goBackToVault(): void {
		void this.router.navigate(['/vault']);
	}

	/** Signal that stays in sync with the current router URL. */
	private readonly currentUrl = signal(this.router.url);

	constructor() {
		this.router.events
			.pipe(
				filter(
					(event): event is NavigationEnd =>
						event instanceof NavigationEnd,
				),
				takeUntilDestroyed(),
			)
			.subscribe((event: NavigationEnd) => {
				this.currentUrl.set(event.urlAfterRedirects);
			});
	}

	/** Fixed labels for static routes, matched by URL prefix. */
	private static readonly STATIC_LABELS: [prefix: string, label: string][] = [
		['/activity', 'Activity'],
		['/settings', 'Settings'],
		['/workspace/new', 'New Workspace'],
		['/workspace', 'Workspaces'],
	];

	/**
	 * Breadcrumb for the current location: parent segments (muted) and the
	 * current page name. Note paths come from /e/<path> URLs; static routes
	 * get fixed labels.
	 */
	readonly breadcrumb = computed<Breadcrumb>(() => {
		const url = decodeURIComponent(this.currentUrl());
		if (url.startsWith('/e/')) return this.noteBreadcrumb(url);
		if (url.startsWith('/agent/')) return this.agentBreadcrumb(url);
		const label = HeaderComponent.STATIC_LABELS.find(([prefix]) =>
			url.startsWith(prefix),
		)?.[1];
		return {
			parents: '',
			current:
				label ??
				this.workspaceService.activeWorkspace()?.name ??
				'Notes',
		};
	});

	private noteBreadcrumb(url: string): Breadcrumb {
		const segments = url.slice(3).split('/');
		const name = (segments.pop() ?? '').replace(/\.md$/i, '');
		return { parents: segments.join(' / '), current: name };
	}

	private agentBreadcrumb(url: string): Breadcrumb {
		const agent = this.agentsService.agentById(url.slice(7));
		return { parents: agent?.scope ?? '', current: agent?.name ?? 'Agent' };
	}

	/** Open the search overlay. */
	openSearch(): void {
		this.searchService.open();
	}

	/**
	 * Trigger a sync cycle (browser only — needs a user gesture for FS API permission).
	 * The engine manages its own syncFailed / isSyncing / lastSyncError signals.
	 */
	async syncNow(): Promise<void> {
		await this.syncEngine.syncAll();
	}

	/**
	 * Interactive Google sign-in (this click is the required user gesture), then
	 * re-run sync. Used when a background renewal couldn't get a token silently.
	 */
	async reconnectGDrive(): Promise<void> {
		await gdriveAuth.reconnect();
		await this.syncEngine.syncAll();
	}
}
