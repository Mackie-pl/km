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
			<span class="text-sm text-gray-500">Opening folder picker...</span>
		} @else if (folderPath()) {
			<div class="space-y-1">
				<div class="font-medium text-gray-900 dark:text-gray-100">
					{{ folderName() }}
				</div>
				<div class="truncate text-xs text-gray-500">
					{{ folderPath() }}
				</div>
			</div>
		} @else {
			<svg lucidePlus class="mx-auto size-8 text-gray-400"></svg>
			<span class="text-sm font-medium text-indigo-600">
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
