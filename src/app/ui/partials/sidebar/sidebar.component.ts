import { Component, inject, model, output } from '@angular/core';
import {
	LucideFileText,
	LucideArchive,
	LucideTrash2,
	LucideFolder,
	LucideChevronLeft,
	LucideChevronRight,
	LucideX,
	LucideSettings,
} from '@lucide/angular';
import { PlatformService } from '@services/platform.service';
import { VaultStore, VaultEntry } from '@vault/store';
import { WorkspaceService } from '@services/workspace.service';
import { Router } from '@angular/router';

/** Pre-defined navigation items with their icon name for template switching */
interface NavItem {
	label: string;
	iconName: 'fileText' | 'archive' | 'trash2';
	route: string;
}

/**
 * Responsive sidebar component.
 *
 * Desktop: always visible, collapsible between expanded (w-64) and collapsed (w-16).
 * Mobile: hidden by default, opens as a fixed overlay when triggered.
 *
 * Uses pure Tailwind for layout — no Taiga UI components.
 */
@Component({
	selector: 'app-sidebar',
	standalone: true,
	imports: [
		LucideFileText,
		LucideArchive,
		LucideTrash2,
		LucideChevronLeft,
		LucideChevronRight,
		LucideX,
		LucideSettings,
		LucideFolder,
	],
	templateUrl: './sidebar.component.html',
	styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
	private readonly platformService = inject(PlatformService);
	private readonly workspaceService = inject(WorkspaceService);
	private readonly router = inject(Router);

	// ---- Two-way bindable signals (model inputs) ----
	// TypeScript analogy: these are like writable props with automatic
	// two-way binding via [(collapsed)]="..." in the parent template.

	/** Whether the sidebar is collapsed on desktop */
	readonly collapsed = model(false);

	/** Whether the mobile overlay is open */
	readonly mobileOpen = model(false);

	// ---- Output event ----

	/** Emitted when the workspace config should be opened */
	readonly openWorkspaceConfig = output();

	// ---- Derived state ----

	readonly isDesktop = this.platformService.isDesktop;
	readonly activeWorkspace = this.workspaceService.activeWorkspace;
	private readonly vaultDb = inject(VaultStore);

	readonly folders = this.vaultDb.folders;
	readonly files = this.vaultDb.files;

	// ---- Nav items (placeholder — wire up routes later) ----

	readonly navItems: NavItem[] = [
		{ label: 'Notes', iconName: 'fileText', route: '/' },
		{ label: 'Archive', iconName: 'archive', route: '/archive' },
		{ label: 'Trash', iconName: 'trash2', route: '/trash' },
	];

	// ---- Mobile swipe-to-close ----

	private touchStartX = 0;

	/** Track where the user started their touch for swipe detection */
	onTouchStart(event: TouchEvent): void {
		this.touchStartX = event.touches[0]?.clientX ?? 0;
	}

	/** If the user swiped left > 60px, close the mobile sidebar */
	onTouchEnd(event: TouchEvent): void {
		const deltaX = event.changedTouches[0]?.clientX ?? 0 - this.touchStartX;
		if (deltaX < -60) {
			this.closeMobile();
		}
	}

	// ---- Actions ----

	toggleCollapsed(): void {
		this.collapsed.update((v) => !v);
	}

	closeMobile(): void {
		this.mobileOpen.set(false);
	}

	openWorkspaceConfigDialog(): void {
		this.openWorkspaceConfig.emit();
	}

	async openFile(entry: VaultEntry): Promise<void> {
		const nav = await this.router
			.navigate(['/e', entry.path])
			.catch((err: unknown) => {
				console.error('Navigation error:', err);
				return false;
			});
		if (!nav) {
			console.error('Failed to navigate to file:', entry.path);
		}
	}
}
