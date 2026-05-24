import { Component } from '@angular/core';
import { injectContext } from '@taiga-ui/polymorpheus';
import { type TuiDialogContext } from '@taiga-ui/core/portals/dialog';
import { type DialogData } from './dialog.service';

/**
 * Reusable confirmation/alert/prompt dialog body.
 *
 * Renders inside the Taiga dialog chrome (header + backdrop) —
 * the label comes from the service caller, so the title is not
 * duplicated in this template.
 */
@Component({
	selector: 'app-confirmation-dialog',
	standalone: true,
	template: `
		<div class="p-4 space-y-4">
			<p class="text-sm text-gray-600 dark:text-gray-400">
				{{ context.data.message }}
			</p>

			@if (context.data.mode === 'prompt') {
				<input
					type="text"
					[value]="inputValue"
					(input)="inputValue = $any($event.target).value"
					class="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-indigo-500 dark:focus:border-indigo-400 transition-colors"
					autofocus
				/>
			}

			<div class="flex justify-end gap-3">
				@if (context.data.mode !== 'alert') {
					<button
						type="button"
						(click)="cancel()"
						class="px-4 py-2 text-sm font-medium rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
					>
						Cancel
					</button>
				}
				<button
					type="button"
					(click)="confirm()"
					class="px-4 py-2 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
				>
					{{ confirmLabel }}
				</button>
			</div>
		</div>
	`,
})
export class ConfirmationDialog {
	protected readonly context =
		injectContext<TuiDialogContext<boolean | string | null, DialogData>>();

	protected inputValue: string;

	constructor() {
		this.inputValue = this.context.data.defaultValue ?? '';
	}

	protected confirm(): void {
		if (this.context.data.mode === 'prompt') {
			this.context.completeWith(this.inputValue);
		} else {
			this.context.completeWith(true);
		}
	}

	protected cancel(): void {
		if (this.context.data.mode === 'confirm') {
			this.context.completeWith(false);
		} else if (this.context.data.mode === 'prompt') {
			this.context.completeWith(null);
		} else {
			this.context.completeWith(null);
		}
	}

	protected get confirmLabel(): string {
		return this.context.data.confirmLabel ?? this.defaultConfirmLabel;
	}

	private get defaultConfirmLabel(): string {
		switch (this.context.data.mode) {
			case 'alert':
				return 'OK';
			case 'confirm':
				return 'Confirm';
			case 'prompt':
				return 'OK';
			default:
				return 'Confirm';
		}
	}
}
