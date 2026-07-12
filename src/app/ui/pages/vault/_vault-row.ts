import {
	ChangeDetectionStrategy,
	Component,
	OnDestroy,
	Type,
	computed,
	input,
	output,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
	LucideChevronRight,
	LucideFilePlus,
	LucideFolder,
	LucidePencil,
	LucideTrash2,
	LucideZap,
} from '@lucide/angular';
import {
	TuiDropdownDirective,
	TuiDropdownManual,
} from '@taiga-ui/core/portals/dropdown';
import { LUCIDE_COMPONENT_MAP } from '@core/utils/lucide-map';
import { DEFAULT_NOTE_ICON } from '@core/types/note-metadata';
import type { VaultEntry } from '@vault/store';
import type { VaultAgent } from '@core/agents/agents.service';

/** One row inside a mobile vault card — a folder, a note, or an agent. */
export type VaultCardRow =
	| {
			kind: 'folder';
			entry: VaultEntry;
			depth: number;
			expanded: boolean;
			meta: string;
	  }
	| { kind: 'note'; entry: VaultEntry; depth: number; icon?: string }
	| { kind: 'agent'; agent: VaultAgent; depth: number; running: boolean };

/** Trigger-kind → short sub-line label for agent rows. */
const TRIGGER_LABELS: Record<string, string> = {
	create: 'on create',
	edit: 'on edit',
	cron: 'scheduled',
	manual: 'manual',
};

/**
 * A single row in the mobile vault browser (Agents Vault v2, frame 6):
 * folder rows toggle, note rows open, agent rows link to the agent page.
 * Folders and notes get a long-press / right-click context menu.
 * Extracted so the browser template stays within the nesting limit.
 */
@Component({
	selector: 'app-vault-row',
	standalone: true,
	imports: [
		NgComponentOutlet,
		LucideChevronRight,
		LucideFilePlus,
		LucideFolder,
		LucidePencil,
		LucideTrash2,
		LucideZap,
		RouterLink,
		TuiDropdownDirective,
		TuiDropdownManual,
	],
	templateUrl: './_vault-row.html',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultRowComponent implements OnDestroy {
	readonly row = input.required<VaultCardRow>();

	/** The entry whose context menu is open (owned by the browser). */
	readonly contextEntry = input<VaultEntry | null>(null);

	readonly toggleFolder = output<VaultEntry>();
	readonly openNote = output<VaultEntry>();
	readonly contextMenu = output<VaultEntry>();
	readonly renameEntry = output<VaultEntry>();
	readonly deleteEntry = output<VaultEntry>();
	readonly newFileInFolder = output<VaultEntry>();

	/** Entry of this row, when it has one (folders and notes). */
	readonly entry = computed<VaultEntry | null>(() => {
		const row = this.row();
		return row.kind === 'agent' ? null : row.entry;
	});

	/** Whether this row's context menu is open. */
	readonly menuOpen = computed(
		() => this.contextEntry()?.id === this.entry()?.id && !!this.entry(),
	);

	/** Uniform indent: 14px base + 26px per depth level (design: 14 / 40). */
	readonly indent = computed(() => 14 + this.row().depth * 26);

	/** Frontmatter icon for note rows. */
	readonly noteIcon = computed(() => {
		const row = this.row();
		return row.kind === 'note' ? row.icon : undefined;
	});

	readonly isLucideIcon = computed(
		() => this.noteIcon()?.startsWith('lucide:') ?? false,
	);

	readonly lucideComponent = computed<Type<unknown> | null>(() => {
		const icon = this.noteIcon();
		if (!icon?.startsWith('lucide:')) return null;
		return LUCIDE_COMPONENT_MAP.get(icon.slice('lucide:'.length)) ?? null;
	});

	/** Sub-line for agent rows, e.g. "vault-wide · on edit · scheduled". */
	readonly agentSubline = computed(() => {
		const row = this.row();
		if (row.kind !== 'agent') return '';
		const parts = row.agent.triggers.map(
			(t) => TRIGGER_LABELS[t.kind] ?? t.kind,
		);
		if (!row.agent.scope) parts.unshift('vault-wide');
		return parts.join(' · ');
	});

	protected readonly DEFAULT_NOTE_ICON = DEFAULT_NOTE_ICON;

	/** Timer for long-press detection on touch devices. */
	private longPressTimer: number | null = null;

	emitContextMenu(event: Event): void {
		event.preventDefault();
		event.stopPropagation();
		const entry = this.entry();
		if (entry) this.contextMenu.emit(entry);
	}

	onTouchStart(): void {
		this.longPressTimer = window.setTimeout(() => {
			const entry = this.entry();
			if (entry) this.contextMenu.emit(entry);
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
