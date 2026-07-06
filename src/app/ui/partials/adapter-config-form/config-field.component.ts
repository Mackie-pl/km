import {
	ChangeDetectionStrategy,
	Component,
	input,
	output,
	signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideEye, LucideEyeOff } from '@lucide/angular';
import type { ConfigField } from '@core/adapters/config-schema';

@Component({
	selector: 'app-config-field',
	standalone: true,
	imports: [CommonModule, LucideEye, LucideEyeOff],
	template: `
		<div>
			<label
				[for]="field().key"
				class="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
			>
				{{ field().label }}
				@if (field().required) {
					<span class="text-red-500">*</span>
				}
			</label>

			@if (field().type === 'folder-picker') {
				<button
					type="button"
					[id]="field().key"
					(click)="pick.emit(field().key)"
					class="flex w-full items-center justify-between rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-left text-sm outline-none transition-colors hover:border-indigo-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
					[class.text-gray-900]="displayValue()"
					[class.dark:text-gray-100]="displayValue()"
					[class.text-gray-400]="!displayValue()"
				>
					{{ displayValue() || field().placeholder }}
				</button>
			} @else if (field().type === 'password') {
				<div class="relative">
					<input
						[id]="field().key"
						[type]="showPassword() ? 'text' : 'password'"
						[placeholder]="field().placeholder"
						[value]="value()"
						(input)="onInput($event)"
						class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pr-10 pl-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
					/>
					<button
						type="button"
						(click)="showPassword.set(!showPassword())"
						class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center size-6 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
						[attr.aria-label]="
							showPassword() ? 'Hide password' : 'Show password'
						"
					>
						@if (showPassword()) {
							<svg lucideEyeOff class="size-4"></svg>
						} @else {
							<svg lucideEye class="size-4"></svg>
						}
					</button>
				</div>
			} @else {
				<input
					[id]="field().key"
					[type]="field().type === 'number' ? 'number' : 'text'"
					[placeholder]="field().placeholder"
					[value]="value()"
					(input)="onInput($event)"
					class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
				/>
			}
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigFieldComponent {
	readonly field = input.required<ConfigField>();
	readonly value = input<string | number>('');
	/** Human-readable label for a folder-picker field (e.g. the folder name). */
	readonly displayValue = input<string>('');
	readonly change = output<{ key: string; value: string | number }>();
	/** Emitted (with the field key) when a folder-picker button is clicked. */
	readonly pick = output<string>();

	readonly showPassword = signal(false);

	onInput(event: Event): void {
		const input = event.target as HTMLInputElement;
		const val =
			this.field().type === 'number' ? Number(input.value) : input.value;
		this.change.emit({ key: this.field().key, value: val });
	}
}
