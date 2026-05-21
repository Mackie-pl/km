import { Component, inject, output } from '@angular/core';
import { PlatformService } from '@services/platform.service';
import { LucideMenu, LucideSettings } from '@lucide/angular';

/**
 * Top header bar — shows the app title, a hamburger menu on mobile,
 * and a settings gear icon.
 *
 * Purely presentational — emits events upward for sidebar toggle and settings.
 */
@Component({
	selector: 'app-header',
	standalone: true,
	imports: [LucideMenu, LucideSettings],
	templateUrl: './header.component.html',
	styleUrl: './header.component.scss',
})
export class HeaderComponent {
	readonly platformService = inject(PlatformService);

	/** Emitted when the hamburger menu is clicked (mobile only) */
	readonly toggleSidebar = output();

	/** Emitted when the settings gear is clicked */
	readonly openSettings = output();
}
