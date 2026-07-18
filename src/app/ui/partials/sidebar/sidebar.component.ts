import {
	Component,
	effect,
	inject,
	model,
	output,
	signal,
	computed,
	viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import {
	LucideArchive,
	LucideChevronLeft,
	LucideChevronRight,
	LucideFilePlus,
	LucideFolderPlus,
	LucideX,
	LucideSettings,
} from '@lucide/angular';
import { PlatformService } from '@services/platform.service';
import { WorkspaceService } from '@services/workspace.service';
import { SidebarVaultListComponent } from './sidebar-vault-list.component';
import { SidebarActivityLink } from './_activity-link';
import { BUILD_INFO } from '@build-info';

/**
 * Responsive sidebar component.
 *
 * Desktop: always visible, collapsible between expanded (w-64) and collapsed (w-16).
 * Mobile: hidden by default, opens as a fixed overlay when triggered.
 *
 * Sub-components handle the vault list; this component owns layout,
 * responsive state, and the archive/workspace footer buttons.
 */
@Component({
	selector: 'app-sidebar',
	standalone: true,
	imports: [
		LucideArchive,
		LucideChevronLeft,
		LucideChevronRight,
		LucideFilePlus,
		LucideFolderPlus,
		LucideX,
		LucideSettings,
		SidebarActivityLink,
		SidebarVaultListComponent,
	],
	templateUrl: './sidebar.component.html',
	styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
	private readonly platformService = inject(PlatformService);
	private readonly workspaceService = inject(WorkspaceService);
	private readonly router = inject(Router);

	/** Whether the sidebar is collapsed on desktop */
	readonly collapsed = model(false);

	/** Whether the mobile overlay is open */
	readonly mobileOpen = model(false);

	/** Emitted when the workspace config should be opened */
	readonly openWorkspaceConfig = output();

	readonly isDesktop = this.platformService.isDesktop;
	readonly activeWorkspace = this.workspaceService.activeWorkspace;

	/** The vault list — header New Folder / New File buttons delegate to it. */
	protected readonly vaultList = viewChild(SidebarVaultListComponent);

	/**
	 * Icon-rail layout active (labels hidden, icons centered).
	 * Follows collapsed() with a delay matching the 300ms width transition
	 * when collapsing — labels clip smoothly while the sidebar narrows —
	 * and clears immediately when expanding so labels grow with the width.
	 */
	protected readonly railMode = signal(this.collapsed());

	private railTimer: number | null = null;

	private readonly railModeEffect = effect(() => {
		const isCollapsed = this.collapsed();
		if (this.railTimer !== null) {
			window.clearTimeout(this.railTimer);
			this.railTimer = null;
		}
		if (!isCollapsed) {
			this.railMode.set(false);
			return;
		}
		this.railTimer = window.setTimeout(() => {
			this.railMode.set(true);
			this.railTimer = null;
		}, 300);
	});

	/** App version, stamped at build time (see build-info.ts) */
	readonly appVersion = BUILD_INFO.version;

	/** Derive the currently-viewed entry path from the router URL, or null if not on an editor route. */
	readonly activeEntryPath = computed(() => {
		const prefix = '/e/';
		const url = this.currentUrl();
		if (!url.startsWith(prefix)) return null;
		return url.slice(prefix.length);
	});

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

	// ---- Mobile swipe-to-close ----

	private touchStartX = 0;

	onTouchStart(event: TouchEvent): void {
		this.touchStartX = event.touches[0]?.clientX ?? 0;
	}

	onTouchEnd(event: TouchEvent): void {
		const deltaX = event.changedTouches[0]?.clientX ?? 0 - this.touchStartX;
		if (deltaX < -60) {
			this.closeMobile();
		}
	}

	toggleCollapsed(): void {
		this.collapsed.update((v) => !v);
	}

	closeMobile(): void {
		this.mobileOpen.set(false);
	}

	openWorkspaceConfigDialog(): void {
		this.openWorkspaceConfig.emit();
	}
}
