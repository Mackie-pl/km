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
				class="mb-1 block text-xs font-medium text-ink-2"
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
					class="flex w-full items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm outline-none transition-colors hover:border-accent-border focus:border-accent focus:ring-1 focus:ring-accent"
					[class.text-ink-1]="displayValue()"
					[class.text-ink-4]="!displayValue()"
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
						class="w-full rounded-lg border border-line bg-surface pr-10 pl-3 py-2 text-sm font-mono text-ink-1 placeholder-ink-4 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
					/>
					<button
						type="button"
						(click)="showPassword.set(!showPassword())"
						class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center size-6 rounded-md text-ink-4 hover:text-ink-2 transition-colors"
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
					class="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-1 placeholder-ink-4 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
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
