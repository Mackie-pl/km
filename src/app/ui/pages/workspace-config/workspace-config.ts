import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { WorkspaceService } from '@services/workspace.service';
import { LucideTrash2 } from '@lucide/angular';

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
	removeWorkspace(id: string, name: string): void {
		if (window.confirm(`Remove "${name}" workspace?`)) {
			this.workspaceService.removeWorkspace(id);
		}
	}
}
