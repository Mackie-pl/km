import { Injectable, inject } from '@angular/core';
import { TuiDialogService } from '@taiga-ui/core/portals/dialog';
import { PolymorpheusComponent } from '@taiga-ui/polymorpheus';
import { firstValueFrom } from 'rxjs';
import { ConfirmationDialog } from './confirmation-dialog.component';

export type DialogMode = 'alert' | 'confirm' | 'prompt';

export interface DialogOptions {
	title: string;
	message: string;
	confirmLabel?: string;
	defaultValue?: string;
}

/** Internal — matches DialogOptions + mode added by the service methods. */
export interface DialogData extends DialogOptions {
	mode: DialogMode;
}

/**
 * Promise-based dialog service wrapping Taiga UI dialogs.
 *
 * Works identically on desktop (Tauri), mobile (Android),
 * and browser dev — no native API fallbacks needed.
 *
 * Usage:
 * ```typescript
 * const ok = await inject(DialogService).confirm({
 *   title: 'Remove Workspace',
 *   message: 'Are you sure?',
 * });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
	private readonly dialogService = inject(TuiDialogService);

	/**
	 * Show a confirmation dialog (Cancel / Confirm buttons).
	 * Returns `true` if confirmed, `false` if cancelled.
	 * Not dismissible — user must pick a button.
	 */
	confirm(options: DialogOptions): Promise<boolean> {
		return firstValueFrom(
			this.dialogService.open(
				new PolymorpheusComponent(ConfirmationDialog),
				{
					data: { ...options, mode: 'confirm' },
					size: 's',
					dismissible: false,
					closable: false,
					label: options.title,
				},
			),
		) as unknown as Promise<boolean>;
	}

	/**
	 * Show an alert dialog (single OK button).
	 * Resolves when dismissed.
	 */
	alert(options: DialogOptions): Promise<void> {
		return firstValueFrom(
			this.dialogService.open(
				new PolymorpheusComponent(ConfirmationDialog),
				{
					data: { ...options, mode: 'alert' },
					size: 's',
					dismissible: true,
					label: options.title,
				},
			),
		);
	}

	/**
	 * Show a prompt dialog with a text input.
	 * Returns the input string on confirm, or `null` on cancel.
	 * Not dismissible — user must pick a button.
	 */
	prompt(options: DialogOptions): Promise<string | null> {
		return firstValueFrom(
			this.dialogService.open(
				new PolymorpheusComponent(ConfirmationDialog),
				{
					data: { ...options, mode: 'prompt' },
					size: 's',
					dismissible: false,
					closable: false,
					label: options.title,
				},
			),
		) as unknown as Promise<string | null>;
	}
}
