import {
	ChangeDetectionStrategy,
	Component,
	input,
	output,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideArchive } from '@lucide/angular';

/**
 * "Archive" entry in the sidebar footer — opens the Archived/Trash page.
 * Extracted to keep the sidebar template within the nesting limit.
 */
@Component({
	selector: 'app-sidebar-archive-link',
	standalone: true,
	imports: [LucideArchive, RouterLink, RouterLinkActive],
	template: `
		<a
			routerLink="/archive"
			routerLinkActive="bg-accent-bg2 text-accent-deep"
			(click)="pressed.emit()"
			class="flex items-center w-full gap-3 py-2 rounded-lg cursor-pointer transition-colors duration-150 text-left no-underline text-ink-2 hover:bg-hairline hover:text-ink-1"
			[class.px-3]="showLabel()"
			[class.justify-center]="!showLabel()"
			aria-label="Archive"
		>
			<svg lucideArchive class="size-4.5 flex-shrink-0"></svg>
			@if (showLabel()) {
				<span class="text-[13px] font-medium flex-1">Archive</span>
			}
		</a>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarArchiveLink {
	/** Whether the text label is visible — false when collapsed. */
	readonly showLabel = input(true);

	/** Emitted on click so the mobile sidebar can close. */
	readonly pressed = output();
}
