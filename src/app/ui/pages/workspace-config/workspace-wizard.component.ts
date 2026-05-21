import {
	ChangeDetectionStrategy,
	Component,
	computed,
	inject,
	signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
	LucideFolder,
	LucideStickyNote,
	LucidePlus,
	LucideCloud,
} from '@lucide/angular';
import { AdaptersManager } from '@core/adapters/manager';
import { WorkspaceService } from '@services/workspace.service';
import type { AdapterConfig } from '@core/adapters/adapter.interface';

/** Wizard step number (1-based) */
type WizardStep = 1 | 2 | 3;

/** Workspace creation mode */
type CreationMode = 'folder' | 'standalone';

/**
 * 3-step workspace creation wizard.
 *
 * Step 1 — Choose mode (folder-backed or standalone)
 * Step 2 — Name / folder selection
 * Step 3 — Remote adapter selection (stub)
 *
 * Route-based (works on both desktop & mobile).
 * State is component-local via signals — no dedicated service needed.
 */
@Component({
	selector: 'app-workspace-wizard',
	standalone: true,
	imports: [
		CommonModule,
		FormsModule,
		LucideFolder,
		LucideStickyNote,
		LucidePlus,
		LucideCloud,
	],
	templateUrl: './workspace-wizard.component.html',
	styleUrl: './workspace-wizard.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceWizardComponent {
	private readonly router = inject(Router);
	private readonly adapterManager = inject(AdaptersManager);
	private readonly workspaceService = inject(WorkspaceService);

	// ── Wizard state (all component-local signals) ──────────────

	/** Current step */
	readonly step = signal<WizardStep>(1);

	/** Selected creation mode (null until chosen) */
	readonly mode = signal<CreationMode | null>(null);

	readonly isFolderMode = computed(() => this.mode() === 'folder');
	readonly isStandaloneMode = computed(() => this.mode() === 'standalone');

	/** Workspace name (standalone mode) */
	readonly workspaceName = signal('');

	/** Selected folder path (folder mode) */
	readonly folderPath = signal<string | null>(null);

	/** Selected folder display name (folder mode) */
	readonly folderName = signal<string | null>(null);

	/** Whether a folder picker operation is in progress */
	readonly pickingFolder = signal(false);

	/** Whether a local folder adapter is available */
	readonly hasLocalAdapter =
		this.adapterManager.getWorkspacePickerAdapter() !== null;

	// ── Step navigation ────────────────────────────────────────

	/** Go to the previous step */
	goBack(): void {
		this.step.update((s) => Math.max(1, s - 1) as WizardStep);
	}

	/** Cancel the wizard — navigate back */
	cancel(): void {
		void this.router.navigate(['/workspace']);
	}

	// ── Step 1: Mode selection ─────────────────────────────────

	/** Select 'folder' mode and advance to step 2 */
	selectFolderMode(): void {
		if (!this.hasLocalAdapter) return;
		this.mode.set('folder');
		this.step.set(2);
	}

	/** Select 'standalone' mode and advance to step 2 */
	selectStandaloneMode(): void {
		this.mode.set('standalone');
		this.step.set(2);
	}

	// ── Step 2: Folder picking / name input ────────────────────

	/** Open the native folder picker via the local adapter */
	async pickFolder(): Promise<void> {
		const adapter = this.adapterManager.getWorkspacePickerAdapter();
		if (!adapter) return;

		this.pickingFolder.set(true);
		try {
			const result = await adapter.pickWorkspaceFolder();
			if (result) {
				this.folderPath.set(result.path);
				this.folderName.set(result.name);
			}
		} finally {
			this.pickingFolder.set(false);
		}
	}

	/** Advance to step 3 */
	goToStep3(): void {
		if (this.isFolderMode() && !this.folderPath()) return;
		if (this.isStandaloneMode() && !this.workspaceName().trim()) return;
		this.step.set(3);
	}

	// ── Step 3: Completion ─────────────────────────────────────

	/** Finalise workspace creation and close the wizard */
	completeWizard(): void {
		const name = this.isFolderMode()
			? (this.folderName() ?? 'Untitled')
			: this.workspaceName().trim() || 'Untitled';

		const id = `ws-${Date.now().toString()}`;
		const pickerAdapter = this.adapterManager.getWorkspacePickerAdapter();
		const activeSyncAdapters =
			this.isFolderMode() && this.folderPath() && pickerAdapter
				? [pickerAdapter.id]
				: [];
		const adapterConfig: AdapterConfig[] = [];
		if (this.isFolderMode() && this.folderPath() && pickerAdapter) {
			adapterConfig.push({
				adapterId: pickerAdapter.id,
				path: this.folderPath() ?? '',
			});
		}
		const workspace = {
			id,
			name,
			activeSyncAdapters,
			adapterConfigs: adapterConfig,
		};

		this.workspaceService.addWorkspace(workspace);
		this.workspaceService.activateWorkspace(id);
		// Navigate away from wizard
		void this.router.navigate(['/']);
	}
}
