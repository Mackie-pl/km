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
			class="inline-flex items-center gap-1.5 rounded-full border border-dashed border-accent-border bg-transparent px-3 py-1.5 text-xs font-medium text-accent-2 transition-colors hover:bg-accent-bg"
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
