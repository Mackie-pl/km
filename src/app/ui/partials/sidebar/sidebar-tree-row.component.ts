import {
	Component,
	ElementRef,
	OnDestroy,
	Type,
	computed,
	effect,
	input,
	output,
	viewChild,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { timeout } from '@core/utils/async';
import {
	LucideArchive,
	LucideChevronRight,
	LucideFilePlus,
	LucideFolder,
	LucidePencil,
	LucideTrash2,
} from '@lucide/angular';
import {
	TuiDropdownDirective,
	TuiDropdownManual,
} from '@taiga-ui/core/portals/dropdown';
import { LUCIDE_COMPONENT_MAP } from '@core/utils/lucide-map';
import { DEFAULT_NOTE_ICON } from '@core/types/note-metadata';
import { VaultEntry } from '@vault/store';

export interface TreeNode {
	entry: VaultEntry;
	depth: number;
	/** Frontmatter icon value, if any (emoji char or "lucide:<name>"). */
	icon?: string;
}

/**
 * Single row in the vault tree — handles display, renaming, context menu,
 * and touch long-press for one tree node.
 *
 * Depth resets to 0 so this component stays within the nesting limit
 * regardless of how deep the parent tree renders it.
 */
@Component({
	selector: 'app-sidebar-tree-row',
	standalone: true,
	imports: [
		NgComponentOutlet,
		LucideArchive,
		LucideChevronRight,
		LucideFilePlus,
		LucideFolder,
		LucidePencil,
		LucideTrash2,
		TuiDropdownDirective,
		TuiDropdownManual,
	],
	templateUrl: './sidebar-tree-row.component.html',
	styleUrl: './sidebar-tree-row.component.scss',
})
export class SidebarTreeRowComponent implements OnDestroy {
	readonly node = input.required<TreeNode>();
	readonly collapsed = input.required<boolean>();
	readonly activeEntryPath = input<string | null>(null);
	readonly contextEntry = input<VaultEntry | null>(null);
	readonly renamingId = input<string | null>(null);
	readonly expandedFolders = input<Set<string>>(new Set());

	readonly toggleFolder = output<string>();
	readonly openFile = output<VaultEntry>();
	readonly onContextMenu = output<VaultEntry>();
	readonly startRename = output<VaultEntry | null>();
	readonly commitRename = output<{ id: string; name: string }>();
	readonly cancelRename = output();
	readonly deleteEntry = output<VaultEntry | null>();
	readonly archiveEntry = output<VaultEntry>();
	readonly createNewFileInFolder = output<VaultEntry>();

	/** The icon to show for this row — falls back to DEFAULT_NOTE_ICON for files, folder icon for folders. */
	readonly displayIcon = computed(() => this.node().icon);

	/** True when the stored icon is a Lucide icon. */
	readonly isLucideIcon = computed(() =>
		this.displayIcon()?.startsWith('lucide:') ?? false,
	);

	/** The Lucide component class to render, or null if not a Lucide icon. */
	readonly lucideComponent = computed<Type<unknown> | null>(() => {
		const icon = this.displayIcon();
		if (!icon?.startsWith('lucide:')) return null;
		const kebab = icon.slice('lucide:'.length);
		return LUCIDE_COMPONENT_MAP.get(kebab) ?? null;
	});

	/** Exposed for the template. */
	protected readonly DEFAULT_NOTE_ICON = DEFAULT_NOTE_ICON;

	private readonly renameInput =
		viewChild<ElementRef<HTMLInputElement>>('renameInput');

	/** Timer for long-press detection on touch devices. */
	private longPressTimer: number | null = null;

	/** Tracks whether we already auto-focused the rename input for the current rename session. */
	private hasAutoFocused = false;

	/** Auto-focus the rename input when this node enters rename mode. */
	private readonly autoFocusEffect = effect(() => {
		if (this.renamingId() !== this.node().entry.id) {
			this.hasAutoFocused = false;
			return;
		}
		if (this.hasAutoFocused) return;
		this.hasAutoFocused = true;
		void this.autoFocus();
	});

	private async autoFocus() {
		await timeout(); // Wait for the input to render
		const input = this.renameInput()?.nativeElement;
		if (!input) return;
		input.focus();
		const name = this.node().entry.name;
		const dotIndex = name.lastIndexOf('.');
		// Select only the name part before the extension (e.g., "name" in "name.md").
		// Hidden files like ".gitignore" or folders without extensions select all.
		if (dotIndex > 0) {
			input.setSelectionRange(0, dotIndex);
		} else {
			input.select();
		}
	}

	// ---- Event helpers ----

	emitContextMenu(event: MouseEvent, entry: VaultEntry): void {
		event.preventDefault();
		event.stopPropagation();
		this.onContextMenu.emit(entry);
	}

	onNewFileInFolder(entry: VaultEntry): void {
		this.createNewFileInFolder.emit(entry);
	}

	// ---- Touch long-press ----

	onTouchStart(e: TouchEvent, entry: VaultEntry): void {
		this.longPressTimer = window.setTimeout(() => {
			this.onContextMenu.emit(entry);
		}, 500);
	}

	onTouchEnd(): void {
		if (this.longPressTimer !== null) {
			window.clearTimeout(this.longPressTimer);
			this.longPressTimer = null;
		}
	}

	ngOnDestroy(): void {
		if (this.longPressTimer !== null) {
			window.clearTimeout(this.longPressTimer);
		}
	}
}
