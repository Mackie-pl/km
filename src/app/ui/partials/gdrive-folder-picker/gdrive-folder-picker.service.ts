import { Injectable, inject } from '@angular/core';
import { TuiDialogService } from '@taiga-ui/core/portals/dialog';
import { PolymorpheusComponent } from '@taiga-ui/polymorpheus';
import { firstValueFrom } from 'rxjs';
import {
	GDriveFolderPickerDialog,
	type FolderPickResult,
} from './gdrive-folder-picker.dialog';

/**
 * Opens the Google Drive folder browser dialog and resolves with the chosen
 * folder (or null on cancel). Wraps {@link TuiDialogService} the same way
 * {@link DialogService} does.
 */
@Injectable({ providedIn: 'root' })
export class GDriveFolderPickerService {
	private readonly dialogService = inject(TuiDialogService);

	choose(): Promise<FolderPickResult> {
		return firstValueFrom(
			this.dialogService.open<FolderPickResult>(
				new PolymorpheusComponent(GDriveFolderPickerDialog),
				{
					label: 'Choose a Drive folder',
					size: 'm',
					dismissible: false,
					closable: false,
				},
			),
		);
	}
}
