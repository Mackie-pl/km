import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideSun, LucideMoon, LucideMonitor } from '@lucide/angular';
import { ThemeService } from '@services/theme.service';
import { Theme } from '@core/types/constants';

/**
 * Settings screen — shared between modal (desktop) and full-page route (mobile).
 * Delegates theme state and logic to the global ThemeService.
 */
@Component({
	selector: 'app-settings',
	standalone: true,
	imports: [CommonModule, LucideSun, LucideMoon, LucideMonitor],
	templateUrl: './settings.component.html',
	styleUrl: './settings.component.scss',
})
export class SettingsComponent {
	private readonly themeService = inject(ThemeService);

	/** Currently selected theme (from the global service) */
	readonly theme = this.themeService.theme;

	/** Available theme options with labels */
	readonly themes = this.themeService.themes;

	/** Select a theme — delegates to ThemeService which persists + applies it */
	setTheme(mode: Theme): void {
		this.themeService.setTheme(mode);
	}
}
