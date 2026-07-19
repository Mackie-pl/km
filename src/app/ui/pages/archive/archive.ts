import {
	ChangeDetectionStrategy,
	Component,
	inject,
	signal,
} from '@angular/core';
import { ArchiveService, type ArchivedItem } from '@vault/archive.service';
import { TrashService, type TrashBatch } from '@vault/trash.service';
import { DialogService } from '@core/dialog/dialog.service';
import { ArchiveHeader, type ArchiveTab } from './_archive-header';
import { ArchivedRow } from './_archived-row';
import { TrashRow } from './_trash-row';

/**
 * Archive page — two tabs behind the sidebar's Archive button:
 *   - Archived: entries moved into the synced `.archive/` folder,
 *     restorable to their original location.
 *   - Trash: device-local snapshots of deleted entries, recoverable for
 *     30 days on this device only. Permanent deletes confirm.
 */
@Component({
	selector: 'app-archive',
	standalone: true,
	imports: [ArchiveHeader, ArchivedRow, TrashRow],
	templateUrl: './archive.html',
	changeDetection: ChangeDetectionStrategy.OnPush,
	// Host is the scroll column (no wrapper div) to keep nesting shallow.
	host: {
		class: 'flex-1 flex flex-col min-h-0 pb-6 overflow-y-auto',
	},
})
export class Archive {
	protected readonly archiveService = inject(ArchiveService);
	protected readonly trashService = inject(TrashService);
	private readonly dialog = inject(DialogService);

	readonly tab = signal<ArchiveTab>('archived');

	constructor() {
		// Refresh trash records (and purge expired ones) on page entry.
		void this.trashService.load();
	}

	// ---- Archived tab actions ----

	async restoreArchived(item: ArchivedItem): Promise<void> {
		await this.archiveService.restore(item.entry.id);
	}

	/** Delete an archived entry — still recoverable, it goes to trash. */
	async deleteArchived(item: ArchivedItem): Promise<void> {
		await this.trashService.deleteToTrash(item.entry.id);
	}

	// ---- Trash tab actions ----

	async restoreTrash(batch: TrashBatch): Promise<void> {
		await this.trashService.restore(batch.batchId);
	}

	async deleteForever(batch: TrashBatch): Promise<void> {
		const ok = await this.dialog.confirm({
			title: 'Delete Forever',
			message: `Permanently delete “${batch.root.name}”${
				batch.count > 1
					? ` and ${String(batch.count - 1)} more items`
					: ''
			}? This cannot be undone.`,
			confirmLabel: 'Delete Forever',
		});
		if (ok) {
			await this.trashService.deleteForever(batch.batchId);
		}
	}

	async emptyTrash(): Promise<void> {
		const ok = await this.dialog.confirm({
			title: 'Empty Trash',
			message:
				'Permanently delete everything in the trash? This cannot be undone.',
			confirmLabel: 'Empty Trash',
		});
		if (ok) {
			await this.trashService.emptyTrash();
		}
	}
}
