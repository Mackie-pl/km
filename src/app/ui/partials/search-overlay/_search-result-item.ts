import {
	ChangeDetectionStrategy,
	Component,
	input,
	output,
} from '@angular/core';
import { LucideFileText } from '@lucide/angular';

/**
 * A single search result row in the search overlay.
 * Extracted to avoid deep HTML nesting in the @for loop parent.
 */
@Component({
	selector: 'app-search-result-item',
	standalone: true,
	imports: [LucideFileText],
	template: `
		<button
			type="button"
			[attr.data-search-index]="index()"
			class="flex items-center gap-3 w-full px-4 py-2.5 text-left border-none bg-transparent cursor-pointer transition-colors duration-100"
			[class.bg-accent-bg2]="selected()"
			[class.hover:bg-hairline]="!selected()"
			(click)="open.emit()"
			(mouseenter)="hovered.emit()"
		>
			<svg
				lucideFileText
				class="size-4 shrink-0"
				[class.text-accent-deep]="selected()"
				[class.text-ink-4]="!selected()"
			></svg>
			<div class="flex flex-col min-w-0">
				<span
					class="text-[13px] font-medium truncate"
					[class.text-accent-deep]="selected()"
					[class.text-ink-1]="!selected()"
				>
					{{ name() }}
				</span>
				@if (parentPath(); as path) {
					<span class="text-xs font-mono text-ink-4 truncate">
						{{ path }}
					</span>
				}
			</div>
		</button>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchResultItem {
	readonly name = input.required<string>();
	readonly index = input(0);
	readonly parentPath = input<string>();
	readonly selected = input(false);
	readonly open = output();
	readonly hovered = output();
}
