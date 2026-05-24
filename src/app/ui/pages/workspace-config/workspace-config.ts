import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { WorkspaceService } from '@services/workspace.service';
import { LucideTrash2 } from '@lucide/angular';
import { DialogService } from '@core/dialog/dialog.service';

@Component({
	selector: 'app-workspace-config',
	standalone: true,
	imports: [CommonModule, LucideTrash2],
	templateUrl: './workspace-config.html',
	styleUrl: './workspace-config.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceConfig {
	private readonly workspaceService = inject(WorkspaceService);
	private readonly router = inject(Router);
	private readonly dialog = inject(DialogService);

	readonly workspaces = this.workspaceService.workspaces;
	readonly activeWorkspace = this.workspaceService.activeWorkspace;

	/** Select a workspace by ID */
	selectWorkspace(id: string): void {
		this.workspaceService.activateWorkspace(id);
	}

	/** Navigate to the workspace creation wizard */
	openWizard(): void {
		void this.router.navigate(['/workspace/new']);
	}

	/**
	 * Prompt for confirmation and remove a workspace.
	 * If the user cancels the confirm dialog, no action is taken.
	 */
	async removeWorkspace(id: string, name: string): Promise<void> {
		const confirmed = await this.dialog.confirm({
			title: 'Remove Workspace',
			message: `Remove "${name}" workspace?`,
		});
		if (confirmed) {
			this.workspaceService.removeWorkspace(id);
		}
	}
}
