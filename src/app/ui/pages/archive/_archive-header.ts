import {
	ChangeDetectionStrategy,
	Component,
	input,
	model,
	output,
} from '@angular/core';
import { LucideArchive, LucideTrash2 } from '@lucide/angular';

export type ArchiveTab = 'archived' | 'trash';

/**
 * Archive page header: title, the Archived/Trash tab pills, and the
 * Empty Trash action. Extracted to keep the page template within the
 * nesting limit. `tab` is a two-way model owned by the page.
 */
@Component({
	selector: 'app-archive-header',
	standalone: true,
	imports: [LucideArchive, LucideTrash2],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="px-4 sm:px-8 pt-6 pb-4 border-b border-line">
			<div class="flex items-center gap-3 mb-4">
				<svg lucideArchive class="size-5.5 text-ink-1"></svg>
				<h1
					class="text-[24px] font-bold tracking-[-0.01em] text-ink-1 m-0"
				>
					Archive
				</h1>
			</div>
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="px-3 py-1.5 rounded-full border text-[12.5px] font-semibold cursor-pointer transition-colors"
					[class.bg-accent-bg2]="tab() === 'archived'"
					[class.text-accent-deep]="tab() === 'archived'"
					[class.border-accent-border]="tab() === 'archived'"
					[class.bg-transparent]="tab() !== 'archived'"
					[class.text-ink-3]="tab() !== 'archived'"
					[class.border-line]="tab() !== 'archived'"
					(click)="tab.set('archived')"
				>
					Archived ({{ archivedCount() }})
				</button>
				<button
					type="button"
					class="px-3 py-1.5 rounded-full border text-[12.5px] font-semibold cursor-pointer transition-colors"
					[class.bg-accent-bg2]="tab() === 'trash'"
					[class.text-accent-deep]="tab() === 'trash'"
					[class.border-accent-border]="tab() === 'trash'"
					[class.bg-transparent]="tab() !== 'trash'"
					[class.text-ink-3]="tab() !== 'trash'"
					[class.border-line]="tab() !== 'trash'"
					(click)="tab.set('trash')"
				>
					Trash ({{ trashCount() }})
				</button>
				@if (tab() === 'trash' && trashCount() > 0) {
					<button
						type="button"
						class="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-transparent text-[12px] font-medium text-red-600 dark:text-red-400 cursor-pointer transition-colors hover:bg-hairline"
						(click)="emptyTrash.emit()"
					>
						<svg lucideTrash2 class="size-3.5 flex-shrink-0"></svg>
						Empty Trash
					</button>
				}
			</div>
		</div>
	`,
})
export class ArchiveHeader {
	/** Active tab — two-way bound with the page. */
	readonly tab = model.required<ArchiveTab>();

	readonly archivedCount = input.required<number>();
	readonly trashCount = input.required<number>();

	readonly emptyTrash = output();
}
