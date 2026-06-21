import {
	ChangeDetectionStrategy,
	Component,
	input,
	output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { getAdapterSchema } from '@core/adapters/config-schema';
import { AdapterConfigFormComponent } from '@ui/partials/adapter-config-form/adapter-config-form.component';
import { LucideTrash2, LucideSettings, LucideCloud } from '@lucide/angular';
import type { AdapterConfig } from '@core/adapters/adapter.interface';
import type { Workspace } from '@services/workspace.service';

@Component({
	selector: 'app-adapter-row',
	standalone: true,
	imports: [
		CommonModule,
		AdapterConfigFormComponent,
		LucideTrash2,
		LucideSettings,
		LucideCloud,
	],
	templateUrl: './adapter-row.html',
	styleUrl: './adapter-row.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdapterRow {
	readonly workspace = input.required<Workspace>();
	readonly adapterId = input.required<string>();
	readonly isConfiguring = input(false);

	readonly edit = output();
	readonly remove = output();
	readonly configSave = output<AdapterConfig>();
	readonly configCancel = output();

	isLocal(adapterId: string): boolean {
		return (
			adapterId === 'tauri-fs' ||
			adapterId === 'browser-file-system-api' ||
			adapterId === 'test-fs'
		);
	}

	getLabel(adapterId: string): string {
		const schema = getAdapterSchema(adapterId);
		if (schema) return schema.label;
		if (adapterId === 'tauri-fs') return 'Local (Tauri)';
		if (adapterId === 'browser-file-system-api') return 'Local (Browser)';
		if (adapterId === 'test-fs') return 'Local (Test)';
		return adapterId;
	}

	getConfig(ws: Workspace, adapterId: string): AdapterConfig | undefined {
		return ws.adapterConfigs.find((c) => c.adapterId === adapterId);
	}
}
