import {
	ChangeDetectionStrategy,
	Component,
	computed,
	inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideZap } from '@lucide/angular';
import { AgentsService } from '@core/agents/agents.service';

/**
 * Amber review bar (Agents Vault v2, frame 1) — surfaces background agent
 * work waiting for approval, right below the note toolbar.
 *
 * Hidden when nothing is pending or after the user dismisses it (per session).
 */
@Component({
	selector: 'app-review-bar',
	standalone: true,
	imports: [LucideZap, RouterLink],
	template: `
		@if (visible()) {
			<div
				class="flex items-center gap-3 px-4 sm:px-5 py-2.5 bg-warn-page border-b border-warn-border"
			>
				<span
					class="flex size-6 items-center justify-center rounded-[7px] bg-warn-tint text-warn-icon flex-shrink-0"
				>
					<svg lucideZap class="size-3.5"></svg>
				</span>
				<span class="flex-1 text-[13px] text-warn-text leading-snug">
					<strong class="font-bold">{{ agentCount() }}
						{{ agentCount() === 1 ? 'agent' : 'agents' }}</strong>
					ran in the background while you were away ·
					<strong class="font-bold"
						>{{ agentsService.pendingReviewCount() }}
						{{
							agentsService.pendingReviewCount() === 1
								? 'change'
								: 'changes'
						}}</strong
					>
					to review
				</span>
				<a
					routerLink="/activity"
					class="inline-flex items-center px-3 py-1.5 rounded-lg bg-warn-icon hover:opacity-90 text-white text-[12.5px] font-semibold no-underline transition-opacity"
					>Review all</a
				>
				<button
					type="button"
					(click)="agentsService.dismissReviewBar()"
					class="hidden sm:inline-flex items-center px-2.5 py-1.5 rounded-lg border-none bg-transparent cursor-pointer text-warn-text text-[12.5px] font-semibold hover:bg-warn-tint transition-colors"
				>
					Dismiss
				</button>
			</div>
		}
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewBarComponent {
	protected readonly agentsService = inject(AgentsService);

	readonly visible = computed(
		() =>
			!this.agentsService.reviewBarDismissed() &&
			this.agentsService.pendingReviewCount() > 0,
	);

	/** Distinct agents with runs pending review. */
	readonly agentCount = computed(
		() =>
			new Set(
				this.agentsService
					.runs()
					.filter((r) => r.status === 'needs-review')
					.map((r) => r.agentId),
			).size,
	);
}
