import {
	ChangeDetectionStrategy,
	Component,
	input,
	output,
} from '@angular/core';
import type { AgentRun } from '@core/agents/agents.service';
import { ActivityRunRow } from './_activity-run-row';
import { RunningRunCard } from './_running-run-card';

/**
 * The Activity feed — runs grouped into "running now", "earlier today", and
 * "yesterday". Extracted to keep the page template within the nesting limit.
 */
@Component({
	selector: 'app-run-feed',
	standalone: true,
	imports: [ActivityRunRow, RunningRunCard],
	template: `
		@if (runningNow().length) {
			<div
				class="text-[11px] font-bold tracking-[0.06em] text-ink-4 px-7 sm:px-9 pt-4 pb-2"
			>
				RUNNING NOW
			</div>
			@for (run of runningNow(); track run.id) {
				<app-running-run-card class="block mx-4 sm:mx-6" [run]="run" />
			}
		}

		@if (earlierToday().length) {
			<div
				class="text-[11px] font-bold tracking-[0.06em] text-ink-4 px-7 sm:px-9 pt-5 pb-2"
			>
				EARLIER TODAY
			</div>
			<div
				class="mx-4 sm:mx-6 border border-line rounded-xl overflow-hidden bg-surface"
			>
				@for (run of earlierToday(); track run.id) {
					<app-activity-run-row
						[run]="run"
						(review)="review.emit(run)"
					/>
				}
			</div>
		}

		@if (yesterday().length) {
			<div
				class="text-[11px] font-bold tracking-[0.06em] text-ink-4 px-7 sm:px-9 pt-5 pb-2"
			>
				YESTERDAY
			</div>
			<div
				class="mx-4 sm:mx-6 border border-line rounded-xl overflow-hidden bg-surface"
			>
				@for (run of yesterday(); track run.id) {
					<app-activity-run-row
						[run]="run"
						(review)="review.emit(run)"
					/>
				}
			</div>
		}

		@if (
			!runningNow().length && !earlierToday().length && !yesterday().length
		) {
			<div class="px-4 py-16 text-center text-sm text-ink-4">
				No runs match this filter.
			</div>
		}
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunFeed {
	readonly runningNow = input.required<AgentRun[]>();
	readonly earlierToday = input.required<AgentRun[]>();
	readonly yesterday = input.required<AgentRun[]>();

	/** Emitted when a row's Review button is clicked. */
	readonly review = output<AgentRun>();
}
