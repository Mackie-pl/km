import {
	ChangeDetectionStrategy,
	Component,
	inject,
	input,
	output,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideActivity } from '@lucide/angular';
import { AgentsService } from '@core/agents/agents.service';

/**
 * "Activity" entry in the sidebar footer with a running-count badge.
 * Renders nothing when the vault has no agents.
 * Extracted to keep the sidebar template within the nesting limit.
 */
@Component({
	selector: 'app-sidebar-activity-link',
	standalone: true,
	imports: [LucideActivity, RouterLink, RouterLinkActive],
	template: `
		@if (agentsService.hasAgents()) {
			<a
				routerLink="/activity"
				routerLinkActive="bg-accent-bg2 text-accent-deep"
				(click)="pressed.emit()"
				class="flex items-center w-full gap-3 py-2 rounded-lg cursor-pointer transition-colors duration-150 text-left no-underline text-ink-2 hover:bg-hairline hover:text-ink-1"
				[class.px-3]="showLabel()"
				[class.justify-center]="!showLabel()"
				aria-label="Activity"
			>
				<svg lucideActivity class="size-4.5 flex-shrink-0"></svg>
				@if (showLabel()) {
					<span class="text-[13px] font-medium flex-1">Activity</span>
					@if (agentsService.runningCount() > 0) {
						<span
							class="text-[11px] font-semibold text-white bg-accent-2 rounded-full px-1.75 py-px"
							>{{ agentsService.runningCount() }}</span
						>
					}
				}
			</a>
		}
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarActivityLink {
	protected readonly agentsService = inject(AgentsService);

	/** Whether the text label (and badge) are visible — false when collapsed. */
	readonly showLabel = input(true);

	/** Emitted on click so the mobile sidebar can close. */
	readonly pressed = output();
}
