import { Injectable, inject } from '@angular/core';
import { TuiDialogService } from '@taiga-ui/core/portals/dialog';
import { PolymorpheusComponent } from '@taiga-ui/polymorpheus';
import { firstValueFrom } from 'rxjs';
import { IconPickerComponent } from './icon-picker.component';

/**
 * Service to open the icon picker dialog.
 *
 * Returns the selected icon value (e.g. "📝" or "lucide:file-text")
 * or null if the user cancelled.
 */
@Injectable({ providedIn: 'root' })
export class IconPickerService {
	private readonly dialogService = inject(TuiDialogService);

	/**
	 * Open the icon picker dialog.
	 * @returns The selected icon value string, or null if cancelled.
	 */
	openIconPicker(): Promise<string | null> {
		return firstValueFrom(
			this.dialogService.open(
				new PolymorpheusComponent(IconPickerComponent),
				{
					size: 'l',
					dismissible: true,
					label: 'Choose an icon',
				},
			),
		) as unknown as Promise<string | null>;
	}
}
