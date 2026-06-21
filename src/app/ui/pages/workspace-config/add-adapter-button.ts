import {
	ChangeDetectionStrategy,
	Component,
	input,
	output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucidePlus } from '@lucide/angular';

@Component({
	selector: 'app-add-adapter-button',
	standalone: true,
	imports: [CommonModule, LucidePlus],
	template: `
		<button
			type="button"
			(click)="configure.emit()"
			class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-transparent px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400"
		>
			<svg lucidePlus class="size-3.5"></svg>
			{{ label() }}
		</button>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddAdapterButton {
	readonly label = input.required<string>();
	readonly configure = output();
}
