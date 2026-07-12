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
			<p class="text-[13px] leading-relaxed text-ink-2">
				{{ context.data.message }}
			</p>

			@if (context.data.mode === 'prompt') {
				<input
					type="text"
					[value]="inputValue"
					(input)="inputValue = $any($event.target).value"
					class="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-1 outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
					autofocus
				/>
			}

			<div class="flex justify-end gap-3">
				@if (context.data.mode !== 'alert') {
					<button
						type="button"
						(click)="cancel()"
						class="px-4 py-2 text-[12.5px] font-semibold rounded-btn border border-line bg-surface text-ink-2 hover:bg-hairline transition-colors"
					>
						Cancel
					</button>
				}
				<button
					type="button"
					(click)="confirm()"
					class="px-4 py-2 text-[12.5px] font-semibold rounded-btn text-white bg-accent hover:bg-accent-2 transition-colors"
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
