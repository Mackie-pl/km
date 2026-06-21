import {
	ChangeDetectionStrategy,
	Component,
	inject,
	input,
	output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from '@services/workspace.service';
import { DialogService } from '@core/dialog/dialog.service';
import { WorkspaceAdapterPanel } from './workspace-adapter-panel';
import {
	LucideTrash2,
	LucideChevronDown,
	LucideChevronRight,
} from '@lucide/angular';
import type { Workspace } from '@services/workspace.service';

@Component({
	selector: 'app-workspace-card',
	standalone: true,
	imports: [
		CommonModule,
		WorkspaceAdapterPanel,
		LucideTrash2,
		LucideChevronDown,
		LucideChevronRight,
	],
	templateUrl: './workspace-card.html',
	styleUrl: './workspace-card.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceCard {
	private readonly workspaceService = inject(WorkspaceService);
	private readonly dialog = inject(DialogService);

	readonly workspace = input.required<Workspace>();
	readonly isActive = input(false);
	readonly isExpanded = input(false);

	readonly toggleExpand = output();

	select(): void {
		this.workspaceService.activateWorkspace(this.workspace().id);
	}

	onToggleExpand(): void {
		this.toggleExpand.emit();
	}

	async remove(): Promise<void> {
		const ws = this.workspace();
		const confirmed = await this.dialog.confirm({
			title: 'Remove Workspace',
			message: `Remove "${ws.name}" workspace?`,
		});
		if (confirmed) {
			this.workspaceService.removeWorkspace(ws.id);
		}
	}
}
