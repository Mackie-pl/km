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
import type { TrashBatch } from '@vault/trash.service';

/**
 * One row in the Trash tab: a delete action (file, or folder + contents)
 * with its remaining retention and Restore / Delete-forever actions.
 */
@Component({
	selector: 'app-trash-row',
	standalone: true,
	imports: [LucideArchiveRestore, LucideFileText, LucideFolder, LucideTrash2],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div
			class="flex items-center gap-3 rounded-[11px] border border-line bg-surface px-4 py-3"
		>
			@if (batch().root.type === 'folder') {
				<svg lucideFolder class="size-4.5 flex-shrink-0 text-ink-4"></svg>
			} @else {
				<svg
					lucideFileText
					class="size-4.5 flex-shrink-0 text-ink-4"
				></svg>
			}
			<div class="flex-1 min-w-0">
				<div class="text-[13px] font-medium text-ink-1 truncate">
					{{ batch().root.name }}
				</div>
				<div class="text-[11.5px] text-ink-4 truncate">
					{{ meta() }}
				</div>
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
				(click)="removeForever.emit()"
				aria-label="Delete forever"
			>
				<svg lucideTrash2 class="size-4 flex-shrink-0"></svg>
			</button>
		</div>
	`,
})
export class TrashRow {
	readonly batch = input.required<TrashBatch>();

	readonly restore = output();
	readonly removeForever = output();

	/** Sub-line: original folder, item count, and remaining retention. */
	readonly meta = computed(() => {
		const b = this.batch();
		const parts: string[] = [];
		const parent = b.root.originalPath.split('/').slice(0, -1).join('/');
		if (parent) parts.push(parent);
		if (b.count > 1) parts.push(`${String(b.count)} items`);
		parts.push(
			b.daysRemaining <= 0
				? 'expires today'
				: `${String(b.daysRemaining)} day${b.daysRemaining === 1 ? '' : 's'} left`,
		);
		return parts.join(' · ');
	});
}
