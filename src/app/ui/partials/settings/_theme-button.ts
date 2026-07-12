import {
	ChangeDetectionStrategy,
	Component,
	input,
	output,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideSun, LucideMoon, LucideMonitor } from '@lucide/angular';

/**
 * A single theme selector button used inside the settings page.
 * Extracted to avoid deep HTML nesting in the @for loop parent.
 */
@Component({
	selector: 'app-theme-button',
	standalone: true,
	imports: [NgClass, LucideSun, LucideMoon, LucideMonitor],
	template: `
		<button
			type="button"
			class="flex flex-col items-center gap-2 py-4 px-2 rounded-card border cursor-pointer transition-all duration-200"
			[ngClass]="
				selected()
					? 'border-accent-border bg-accent-bg text-accent-text shadow-hairline'
					: 'border-line bg-surface text-ink-3 hover:bg-surface-2 hover:text-ink-1'
			"
			(click)="select.emit()"
		>
			@if (value() === 'light') {
				<svg lucideSun class="size-6"></svg>
			} @else if (value() === 'dark') {
				<svg lucideMoon class="size-6"></svg>
			} @else {
				<svg lucideMonitor class="size-6"></svg>
			}
			<span class="text-[12.5px] font-semibold">{{ label() }}</span>
		</button>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeButton {
	readonly value = input.required<string>();
	readonly label = input.required<string>();
	readonly selected = input(false);
	readonly select = output();
}
