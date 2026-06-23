import {
	ChangeDetectionStrategy,
	Component,
	computed,
	inject,
	input,
	type OnInit,
	output,
	signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideX, LucideCheck, LucideLoader } from '@lucide/angular';
import { getAdapterSchema, type ConfigField } from '@core/adapters/config-schema';
import { ADAPTERS } from '@core/adapters/token';
import { ConfigFieldComponent } from './config-field.component';
import type { AdapterConfig } from '@core/adapters/adapter.interface';

/**
 * Schema-driven adapter configuration form.
 *
 * Renders dynamic form fields based on the AdapterConfigSchema for the
 * given adapterId. Handles create (no existingConfig) and edit (with
 * existingConfig) modes. Emits the assembled AdapterConfig on save.
 */
@Component({
	selector: 'app-adapter-config-form',
	standalone: true,
	imports: [
		CommonModule,
		LucideX,
		LucideCheck,
		LucideLoader,
		ConfigFieldComponent,
	],
	templateUrl: './adapter-config-form.component.html',
	styleUrl: './adapter-config-form.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdapterConfigFormComponent implements OnInit {
	/** Adapter type to configure — must have an entry in config-schema.ts. */
	readonly adapterId = input<string>();

	/** Optional existing config for edit mode (pre-populates fields). */
	readonly existingConfig = input<AdapterConfig | undefined>();

	/** True when editing an already-saved adapter (vs. adding a new one). */
	readonly isEditing = computed(() => this.existingConfig() !== undefined);

	/** Emits the assembled config on successful save. */
	readonly save = output<AdapterConfig>();

	/** Emits when the user cancels without saving. */
	readonly cancel = output();

	private readonly adapters = inject(ADAPTERS);

	/** Resolved schema for the current adapter. */
	readonly schema = computed(() => {
		const id = this.adapterId();
		if (!id) return null;
		return getAdapterSchema(id);
	});

	/**
	 * Fields to render. Identical to the schema in add mode. When editing, secret
	 * (password) fields become optional with a "leave blank to keep current" hint —
	 * the stored value is preserved unless the user types a replacement.
	 */
	readonly formFields = computed<ConfigField[]>(() => {
		const schema = this.schema();
		if (!schema) return [];
		if (!this.isEditing()) return schema.fields;
		return schema.fields.map((f) =>
			f.type === 'password'
				? {
						...f,
						required: false,
						placeholder: 'Leave blank to keep current',
					}
				: f,
		);
	});

	/** Current form values keyed by field key. */
	readonly formValues = signal<Record<string, string | number>>({});

	/** Validation error message, or null if valid. */
	readonly validationError = signal<string | null>(null);

	/** Whether a connection test is in progress. */
	readonly testingConnection = signal(false);

	ngOnInit(): void {
		// Pre-populate from existing config or schema defaults. Done in ngOnInit
		// (not the constructor) because signal `input()` values are only bound
		// after construction — reading them earlier yields undefined.
		const existing = this.existingConfig();
		const schema = this.schema();
		if (!schema) return;

		const initial: Record<string, string | number> = {};
		for (const field of schema.fields) {
			if (existing) {
				const val = (existing as unknown as Record<string, unknown>)[
					field.key
				];
				if (val !== undefined) {
					initial[field.key] = val as string | number;
				}
			} else if (field.defaultValue !== undefined) {
				initial[field.key] = field.defaultValue;
			}
		}
		this.formValues.set(initial);
	}

	/** Get the current value for a field, or empty string. */
	getFieldValue(field: { key: string }): string | number {
		const val = this.formValues()[field.key];
		return val ?? '';
	}

	/** Update a field value on input change. */
	onFieldChange(change: { key: string; value: string | number }): void {
		this.formValues.update((vals) => ({
			...vals,
			[change.key]: change.value,
		}));
		this.validationError.set(null);
	}

	/** Validate required fields and test connection, then emit the assembled config. */
	async onSave(): Promise<void> {
		const config = this.#buildConfig();
		if (!config) return;

		const ok = await this.#testConnection(config);
		if (!ok) return;

		this.save.emit(config);
	}

	/** Validate required fields and assemble the config object. Returns null if invalid. */
	#buildConfig(): AdapterConfig | null {
		const fields = this.formFields();
		if (fields.length === 0) return null;

		for (const field of fields) {
			if (!field.required) continue;
			const val = this.formValues()[field.key];
			if (val === undefined || val === '') {
				this.validationError.set(`"${field.label}" is required.`);
				return null;
			}
		}

		const config: Record<string, unknown> = {
			adapterId: this.adapterId(),
		};
		for (const field of fields) {
			const val = this.formValues()[field.key];
			// Omit blank fields so a secret left blank on edit doesn't overwrite
			// the stored value with an empty string (testConnection then keeps it).
			if (val === undefined || val === '') continue;
			config[field.key] = val;
		}

		return config as unknown as AdapterConfig;
	}

	/** Test connection on the adapter before saving. Returns false if test fails. */
	async #testConnection(config: AdapterConfig): Promise<boolean> {
		const adapterInstance = this.adapters.find(
			(a) => a.id === this.adapterId(),
		);
		if (!adapterInstance?.testConnection) return true;

		this.testingConnection.set(true);
		this.validationError.set(null);
		try {
			const result = await adapterInstance.testConnection(config);
			if (!result.ok) {
				this.validationError.set(
					result.error ?? 'Connection test failed',
				);
				return false;
			}
			return true;
		} catch (err: unknown) {
			this.validationError.set(
				err instanceof Error ? err.message : 'Connection test failed',
			);
			return false;
		} finally {
			this.testingConnection.set(false);
		}
	}

	/** Emit cancel. */
	onCancel(): void {
		this.cancel.emit();
	}
}
