import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '@services/theme.service';
import { Theme } from '@core/types/constants';
import { SettingsService } from '@services/settings.service';
import { ThemeButton } from '@ui/partials/settings/_theme-button';
import { BUILD_INFO } from '@build-info';

/**
 * Settings screen — shared between modal (desktop) and full-page route (mobile).
 * Delegates theme state and logic to the global ThemeService,
 * and debug settings to SettingsService.
 */
@Component({
	selector: 'app-settings',
	standalone: true,
	imports: [CommonModule, ThemeButton],
	templateUrl: './settings.component.html',
	styleUrl: './settings.component.scss',
})
export class SettingsComponent {
	private readonly themeService = inject(ThemeService);
	private readonly settingsService = inject(SettingsService);

	/** Currently selected theme (from the global service) */
	readonly theme = this.themeService.theme;

	/** Available theme options with labels */
	readonly themes = this.themeService.themes;

	/** Reactive debug toggle state from SettingsService */
	readonly debugSync = this.settingsService.settings;

	/** App version / git SHA / build time, stamped at build (see build-info.ts) */
	readonly buildInfo = BUILD_INFO;

	/** Human-friendly build timestamp, or 'dev build' when un-stamped */
	readonly buildTime = BUILD_INFO.builtAt
		? new Date(BUILD_INFO.builtAt).toLocaleString()
		: 'dev build';

	/** Select a theme — delegates to ThemeService which persists + applies it */
	setTheme(mode: Theme): void {
		this.themeService.setTheme(mode);
	}

	/** Toggle sync debug logging on/off */
	toggleDebugSync(): void {
		this.settingsService.toggleDebugSync();
	}
}
