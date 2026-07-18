import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucideFilePlus, LucideFolderPlus } from '@lucide/angular';
import { navigateToEntry } from '@core/utils/router-utils';
import { parseFrontmatter } from '@core/utils/frontmatter-parser';
import { VaultStore, VaultEntry } from '@vault/store';
import { SyncEngineService } from '@core/sync/sync-engine';
import { AgentsService } from '@core/agents/agents.service';
import {
	SidebarTreeRowComponent,
	TreeNode,
} from './sidebar-tree-row.component';
import { SidebarAgentRow } from './_agent-row';

/**
 * Self-contained vault file & folder tree for the sidebar.
 *
 * Renders a nested tree view with expand/collapse for folders.
 * Agents live in the same tree, beside notes (Agents Vault v2).
 * Delegates individual tree rows to `SidebarTreeRowComponent`
 * to keep nesting depth under the lint limit.
 */
@Component({
	selector: 'app-sidebar-vault-list',
	standalone: true,
	imports: [
		LucideFilePlus,
		LucideFolderPlus,
		SidebarAgentRow,
		SidebarTreeRowComponent,
	],
	templateUrl: './sidebar-vault-list.component.html',
	styleUrl: './sidebar-vault-list.component.scss',
	host: {
		'(document:click)': 'closeContextMenu()',
	},
})
export class SidebarVaultListComponent {
	protected readonly vaultDb = inject(VaultStore);
	protected readonly agentsService = inject(AgentsService);
	private readonly router = inject(Router);
	private readonly syncEngine = inject(SyncEngineService);

	/** Agent ids with a run currently in flight — shown with a pulsing dot. */
	readonly runningAgentIds = computed(
		() =>
			new Set(this.agentsService.runningRuns().map((run) => run.agentId)),
	);

	/** Icon-rail layout active (desktop only — hides labels, centers icons).
	 * Follows the sidebar's collapse with a delay matching the width animation. */
	readonly collapsed = input(false);

	/** Immediate collapse state (no animation delay) — hides the tag filter bar
	 * right away so its wrapping chips don't reflow while the width animates. */
	readonly collapsedNow = input(false);

	/** The currently-viewed entry path (highlighted in list), or null. */
	readonly activeEntryPath = input<string | null>(null);

	// ---- Tag filter state ----

	/** Set of tag names currently filtering the tree. Empty = no filter. */
	readonly activeFilterTags = signal<Set<string>>(new Set());

	/** True when at least one tag filter is active. */
	readonly isFilterActive = computed(() => this.activeFilterTags().size > 0);

	/** Toggle a tag in/out of the active filter set. */
	toggleFilterTag(tag: string): void {
		this.activeFilterTags.update((set) => {
			const next = new Set(set);
			if (next.has(tag)) {
				next.delete(tag);
			} else {
				next.add(tag);
			}
			return next;
		});
	}

	/** Clear all active tag filters. */
	clearFilter(): void {
		this.activeFilterTags.set(new Set());
	}

	// ---- Tree state ----

	/** Set of folder IDs that are currently expanded. */
	readonly expandedFolders = signal<Set<string>>(new Set());

	/**
	 * Flat tree of vault entries ordered by parent adjacency.
	 * Root entries first, then children of expanded folders recursively.
	 * Folders are sorted before files; within each group, alphabetical.
	 *
	 * When `activeFilterTags` is non-empty, switches to a flat filtered list:
	 * only files whose lowercased tags intersect with the active filter set.
	 */
	readonly treeNodes = computed(() => {
		const activeFilters = this.activeFilterTags();
		if (activeFilters.size > 0) {
			return this.#buildFilteredTree(activeFilters);
		}
		return this.#buildFullTree();
	});

	/** Build the normal nested tree (folders + files, expandable). */
	#buildFullTree(): TreeNode[] {
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
				let icon: string | undefined;
				if (entry.type === 'file' && entry.content) {
					const { metadata } = parseFrontmatter(entry.content);
					icon = metadata.icon;
				}
				result.push({
					entry,
					depth,
					...(icon !== undefined ? { icon } : {}),
				});
				if (entry.type === 'folder' && expanded.has(entry.id)) {
					walk(entry.id, depth + 1);
				}
			}
		};

		walk(null, 0);
		return result;
	}

	/** Build a flat filtered list of files matching any active filter tag. */
	#buildFilteredTree(activeFilters: Set<string>): TreeNode[] {
		const result: TreeNode[] = [];

		for (const entry of this.vaultDb.files()) {
			if (!entry.content) continue;
			const { metadata } = parseFrontmatter(entry.content);
			const entryTags = (metadata.tags ?? []).map((t) => t.toLowerCase());

			// Match if ANY active filter tag is present on this entry
			const matches = [...activeFilters].some((f) =>
				entryTags.includes(f),
			);
			if (!matches) continue;

			result.push({
				entry,
				depth: 0,
				...(metadata.icon ? { icon: metadata.icon } : {}),
			});
		}

		result.sort((a, b) => a.entry.name.localeCompare(b.entry.name));
		return result;
	}

	// ---- Context menu state ----

	/** The entry whose context menu is currently open (right-click / long-press). */
	readonly contextEntry = signal<VaultEntry | null>(null);

	/** The entry currently being renamed inline (null if not renaming). */
	readonly renamingId = signal<string | null>(null);

	/** The entry ID being created-as-new (shows rename input for the new entry name). */
	readonly newEntryRenamingId = signal<string | null>(null);

	// ---- Tree actions ----

	/** Toggle a folder's expand/collapse state. */
	toggleFolder(id: string): void {
		const wasExpanded = this.expandedFolders().has(id);
		this.expandedFolders.update((set) => {
			const next = new Set(set);
			if (wasExpanded) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});

		// On expand, re-list the folder's children from disk so externally
		// created/deleted files appear without a page reload.
		// Tauri has native watching; this is a no-op there.
		if (!wasExpanded) {
			const entry = this.vaultDb.getById(id);
			if (entry?.path) {
				void this.syncEngine.refreshFolder(entry.path);
			}
		}
	}

	/** Create a new folder with an auto-generated name and start renaming. */
	async createNewFolder(): Promise<void> {
		this.closeContextMenu();
		const entry = await this.vaultDb.createFolder('New Folder');
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
		this.closeContextMenu();
		const entry = await this.vaultDb.createFile(
			'new-note.md',
			'',
			folderEntry?.path,
		);
		if (entry) {
			this.newEntryRenamingId.set(entry.id);
			this.renamingId.set(entry.id);
			// Open the newly created file in the editor immediately
			await this.openFile(entry);
		}
		// Auto-expand the folder so the user sees the new file
		if (folderEntry?.id) {
			this.expandedFolders.update((set) => {
				const next = new Set(set);
				next.add(folderEntry.id);
				return next;
			});
		}
	}

	// ---- Context menu actions ----

	/** Handles the child row's context menu output — opens the context menu for the entry. */
	onEntryContextMenu(entry: VaultEntry): void {
		this.contextEntry.set(entry);
	}

	/** Start inline rename for the given entry. */
	startRename(entry: VaultEntry | null): void {
		if (!entry) return;
		this.contextEntry.set(null); // close context menu
		this.renamingId.set(entry.id);
	}

	/** Commit the rename — validates and calls VaultStore. */
	async commitRename(id: string, newName: string): Promise<void> {
		this.renamingId.set(null);
		this.newEntryRenamingId.set(null);
		const trimmed = newName.trim();
		if (!trimmed || trimmed.includes('/')) return;

		// Capture the old path to detect if the renamed entry is currently open
		const entry = this.vaultDb.getById(id);
		const oldPath = entry?.path;

		await this.vaultDb.renameEntry(id, trimmed);

		// If the renamed entry was the one being viewed, navigate to its new path
		if (oldPath && this.activeEntryPath() === oldPath) {
			const renamed = this.vaultDb.getById(id);
			if (renamed && renamed.path !== oldPath) {
				await this.openFile(renamed);
			}
		}
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
		const nav = await navigateToEntry(this.router, entry.path);
		if (!nav) {
			console.error('Failed to navigate to file:', entry.path);
		}
	}

	// ---- Background (empty area) context menu ----

	/** Whether the empty-area context menu (New File / New Folder) is open. */
	readonly backgroundMenuOpen = signal(false);

	/** X coordinate for the background context menu position. */
	readonly backgroundMenuX = signal(0);

	/** Y coordinate for the background context menu position. */
	readonly backgroundMenuY = signal(0);

	/** Open the empty-area context menu on right-click in the tree background. */
	onBackgroundContextMenu(event: MouseEvent): void {
		event.preventDefault();
		this.backgroundMenuX.set(event.clientX);
		this.backgroundMenuY.set(event.clientY);
		this.backgroundMenuOpen.set(true);
	}

	/** Close both the entry context menu and the background context menu. */
	closeContextMenu(): void {
		this.contextEntry.set(null);
		this.backgroundMenuOpen.set(false);
	}
}
