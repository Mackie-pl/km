import { TuiRoot } from '@taiga-ui/core/components/root';
import { TuiDialogService } from '@taiga-ui/core/portals/dialog';
import { PolymorpheusComponent } from '@taiga-ui/polymorpheus';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Menu, MenuItem, Submenu } from '@tauri-apps/api/menu';
import { PlatformService } from '@services/platform.service';
import { ThemeService } from '@services/theme.service';
import { VaultStore } from '@vault/store';
import { WorkspaceService } from '@services/workspace.service';
import { AndroidOpenFileService } from '@services/android-open-file.service';
import { WorkspaceAccessService } from '@services/workspace-access.service';
import { SettingsComponent } from '@ui/pages/settings/settings.component';
import { WorkspaceConfig } from '@ui/pages/workspace-config/workspace-config';
import { SidebarComponent } from '@ui/partials/sidebar/sidebar.component';
import { HeaderComponent } from '@ui/partials/header/header.component';
import { NoWorkspaceComponent } from './no-workspace/no-workspace.component';
import { TopNotificationsComponent } from '@ui/partials/top-notifications/top-notifications.component';
import { SearchOverlayComponent } from '@ui/partials/search-overlay/search-overlay.component';
import { SearchService } from '@core/services/search.service';

/**
 * App shell — sidebar + header + main content area.
 *
 * On desktop (Windows/Linux): sidebar is always visible and collapsible.
 * On mobile (Android): sidebar is hidden; opened via hamburger icon + swipe to close.
 *
 * When no workspace is selected, shows a full-screen picker overlay instead.
 */
@Component({
	selector: 'app-root',
	standalone: true,
	imports: [
		RouterOutlet,
		TuiRoot,
		SidebarComponent,
		HeaderComponent,
		NoWorkspaceComponent,
		TopNotificationsComponent,
		SearchOverlayComponent,
	],
	templateUrl: './app.component.html',
	styleUrl: './app.component.scss',
	host: {
		'(document:keydown.meta.k)': 'onSearchShortcut($event)',
		'(document:keydown.control.k)': 'onSearchShortcut($event)',
	},
})
export class AppComponent {
	private readonly router = inject(Router);
	readonly platformService = inject(PlatformService);
	private readonly dialogService = inject(TuiDialogService);
	readonly workspaceService = inject(WorkspaceService);
	private readonly vaultDb = inject(VaultStore);
	readonly searchService = inject(SearchService);
	readonly androidOpenFileService = inject(AndroidOpenFileService);
	readonly workspaceAccessService = inject(WorkspaceAccessService);

	private nativeMenuInitialized = false;

	/** Inject to ensure ThemeService is constructed at app boot — applies the
	 *  persisted/system theme to <html> immediately on startup. */
	private readonly _theme = inject(ThemeService);

	/** Keeps in sync with the current router URL (for reactive shell layout). */
	private readonly currentUrl = signal(this.router.url);

	/** Chrome (sidebar/header) shows once a workspace is active, outside the wizard. */
	private readonly showChrome = computed(
		() =>
			!!this.workspaceService.activeWorkspace() && !this.isOnWizardRoute(),
	);

	/** True on the mobile vault home screen, which renders its own header. */
	private readonly isOnVaultRoute = computed(() =>
		this.currentUrl().startsWith('/vault'),
	);

	/** Sidebar is desktop-only now; mobile uses the full-screen vault browser. */
	readonly showSidebar = computed(
		() => this.showChrome() && !this.platformService.isMobile(),
	);

	/** Header hides on the mobile vault screen (it has its own header). */
	readonly showHeader = computed(
		() =>
			this.showChrome() &&
			!(this.platformService.isMobile() && this.isOnVaultRoute()),
	);

	constructor() {
		// Keep the URL signal current so the shell layout reacts to navigation.
		this.router.events
			.pipe(
				filter(
					(e): e is NavigationEnd => e instanceof NavigationEnd,
				),
				takeUntilDestroyed(),
			)
			.subscribe((e) => {
				this.currentUrl.set(e.urlAfterRedirects);
			});

		// Mobile: the vault browser is the home screen, so send the empty root
		// (the `**` fallback) there instead of the desktop "Add a note" page.
		effect(() => {
			const url = this.currentUrl();
			if (
				this.platformService.isMobile() &&
				this.workspaceService.activeWorkspace() &&
				(url === '/' || url === '')
			) {
				void this.router.navigate(['/vault']);
			}
		});

		// Defer vault (IndexedDB) initialization until a workspace is active.
		// This prevents loading entries for no workspace, and ensures the vault
		// always scopes data to the current workspace.
		let vaultWatchEnabled = false;
		effect(() => {
			const ws = this.workspaceService.activeWorkspace();
			if (!ws || vaultWatchEnabled) return;
			vaultWatchEnabled = true;
			void this.vaultDb.init();
		});

		// Verify folder access whenever the active workspace changes. On Android
		// a SAF grant can be lost out-of-band (reinstall, revoked in Settings,
		// backup restore); this surfaces a re-pick prompt instead of letting
		// file I/O fail cryptically. No-op for non-folder / desktop workspaces.
		effect(() => {
			const ws = this.workspaceService.activeWorkspace();
			if (!ws) return;
			void this.workspaceAccessService.verify(ws);
		});

		effect(() => {
			console.warn(
				'Platform detected:',
				this.platformService.platform(),
				this.platformService.isDesktopTauri(),
			);
			if (this.nativeMenuInitialized) {
				return;
			}

			if (!this.platformService.detected()) {
				return;
			}

			if (!this.platformService.isDesktopTauri()) {
				return;
			}

			this.nativeMenuInitialized = true;
			this.initNativeMenu().catch((error: unknown) => {
				console.error('Failed to initialize native menu:', error);
			});
		});

		// Handle the case where Android launched us via "Open with" on a
		// .md file. No-op on desktop / when there's no pending intent.
		this.androidOpenFileService.handleAppLaunch().catch((error: unknown) => {
			console.error('Failed to handle Android open-file intent:', error);
		});
	}

	/** Open the search overlay on Cmd+K / Ctrl+K. */
	onSearchShortcut(event: Event): void {
		event.preventDefault();
		this.searchService.open();
	}

	/** Whether the sidebar is collapsed on desktop (visible by default) */
	readonly sidebarCollapsed = signal(false);

	/** Whether the current route is the workspace creation wizard */
	isOnWizardRoute(): boolean {
		return this.currentUrl().startsWith('/workspace/new');
	}

	/**
	 * Opens the workspace creation wizard.
	 */
	openWorkspacePicker(): void {
		void this.router.navigate(['/workspace/new']);
	}

	/**
	 * Opens the settings screen.
	 *
	 * Desktop → Taiga UI modal dialog (overlay with backdrop)
	 * Mobile  → Angular router navigation (full page with back button)
	 */
	openSettings(): void {
		if (this.platformService.isMobile()) {
			void this.router.navigate(['/settings']);
		} else {
			this.dialogService
				.open(new PolymorpheusComponent(SettingsComponent), {
					size: 'm',
					dismissible: true,
					label: 'Settings',
				})
				.subscribe();
		}
	}

	/**
	 * Opens the workspace config screen.
	 *
	 * Desktop → Taiga UI modal dialog (overlay with backdrop)
	 * Mobile  → Angular router navigation (full page with back button)
	 */
	openWorkspaceConfig(): void {
		if (this.platformService.isMobile()) {
			void this.router.navigate(['/workspace']);
		} else {
			this.dialogService
				.open(new PolymorpheusComponent(WorkspaceConfig), {
					size: 'm',
					dismissible: true,
					label: 'Workspaces',
				})
				.subscribe();
		}
	}

	private async initNativeMenu(): Promise<void> {
		const settingsItem = await MenuItem.new({
			id: 'settings',
			text: 'Settings',
			action: () => {
				this.openSettings();
			},
		});

		const appSubmenu = await Submenu.new({
			text: 'App',
			items: [settingsItem],
		});

		const menu = await Menu.new({
			items: [appSubmenu],
		});

		await menu.setAsAppMenu();
	}
}
