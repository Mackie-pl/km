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
			class="flex flex-col items-center gap-2 py-4 px-2 rounded-xl border-2 cursor-pointer transition-all duration-200"
			[ngClass]="
				selected()
					? 'border-indigo-500 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-900/50 text-gray-900 dark:text-gray-100'
					: 'border-transparent hover:border-gray-300 dark:hover:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
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
			<span class="text-sm font-medium">{{ label() }}</span>
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
