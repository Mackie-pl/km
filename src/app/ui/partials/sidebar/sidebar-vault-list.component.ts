import {
	Component,
	ElementRef,
	afterNextRender,
	inject,
	input,
	signal,
	viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
	LucideFileText,
	LucideFolder,
	LucidePencil,
	LucideTrash2,
} from '@lucide/angular';
import {
	TuiDropdownDirective,
	TuiDropdownManual,
} from '@taiga-ui/core/portals/dropdown';
import { VaultStore, VaultEntry } from '@vault/store';

/**
 * Self-contained vault file & folder list for the sidebar.
 *
 * Injects VaultStore directly. Owns rename state, context menu, and
 * long-press logic for mobile. No desktop/mobile forking — the parent
 * controls layout; this just renders the list with label hiding via collapsed.
 */
@Component({
	selector: 'app-sidebar-vault-list',
	standalone: true,
	imports: [
		LucideFileText,
		LucideFolder,
		LucidePencil,
		LucideTrash2,
		TuiDropdownDirective,
		TuiDropdownManual,
	],
	templateUrl: './sidebar-vault-list.component.html',
	styleUrl: './sidebar-vault-list.component.scss',
})
export class SidebarVaultListComponent {
	private readonly vaultDb = inject(VaultStore);
	private readonly router = inject(Router);

	/** Whether the parent sidebar is collapsed (desktop only — hides labels). */
	readonly collapsed = input(false);

	/** The currently-viewed entry path (highlighted in list), or null. */
	readonly activeEntryPath = input<string | null>(null);

	// ---- Vault data (derived from VaultStore) ----

	readonly folders = this.vaultDb.folders;
	readonly files = this.vaultDb.files;

	// ---- Context menu state ----

	/** The entry whose context menu is currently open (right-click / long-press). */
	readonly contextEntry = signal<VaultEntry | null>(null);

	/** The entry currently being renamed inline (null if not renaming). */
	readonly renamingId = signal<string | null>(null);

	/** Ref to the rename input for auto-focus. */
	private readonly renameInput =
		viewChild<ElementRef<HTMLInputElement>>('renameInput');

	/** Timer for long-press detection on touch devices. */
	private longPressTimer: number | null = null;

	// ---- Context menu actions ----

	/** Open context menu on right-click (desktop). */
	onContextMenu(event: MouseEvent, entry: VaultEntry): void {
		event.preventDefault();
		this.contextEntry.set(entry);
	}

	/** Start long-press timer for touch devices. */
	onTouchStartRename(_event: TouchEvent, entry: VaultEntry): void {
		this.longPressTimer = window.setTimeout(() => {
			this.contextEntry.set(entry);
		}, 500);
	}

	/** Cancel long-press if finger lifted before threshold. */
	onTouchEndRename(): void {
		if (this.longPressTimer !== null) {
			window.clearTimeout(this.longPressTimer);
			this.longPressTimer = null;
		}
	}

	/** Start inline rename for the given entry. */
	startRename(entry: VaultEntry | null): void {
		if (!entry) return;
		this.contextEntry.set(null); // close context menu
		this.renamingId.set(entry.id);

		afterNextRender(() => {
			this.renameInput()?.nativeElement.focus();
		});
	}

	/** Commit the rename — validates and calls VaultStore. */
	async commitRename(id: string, newName: string): Promise<void> {
		this.renamingId.set(null);
		const trimmed = newName.trim();
		if (!trimmed || trimmed.includes('/')) return;
		await this.vaultDb.renameEntry(id, trimmed);
	}

	/** Cancel inline rename without saving. */
	cancelRename(): void {
		this.renamingId.set(null);
	}

	/** Delete the entry via context menu. */
	async deleteEntry(entry: VaultEntry | null): Promise<void> {
		if (!entry) return;
		this.contextEntry.set(null);
		await this.vaultDb.delete(entry.id);
	}

	// ---- Navigation ----

	/** Navigate to the editor route for the given file. */
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
