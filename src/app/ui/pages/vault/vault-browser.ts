import {
	ChangeDetectionStrategy,
	Component,
	computed,
	inject,
	signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
	LucideActivity,
	LucideFilePlus,
	LucideFolderPlus,
	LucideSearch,
	LucideSettings,
} from '@lucide/angular';
import { VaultStore, VaultEntry } from '@vault/store';
import { SyncEngineService } from '@core/sync/sync-engine';
import {
	AgentsService,
	type VaultAgent,
} from '@core/agents/agents.service';
import { DialogService } from '@core/dialog/dialog.service';
import { WorkspaceService } from '@services/workspace.service';
import { SearchService } from '@core/services/search.service';
import { navigateToEntry } from '@core/utils/router-utils';
import { parseFrontmatter } from '@core/utils/frontmatter-parser';
import { AskButtonComponent } from '@ui/partials/ask-button/ask-button.component';
import { VaultRowComponent, type VaultCardRow } from './_vault-row';

/** One card in the mobile vault browser — a root folder or the root-items group. */
export interface VaultCard {
	id: string;
	rows: VaultCardRow[];
}

/**
 * Mobile vault browser (Agents Vault v2, frame 6) — the full-screen home
 * screen on mobile, replacing the sidebar drawer. The tree renders as cards:
 * one per root folder (notes + agents inside), plus one for root-level items.
 *
 * Rename runs through a prompt dialog (no inline inputs on touch), delete
 * through a confirm dialog. Long-press a folder or note for the menu.
 */
@Component({
	selector: 'app-vault-browser',
	standalone: true,
	imports: [
		LucideActivity,
		LucideFilePlus,
		LucideFolderPlus,
		LucideSearch,
		LucideSettings,
		RouterLink,
		AskButtonComponent,
		VaultRowComponent,
	],
	templateUrl: './vault-browser.html',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: {
		class: 'flex-1 flex flex-col min-h-0 bg-surface-2',
		'(document:click)': 'closeContextMenu()',
	},
})
export class VaultBrowserComponent {
	protected readonly vaultDb = inject(VaultStore);
	protected readonly agentsService = inject(AgentsService);
	protected readonly workspaceService = inject(WorkspaceService);
	private readonly syncEngine = inject(SyncEngineService);
	private readonly dialog = inject(DialogService);
	private readonly search = inject(SearchService);
	private readonly router = inject(Router);

	/** Open the global search overlay. */
	openSearch(): void {
		this.search.open();
	}

	/** Open settings — full-page route on mobile. */
	openSettings(): void {
		void this.router.navigate(['/settings']);
	}

	/** Folder ids currently expanded. */
	readonly expandedFolders = signal<Set<string>>(new Set());

	/** Entry whose long-press/right-click menu is open, if any. */
	readonly contextEntry = signal<VaultEntry | null>(null);

	/** Agent ids with a run in flight. */
	private readonly runningAgentIds = computed(
		() =>
			new Set(this.agentsService.runningRuns().map((run) => run.agentId)),
	);

	/** The card-grouped tree: one card per root folder + one for root items. */
	readonly cards = computed<VaultCard[]>(() => {
		const childrenMap = this.buildChildrenMap();
		const agents = this.agentsService.agents();
		const root = childrenMap.get(null) ?? [];

		const cards: VaultCard[] = root
			.filter((entry) => entry.type === 'folder')
			.map((folder) => ({
				id: folder.id,
				rows: this.folderCardRows(folder, childrenMap, agents),
			}));

		const rootRows: VaultCardRow[] = [
			...root
				.filter((entry) => entry.type === 'file')
				.map((entry) => this.noteRow(entry, 0)),
			...agents
				.filter((agent) => !agent.scope)
				.map((agent) => this.agentRow(agent, 0)),
		];
		if (rootRows.length) {
			cards.push({ id: 'vault-root', rows: rootRows });
		}
		return cards;
	});

	// ---- Card building ----

	/** Parent → sorted children adjacency for the whole vault. */
	private buildChildrenMap(): Map<string | null, VaultEntry[]> {
		const map = new Map<string | null, VaultEntry[]>();
		for (const entry of [...this.vaultDb.folders(), ...this.vaultDb.files()]) {
			const list = map.get(entry.parentId) ?? [];
			list.push(entry);
			map.set(entry.parentId, list);
		}
		for (const [, children] of map) {
			children.sort((a, b) => {
				if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
				return a.name.localeCompare(b.name);
			});
		}
		return map;
	}

	/** Rows for one root-folder card: header + contents when expanded. */
	private folderCardRows(
		folder: VaultEntry,
		childrenMap: Map<string | null, VaultEntry[]>,
		agents: VaultAgent[],
	): VaultCardRow[] {
		const rows: VaultCardRow[] = [];
		this.walkFolder(folder, childrenMap, agents, 0, rows);
		return rows;
	}

	/** Append a folder row and, when expanded, its children recursively. */
	private walkFolder(
		folder: VaultEntry,
		childrenMap: Map<string | null, VaultEntry[]>,
		agents: VaultAgent[],
		depth: number,
		out: VaultCardRow[],
	): void {
		const children = childrenMap.get(folder.id) ?? [];
		const scopedAgents = agents.filter((a) => a.scope === folder.name);
		const expanded = this.expandedFolders().has(folder.id);

		out.push({
			kind: 'folder',
			entry: folder,
			depth,
			expanded,
			meta: this.folderMeta(children, scopedAgents),
		});
		if (!expanded) return;

		for (const child of children) {
			if (child.type === 'folder') {
				this.walkFolder(child, childrenMap, agents, depth + 1, out);
			} else {
				out.push(this.noteRow(child, depth + 1));
			}
		}
		for (const agent of scopedAgents) {
			out.push(this.agentRow(agent, depth + 1));
		}
	}

	/** "3 notes · 2 agents" meta label for a folder row. */
	private folderMeta(
		children: VaultEntry[],
		scopedAgents: VaultAgent[],
	): string {
		const notes = children.filter((c) => c.type === 'file').length;
		const parts: string[] = [];
		if (notes) parts.push(`${String(notes)} note${notes === 1 ? '' : 's'}`);
		if (scopedAgents.length) {
			parts.push(
				`${String(scopedAgents.length)} agent${scopedAgents.length === 1 ? '' : 's'}`,
			);
		}
		return parts.join(' · ');
	}

	private noteRow(entry: VaultEntry, depth: number): VaultCardRow {
		let icon: string | undefined;
		if (entry.content) {
			icon = parseFrontmatter(entry.content).metadata.icon;
		}
		return {
			kind: 'note',
			entry,
			depth,
			...(icon !== undefined ? { icon } : {}),
		};
	}

	private agentRow(agent: VaultAgent, depth: number): VaultCardRow {
		return {
			kind: 'agent',
			agent,
			depth,
			running: this.runningAgentIds().has(agent.id),
		};
	}

	/** Stable @for key for a card row. */
	trackRow(row: VaultCardRow): string {
		return row.kind === 'agent' ? `agent-${row.agent.id}` : row.entry.id;
	}

	// ---- Actions ----

	/** Toggle a folder and re-list its children from disk on expand. */
	toggleFolder(folder: VaultEntry): void {
		const wasExpanded = this.expandedFolders().has(folder.id);
		this.expandedFolders.update((set) => {
			const next = new Set(set);
			if (wasExpanded) {
				next.delete(folder.id);
			} else {
				next.add(folder.id);
			}
			return next;
		});
		if (!wasExpanded && folder.path) {
			void this.syncEngine.refreshFolder(folder.path);
		}
	}

	async openNote(entry: VaultEntry): Promise<void> {
		await navigateToEntry(this.router, entry.path);
	}

	/** Create a note (optionally inside a folder) named via prompt dialog. */
	async newNote(parent?: VaultEntry): Promise<void> {
		this.closeContextMenu();
		const name = await this.dialog.prompt({
			title: 'New Note',
			message: 'Name for the new note:',
			defaultValue: 'New note',
			confirmLabel: 'Create',
		});
		const trimmed = name?.trim();
		if (!trimmed || trimmed.includes('/')) return;
		const fileName = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
		const entry = await this.vaultDb.createFile(fileName, '', parent?.path);
		if (entry) {
			await navigateToEntry(this.router, entry.path);
		}
	}

	/** Create a root folder named via prompt dialog. */
	async newFolder(): Promise<void> {
		const name = await this.dialog.prompt({
			title: 'New Folder',
			message: 'Name for the new folder:',
			defaultValue: 'New Folder',
			confirmLabel: 'Create',
		});
		const trimmed = name?.trim();
		if (!trimmed || trimmed.includes('/')) return;
		await this.vaultDb.createFolder(trimmed);
	}

	/** Rename via prompt dialog (no inline inputs on touch). */
	async renameEntry(entry: VaultEntry): Promise<void> {
		this.closeContextMenu();
		const name = await this.dialog.prompt({
			title: `Rename ${entry.type === 'folder' ? 'Folder' : 'Note'}`,
			message: 'New name:',
			defaultValue: entry.name,
			confirmLabel: 'Rename',
		});
		const trimmed = name?.trim();
		if (!trimmed || trimmed.includes('/') || trimmed === entry.name) return;
		await this.vaultDb.renameEntry(entry.id, trimmed);
	}

	/** Delete after an explicit confirm (no inline undo on mobile). */
	async deleteEntry(entry: VaultEntry): Promise<void> {
		this.closeContextMenu();
		const ok = await this.dialog.confirm({
			title: `Delete ${entry.type === 'folder' ? 'Folder' : 'Note'}`,
			message: `Delete “${entry.name}”? This cannot be undone.`,
			confirmLabel: 'Delete',
		});
		if (ok) {
			await this.vaultDb.delete(entry.id);
		}
	}

	onContextMenu(entry: VaultEntry): void {
		this.contextEntry.set(entry);
	}

	closeContextMenu(): void {
		this.contextEntry.set(null);
	}

	/** Workspace footer row → the full-page workspace config (mobile route). */
	openWorkspaceConfig(): void {
		void this.router.navigate(['/workspace']);
	}
}
