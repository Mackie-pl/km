import {
	ChangeDetectionStrategy,
	Component,
	computed,
	input,
	output,
} from '@angular/core';
import {
	LucideArchiveRestore,
	LucideFileText,
	LucideFolder,
	LucideTrash2,
} from '@lucide/angular';
import type { ArchivedItem } from '@vault/archive.service';

/**
 * One row in the Archived tab: the entry's original location plus
 * Restore / Delete actions. Extracted to keep the page template shallow.
 */
@Component({
	selector: 'app-archived-row',
	standalone: true,
	imports: [LucideArchiveRestore, LucideFileText, LucideFolder, LucideTrash2],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div
			class="flex items-center gap-3 rounded-[11px] border border-line bg-surface px-4 py-3"
		>
			@if (item().entry.type === 'folder') {
				<svg lucideFolder class="size-4.5 flex-shrink-0 text-ink-4"></svg>
			} @else {
				<svg
					lucideFileText
					class="size-4.5 flex-shrink-0 text-ink-4"
				></svg>
			}
			<div class="flex-1 min-w-0">
				<div class="text-[13px] font-medium text-ink-1 truncate">
					{{ item().entry.name }}
				</div>
				@if (parentPath()) {
					<div class="text-[11.5px] text-ink-4 truncate">
						{{ parentPath() }}
					</div>
				}
			</div>
			<button
				type="button"
				class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-transparent text-[12px] font-medium text-ink-2 cursor-pointer transition-colors hover:bg-hairline hover:text-ink-1"
				(click)="restore.emit()"
			>
				<svg lucideArchiveRestore class="size-3.5 flex-shrink-0"></svg>
				Restore
			</button>
			<button
				type="button"
				class="flex items-center justify-center size-8 rounded-lg border-none bg-transparent text-ink-3 cursor-pointer transition-colors hover:bg-hairline hover:text-red-600 dark:hover:text-red-400"
				(click)="remove.emit()"
				aria-label="Delete"
			>
				<svg lucideTrash2 class="size-4 flex-shrink-0"></svg>
			</button>
		</div>
	`,
})
export class ArchivedRow {
	readonly item = input.required<ArchivedItem>();

	readonly restore = output();
	readonly remove = output();

	/** Directory part of the original location ('' for vault root). */
	readonly parentPath = computed(() =>
		this.item().displayPath.split('/').slice(0, -1).join('/'),
	);
}
