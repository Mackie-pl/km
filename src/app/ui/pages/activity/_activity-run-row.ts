import {
	ChangeDetectionStrategy,
	Component,
	input,
	output,
} from '@angular/core';
import {
	LucideClock,
	LucidePencil,
	LucidePlus,
	LucideZap,
} from '@lucide/angular';
import type { AgentRun } from '@core/agents/agents.service';
import { RunStatusPill } from '@ui/partials/agents/run-status-pill.component';

/**
 * A single completed-run row in the Activity feed.
 * Extracted to avoid deep HTML nesting in the @for loop parent.
 *
 * Desktop: one flex row (chip · agent · trigger · summary · status · time).
 * Mobile: the summary wraps to its own line under the agent name.
 */
@Component({
	selector: 'app-activity-run-row',
	standalone: true,
	imports: [LucideClock, LucidePencil, LucidePlus, LucideZap, RunStatusPill],
	template: `
		<div
			class="flex flex-wrap sm:flex-nowrap items-center gap-x-3.5 gap-y-1 px-4 py-3 border-b border-hairline last:border-b-0"
		>
			<span
				class="flex size-5.5 items-center justify-center rounded-md flex-shrink-0"
				[class.bg-accent-bg]="run().status === 'needs-review'"
				[class.text-accent]="run().status === 'needs-review'"
				[class.bg-hairline]="run().status !== 'needs-review'"
				[class.text-ink-3]="run().status !== 'needs-review'"
			>
				<svg lucideZap class="size-3"></svg>
			</span>
			<span
				class="text-[13.5px] font-semibold text-ink-1 sm:min-w-22 truncate"
				>{{ run().agentName }}</span
			>
			<span
				class="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 sm:min-w-28"
			>
				@switch (run().trigger) {
					@case ('create') {
						<svg lucidePlus class="size-3.5 text-ink-4"></svg>
					}
					@case ('edit') {
						<svg lucidePencil class="size-3.5 text-ink-4"></svg>
					}
					@default {
						<svg lucideClock class="size-3.5 text-ink-4"></svg>
					}
				}
				{{ run().triggerLabel }}
			</span>
			<span
				class="basis-full sm:basis-0 sm:flex-1 order-last sm:order-none text-[13px] text-ink-2 pl-9 sm:pl-0"
				>{{ run().summary }}</span
			>
			<app-run-status-pill [status]="run().status" />
			@if (run().status === 'needs-review' && run().notePath) {
				<button
					type="button"
					(click)="review.emit()"
					class="inline-flex items-center px-3 py-1 rounded-lg border-none bg-accent hover:bg-accent-2 text-white text-xs font-semibold cursor-pointer transition-colors"
				>
					Review
				</button>
			}
			<span
				class="text-xs text-ink-4 min-w-10 text-right ml-auto sm:ml-0"
				>{{ run().when }}</span
			>
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityRunRow {
	readonly run = input.required<AgentRun>();
	readonly review = output();
}
