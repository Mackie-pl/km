import { Injectable, signal, effect } from '@angular/core';
import { STORAGE_KEY } from '../types/constants';

/**
 * Strongly-typed application settings schema.
 * Currently a skeleton — adapter settings have moved to workspace scope.
 * Ready for future global settings (e.g., editor preferences, UI layout).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AppSettings {
	// Placeholder for future global settings
}

/**
 * Type guard: validate entire settings object
 */
function isValidAppSettings(value: unknown): value is AppSettings {
	return typeof value === 'object' && value !== null;
}

/**
 * Factory function for default settings
 */
function createDefaultSettings(): AppSettings {
	return {};
}

/**
 * Global settings service — provided in root so it's constructed once at app boot.
 *
 * Currently a skeleton. Adapter-specific settings (activeSyncAdapters,
 * adapterConfigs) live on the Workspace object via WorkspaceService.
 *
 * Features:
 * - Strongly typed settings with full validation
 * - Angular Signals for reactive state management
 * - Automatic persistence to localStorage
 * - Safe fallback to defaults on corrupted data
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
	/** Current application settings */
	readonly settings = signal<AppSettings>(this.loadSettings());

	constructor() {
		// Auto-persist settings whenever they change
		effect(() => {
			const current = this.settings();
			this.persistSettings(current);
		});
	}

	/**
	 * Reset all settings to defaults
	 */
	resetToDefaults(): void {
		this.settings.set(createDefaultSettings());
	}

	/**
	 * Load settings from localStorage with full validation.
	 * Falls back to defaults if data is missing or corrupted.
	 */
	private loadSettings(): AppSettings {
		try {
			const stored = localStorage.getItem(STORAGE_KEY.SETTINGS);

			if (!stored) {
				return createDefaultSettings();
			}

			const parsed: unknown = JSON.parse(stored);

			if (isValidAppSettings(parsed)) {
				return parsed;
			}

			console.warn(
				'SettingsService: Stored settings are invalid, falling back to defaults',
				parsed,
			);
			return createDefaultSettings();
		} catch (error) {
			console.error(
				'SettingsService: Error loading settings from localStorage:',
				error,
			);
			return createDefaultSettings();
		}
	}

	/**
	 * Persist settings to localStorage as JSON.
	 */
	private persistSettings(settings: AppSettings): void {
		try {
			if (!isValidAppSettings(settings)) {
				throw new Error('Invalid settings object structure');
			}
			const json = JSON.stringify(settings);
			localStorage.setItem(STORAGE_KEY.SETTINGS, json);
		} catch (error) {
			console.error(
				'SettingsService: Error persisting settings to localStorage:',
				error,
			);
		}
	}
}

