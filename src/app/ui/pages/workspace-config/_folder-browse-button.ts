import {
	ChangeDetectionStrategy,
	Component,
	input,
	output,
} from '@angular/core';
import { LucidePlus } from '@lucide/angular';

/**
 * Inner content for the folder browse button in the wizard Step 2.
 * Extracted to avoid deep HTML nesting from nested @if blocks inside the button.
 */
@Component({
	selector: 'app-folder-browse-content',
	standalone: true,
	imports: [LucidePlus],
	template: `
		@if (pickingFolder()) {
			<span class="text-sm text-ink-3">Opening folder picker...</span>
		} @else if (folderPath()) {
			<div class="space-y-1">
				<div class="text-[13.5px] font-semibold text-ink-1">
					{{ folderName() }}
				</div>
				<div class="truncate text-xs font-mono text-ink-3">
					{{ folderPath() }}
				</div>
			</div>
		} @else {
			<svg lucidePlus class="mx-auto size-8 text-ink-4"></svg>
			<span class="text-[12.5px] font-semibold text-accent-text">
				Browse Folders
			</span>
		}
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderBrowseContent {
	readonly pickingFolder = input(false);
	readonly folderPath = input<string | null>(null);
	readonly folderName = input<string | null>(null);
	readonly pick = output();
}
