import {
	ChangeDetectionStrategy,
	Component,
	inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideActivity } from '@lucide/angular';
import { AgentsService } from '@core/agents/agents.service';
import { RailRunItem } from './_rail-run-item';

/**
 * Activity rail (Agents Vault v2, frame 1) — background runs beside the open
 * note. NOT a chat: a quiet log of what agents did, newest first.
 *
 * Rendered by the editor on large screens only; renders nothing when the
 * vault has no agents.
 */
@Component({
	selector: 'app-activity-rail',
	standalone: true,
	imports: [LucideActivity, RouterLink, RailRunItem],
	template: `
		@if (agentsService.hasAgents()) {
			<aside
				class="w-80 flex-shrink-0 h-full border-l border-line bg-canvas flex flex-col"
			>
				<div
					class="px-4.5 py-3.5 border-b border-line-soft flex items-center gap-2.5"
				>
					<svg lucideActivity class="size-4 text-ink-2"></svg>
					<span class="text-sm font-bold text-ink-1 flex-1"
						>Activity</span
					>
					@if (agentsService.runningCount() > 0) {
						<span
							class="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-accent-text bg-accent-bg rounded-full px-2 py-0.5"
						>
							<span
								class="size-1.5 rounded-full bg-accent-2"
							></span>
							{{ agentsService.runningCount() }} running
						</span>
					}
				</div>
				<div class="flex-1 overflow-y-auto px-3 py-2">
					@for (run of agentsService.runs(); track run.id) {
						<app-rail-run-item [run]="run" />
					}
				</div>
				<div class="px-4.5 py-3 border-t border-line-soft">
					<a
						routerLink="/activity"
						class="text-[12.5px] font-semibold text-accent-text no-underline hover:underline"
						>View all activity →</a
					>
				</div>
			</aside>
		}
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityRailComponent {
	protected readonly agentsService = inject(AgentsService);
}
