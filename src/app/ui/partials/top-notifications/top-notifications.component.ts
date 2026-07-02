import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AndroidOpenFileService } from '@services/android-open-file.service';
import { WorkspaceAccessService } from '@services/workspace-access.service';

/**
 * Stacked top-of-screen notification banners for out-of-band workspace issues:
 *
 * - An Android "Open with" launched a .md file that isn't inside any known
 *   workspace (prompt: open its folder as a workspace).
 * - The active workspace's folder access was lost, e.g. a SAF grant revoked by
 *   reinstall / system Settings (prompt: re-pick the folder).
 *
 * Presentational shell — all state lives in the injected services.
 */
@Component({
	selector: 'app-top-notifications',
	standalone: true,
	imports: [],
	templateUrl: './top-notifications.component.html',
})
export class TopNotificationsComponent {
	private readonly router = inject(Router);
	readonly androidOpenFileService = inject(AndroidOpenFileService);
	readonly workspaceAccessService = inject(WorkspaceAccessService);

	/** Open the workspace creation wizard, then dismiss the unsupported banner. */
	openWorkspaceWizard(): void {
		void this.router.navigate(['/workspace/new']);
		this.androidOpenFileService.dismissUnsupported();
	}
}
