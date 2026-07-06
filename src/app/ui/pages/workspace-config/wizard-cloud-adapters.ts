import {
	ChangeDetectionStrategy,
	Component,
	computed,
	inject,
	output,
	signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideCloud } from '@lucide/angular';
import { AdaptersManager } from '@core/adapters/manager';
import { getAdapterSchema } from '@core/adapters/config-schema';
import { AdapterConfigFormComponent } from '@ui/partials/adapter-config-form/adapter-config-form.component';
import type { AdapterConfig } from '@core/adapters/adapter.interface';

/**
 * Cloud-adapter setup for the creation wizard (step 3).
 *
 * Lists the cloud adapters available on the current runtime (Google Drive in
 * the browser, Git under Tauri) and reuses the schema-driven
 * {@link AdapterConfigFormComponent} to configure them — including the OAuth
 * sign-in that runs inside the form's `testConnection` on save. Emits the set of
 * configured adapter configs so the wizard can attach them to the new workspace.
 */
@Component({
	selector: 'app-wizard-cloud-adapters',
	standalone: true,
	imports: [CommonModule, LucideCloud, AdapterConfigFormComponent],
	template: `
		<div class="space-y-3">
			@for (adapter of adapters(); track adapter.id) {
				@if (configuringId() === adapter.id) {
					<app-adapter-config-form
						[adapterId]="adapter.id"
						class="block w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
						(save)="save(adapter.id, $event)"
						(cancel)="cancel()"
					></app-adapter-config-form>
				} @else {
					<div
						class="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3"
					>
						<svg lucideCloud class="size-5 text-gray-400"></svg>
						<span
							class="text-sm font-medium text-gray-900 dark:text-gray-100"
						>
							{{ label(adapter.id) }}
						</span>
						@if (isConfigured(adapter.id)) {
							<span
								class="ml-auto inline-flex items-center rounded-full bg-green-100 dark:bg-green-900 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-300"
							>
								Connected
							</span>
						} @else {
							<button
								type="button"
								(click)="configure(adapter.id)"
								class="ml-auto rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
							>
								Set up
							</button>
						}
					</div>
				}
			} @empty {
				<p class="text-sm text-gray-500 dark:text-gray-400">
					No cloud sync adapters are available on this platform.
				</p>
			}
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WizardCloudAdapters {
	private readonly adapterManager = inject(AdaptersManager);

	/** Emits the full list of configured cloud configs whenever it changes. */
	readonly configured = output<AdapterConfig[]>();

	/** Cloud adapters usable on the current runtime. */
	readonly adapters = computed(() =>
		this.adapterManager
			.getAdaptersByIds(['gdrive', 'git'])
			.filter((a) => a.isAvailable()),
	);

	readonly configuringId = signal<string | null>(null);
	private readonly pending = signal<Record<string, AdapterConfig>>({});

	label(adapterId: string): string {
		return getAdapterSchema(adapterId)?.label ?? adapterId;
	}

	isConfigured(adapterId: string): boolean {
		return this.pending()[adapterId] !== undefined;
	}

	configure(adapterId: string): void {
		this.configuringId.set(adapterId);
	}

	cancel(): void {
		this.configuringId.set(null);
	}

	save(adapterId: string, config: AdapterConfig): void {
		this.pending.update((m) => ({ ...m, [adapterId]: config }));
		this.configuringId.set(null);
		this.configured.emit(Object.values(this.pending()));
	}
}
