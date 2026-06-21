import {
	ChangeDetectionStrategy,
	Component,
	input,
	signal,
	inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from '@services/workspace.service';
import { AdapterRow } from './adapter-row';
import { AddAdapterSection } from './add-adapter-section';
import { DialogService } from '@core/dialog/dialog.service';
import type { AdapterConfig } from '@core/adapters/adapter.interface';
import type { Workspace } from '@services/workspace.service';

@Component({
	selector: 'app-workspace-adapter-panel',
	standalone: true,
	imports: [CommonModule, AdapterRow, AddAdapterSection],
	templateUrl: './workspace-adapter-panel.html',
	styleUrl: './workspace-adapter-panel.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceAdapterPanel {
	private readonly workspaceService = inject(WorkspaceService);
	private readonly dialog = inject(DialogService);

	readonly workspace = input.required<Workspace>();

	/** Tracks which adapter config form is open, or null. */
	readonly configuringAdapterId = signal<string | null>(null);

	isConfiguring(adapterId: string): boolean {
		return this.configuringAdapterId() === adapterId;
	}

	onEditAdapter(adapterId: string): void {
		this.configuringAdapterId.set(adapterId);
	}

	onAdapterConfigSave(adapterId: string, config: AdapterConfig): void {
		const ws = this.workspace();
		this.workspaceService.setAdapterConfig(ws.id, config);
		if (!ws.activeSyncAdapters.includes(adapterId)) {
			this.workspaceService.setWorkspaceAdapters(ws.id, [
				...ws.activeSyncAdapters,
				adapterId,
			]);
		}
		this.configuringAdapterId.set(null);
	}

	onAdapterConfigCancel(): void {
		this.configuringAdapterId.set(null);
	}

	async removeAdapter(adapterId: string): Promise<void> {
		const ws = this.workspace();
		const label = this.getAdapterLabel(adapterId);
		const confirmed = await this.dialog.confirm({
			title: 'Remove Adapter',
			message: `Remove "${label}" adapter from this workspace?`,
		});
		if (!confirmed) return;

		this.workspaceService.removeAdapterConfig(ws.id, adapterId);
		this.workspaceService.setWorkspaceAdapters(
			ws.id,
			ws.activeSyncAdapters.filter((id) => id !== adapterId),
		);
	}

	private getAdapterLabel(adapterId: string): string {
		if (adapterId === 'tauri-fs') return 'Local (Tauri)';
		if (adapterId === 'browser-file-system-api') return 'Local (Browser)';
		if (adapterId === 'test-fs') return 'Local (Test)';
		return adapterId;
	}
}
