import {
	ChangeDetectionStrategy,
	Component,
	input,
	output,
	signal,
	inject,
	computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdaptersManager } from '@core/adapters/manager';
import { WorkspaceService } from '@services/workspace.service';
import { getAdapterSchema } from '@core/adapters/config-schema';
import { AdapterConfigFormComponent } from '@ui/partials/adapter-config-form/adapter-config-form.component';
import { AddAdapterButton } from './add-adapter-button';
import type { AdapterConfig } from '@core/adapters/adapter.interface';
import type { Workspace } from '@services/workspace.service';

@Component({
	selector: 'app-add-adapter-section',
	standalone: true,
	imports: [CommonModule, AdapterConfigFormComponent, AddAdapterButton],
	template: `
		<span
			class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
		>
			Add Adapter
		</span>

		<div class="flex flex-wrap gap-2 mt-2">
			@for (adapter of adapters(); track adapter.id) {
				@if (configuringId() === adapter.id) {
					<app-adapter-config-form
						[adapterId]="adapter.id"
						class="block w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
						(save)="onSave(adapter.id, $event)"
						(cancel)="onCancel()"
					></app-adapter-config-form>
				} @else {
					<app-add-adapter-button
						[label]="getLabel(adapter.id)"
						(configure)="onConfigure(adapter.id)"
					></app-add-adapter-button>
				}
			}
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddAdapterSection {
	private readonly adapterManager = inject(AdaptersManager);
	private readonly workspaceService = inject(WorkspaceService);

	readonly workspace = input.required<Workspace>();
	readonly save = output<{ adapterId: string; config: AdapterConfig }>();

	readonly configuringId = signal<string | null>(null);

	readonly adapters = computed(() => {
		const ws = this.workspace();
		return this.adapterManager
			.getAdaptersByIds(['git', 'gdrive'])
			.filter(
				(a) => a.isAvailable() && !ws.activeSyncAdapters.includes(a.id),
			);
	});

	getLabel(adapterId: string): string {
		const schema = getAdapterSchema(adapterId);
		return schema?.label ?? adapterId;
	}

	onConfigure(adapterId: string): void {
		this.configuringId.set(adapterId);
	}

	onSave(adapterId: string, config: AdapterConfig): void {
		const ws = this.workspace();
		this.workspaceService.setAdapterConfig(ws.id, config);
		if (!ws.activeSyncAdapters.includes(adapterId)) {
			this.workspaceService.setWorkspaceAdapters(ws.id, [
				...ws.activeSyncAdapters,
				adapterId,
			]);
		}
		this.configuringId.set(null);
		this.save.emit({ adapterId, config });
	}

	onCancel(): void {
		this.configuringId.set(null);
	}
}
