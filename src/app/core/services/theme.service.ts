import { Injectable, signal, effect } from '@angular/core';
import { STORAGE_KEY, THEME, type Theme } from '../types/constants';

const THEME_KEY = STORAGE_KEY.THEME;

/**
 * Global theme service — provided in root so it's constructed once at app boot.
 *
 * Applies the persisted or system theme to <html> immediately on construction,
 * ensuring dark mode is active on every route, not just the Settings screen.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
	/** Currently selected theme (light | dark | system) */
	readonly theme = signal<Theme>(this.loadTheme());

	/** Available theme options for the settings UI */
	readonly themes: { value: Theme; label: string }[] = [
		{ value: THEME.LIGHT, label: 'Light' },
		{ value: THEME.DARK, label: 'Dark' },
		{ value: THEME.SYSTEM, label: 'System' },
	];

	constructor() {
		// console.debug("ThemeService initialized with theme:", this.theme());
		// Apply the theme immediately — no need to wait for any component to mount
		this.apply(this.theme());

		// When in "system" mode, re-apply if the user ever opens settings and the
		// theme signal is still "system" (the effect re-runs on each change).
		// Also listen for OS-level preference changes so system mode stays in sync.
		effect(() => {
			if (this.theme() === THEME.SYSTEM) {
				this.apply(THEME.SYSTEM);
			}
		});
	}

	/** Select a theme, persist it, and apply it globally */
	setTheme(mode: Theme): void {
		this.theme.set(mode);
		localStorage.setItem(THEME_KEY, mode);
		this.apply(mode);
	}

	/** Toggle the .dark class on <html> and sync Taiga to the resolved theme */
	private apply(mode: Theme): void {
		const isDark =
			mode === THEME.SYSTEM
				? window.matchMedia('(prefers-color-scheme: dark)').matches
				: mode === THEME.DARK;

		document.documentElement.classList.toggle('dark', isDark);
	}

	/** Read the persisted theme from localStorage, default to "system" */
	private loadTheme(): Theme {
		const stored = localStorage.getItem(THEME_KEY);
		if (
			stored === THEME.LIGHT ||
			stored === THEME.DARK ||
			stored === THEME.SYSTEM
		) {
			return stored;
		}
		return THEME.SYSTEM;
	}
}
