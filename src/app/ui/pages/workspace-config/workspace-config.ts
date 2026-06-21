import {
	ChangeDetectionStrategy,
	Component,
	inject,
	signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { WorkspaceService } from '@services/workspace.service';
import { WorkspaceCard } from './workspace-card';

@Component({
	selector: 'app-workspace-config',
	standalone: true,
	imports: [CommonModule, WorkspaceCard],
	templateUrl: './workspace-config.html',
	styleUrl: './workspace-config.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceConfig {
	private readonly workspaceService = inject(WorkspaceService);
	private readonly router = inject(Router);

	readonly workspaces = this.workspaceService.workspaces;
	readonly activeWorkspace = this.workspaceService.activeWorkspace;

	/** Which workspace card is expanded (by ID), or null if none. */
	readonly expandedWorkspaceId = signal<string | null>(null);

	/** Toggle expansion of a workspace card. */
	toggleExpand(wsId: string): void {
		this.expandedWorkspaceId.update((current) =>
			current === wsId ? null : wsId,
		);
	}

	/** Navigate to the workspace creation wizard */
	openWizard(): void {
		void this.router.navigate(['/workspace/new']);
	}
}
