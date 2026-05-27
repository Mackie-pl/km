import {
	Component,
	ElementRef,
	computed,
	inject,
	input,
	signal,
	viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
	LucideChevronRight,
	LucideFilePlus,
	LucideFileText,
	LucideFolder,
	LucideFolderPlus,
	LucidePencil,
	LucideTrash2,
} from '@lucide/angular';
import {
	TuiDropdownDirective,
	TuiDropdownManual,
} from '@taiga-ui/core/portals/dropdown';
import { VaultStore, VaultEntry } from '@vault/store';

interface TreeNode {
	entry: VaultEntry;
	depth: number;
}

/**
 * Self-contained vault file & folder tree for the sidebar.
 *
 * Renders a nested tree view with expand/collapse for folders.
 * Owns rename state, context menu, and long-press logic for mobile.
 */
@Component({
	selector: 'app-sidebar-vault-list',
	standalone: true,
	imports: [
		LucideChevronRight,
		LucideFilePlus,
		LucideFileText,
		LucideFolder,
		LucideFolderPlus,
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

	// ---- Tree state ----

	/** Set of folder IDs that are currently expanded. */
	readonly expandedFolders = signal<Set<string>>(new Set());

	/**
	 * Flat tree of vault entries ordered by parent adjacency.
	 * Root entries first, then children of expanded folders recursively.
	 * Folders are sorted before files; within each group, alphabetical.
	 */
	readonly treeNodes = computed(() => {
		const expanded = this.expandedFolders();
		const allFolders = this.vaultDb.folders();
		const allFiles = this.vaultDb.files();
		const allEntries = [...allFolders, ...allFiles];

		// Build parent → children adjacency map
		const childrenMap = new Map<string | null, VaultEntry[]>();
		for (const entry of allEntries) {
			const key = entry.parentId;
			if (!childrenMap.has(key)) {
				childrenMap.set(key, []);
			}
			childrenMap.get(key)?.push(entry);
		}

		// Sort: folders first, then alphabetical within each group
		for (const [, children] of childrenMap) {
			children.sort((a, b) => {
				if (a.type !== b.type) {
					return a.type === 'folder' ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});
		}

		const result: TreeNode[] = [];

		const walk = (parentId: string | null, depth: number) => {
			const children = childrenMap.get(parentId);
			if (!children) return;
			for (const entry of children) {
				result.push({ entry, depth });
				if (entry.type === 'folder' && expanded.has(entry.id)) {
					walk(entry.id, depth + 1);
				}
			}
		};

		walk(null, 0);
		return result;
	});

	// ---- Context menu state ----

	/** The entry whose context menu is currently open (right-click / long-press). */
	readonly contextEntry = signal<VaultEntry | null>(null);

	/** The entry currently being renamed inline (null if not renaming). */
	readonly renamingId = signal<string | null>(null);

	/** The entry ID being created-as-new (shows rename input for the new entry name). */
	readonly newEntryRenamingId = signal<string | null>(null);

	/** Ref to the rename input for auto-focus. */
	private readonly renameInput =
		viewChild<ElementRef<HTMLInputElement>>('renameInput');

	/** Timer for long-press detection on touch devices. */
	private longPressTimer: number | null = null;

	// ---- Tree actions ----

	/** Toggle a folder's expand/collapse state. */
	toggleFolder(id: string): void {
		this.expandedFolders.update((set) => {
			const next = new Set(set);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}

	/** Create a new folder with an auto-generated name and start renaming. */
	async createNewFolder(): Promise<void> {
		this.contextEntry.set(null); // close context menu
		const name = 'New Folder';
		await this.vaultDb.createFolder(name);
		// Find the newly created folder to start renaming it
		const entry = this.vaultDb.getByPath(name);
		if (entry) {
			this.newEntryRenamingId.set(entry.id);
			this.renamingId.set(entry.id);
		}
	}

	/**
	 * Create a new file, optionally inside a folder, and start renaming.
	 * Auto-expands the parent folder when provided.
	 */
	async createNewFile(folderEntry?: VaultEntry): Promise<void> {
		this.contextEntry.set(null); // close context menu
		const name = 'new-note.md';
		await this.vaultDb.createFile(name, '', folderEntry?.path);
		const lookupPath = folderEntry ? `${folderEntry.path}/${name}` : name;
		const entry = this.vaultDb.getByPath(lookupPath);
		if (entry) {
			this.newEntryRenamingId.set(entry.id);
			this.renamingId.set(entry.id);
		}
		// Auto-expand the folder so the user sees the new file
		if (folderEntry) {
			this.expandedFolders.update((set) => {
				const next = new Set(set);
				next.add(folderEntry.id);
				return next;
			});
		}
	}

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

		window.setTimeout(() => {
			const input = this.renameInput()?.nativeElement;
			input?.focus();
			input?.select();
		});
	}

	/** Commit the rename — validates and calls VaultStore. */
	async commitRename(id: string, newName: string): Promise<void> {
		this.renamingId.set(null);
		this.newEntryRenamingId.set(null);
		const trimmed = newName.trim();
		if (!trimmed || trimmed.includes('/')) return;

		await this.vaultDb.renameEntry(id, trimmed);
	}

	/** Cancel inline rename without saving. */
	cancelRename(): void {
		const renamingId = this.renamingId();
		const newEntryId = this.newEntryRenamingId();
		this.renamingId.set(null);
		this.newEntryRenamingId.set(null);

		// If the entry was freshly created and the rename was cancelled,
		// delete the entry so we don't leave "New Folder" / "new-note.md" around
		if (renamingId && newEntryId === renamingId) {
			void this.vaultDb.delete(renamingId);
		}
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
