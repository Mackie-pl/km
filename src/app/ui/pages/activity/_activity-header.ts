import {
	ChangeDetectionStrategy,
	Component,
	inject,
	model,
} from '@angular/core';
import { LucideActivity } from '@lucide/angular';
import {
	AgentsService,
	type TriggerKind,
} from '@core/agents/agents.service';

/** Feed filter — trigger kind, review queue, or everything. */
export type ActivityFilter = 'all' | TriggerKind | 'needs-review';

/**
 * Activity page header: title with running pill, the four stat cards, and
 * the filter pills. Extracted to keep the page template within the nesting
 * limit. `filter` is a two-way model owned by the page.
 */
@Component({
	selector: 'app-activity-header',
	standalone: true,
	imports: [LucideActivity],
	template: `
		<div class="px-4 sm:px-8 pt-6 pb-4 border-b border-line">
			<div class="flex items-center gap-3 mb-4">
				<svg lucideActivity class="size-5.5 text-ink-1"></svg>
				<h1
					class="text-[24px] font-bold tracking-[-0.01em] text-ink-1 m-0"
				>
					Activity
				</h1>
				@if (agentsService.runningCount() > 0) {
					<span
						class="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-text bg-accent-bg rounded-full px-2.5 py-1"
					>
						<span class="size-1.5 rounded-full bg-accent-2"></span>
						{{ agentsService.runningCount() }} running
					</span>
				}
			</div>

			<!-- Stat cards -->
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
				<div
					class="bg-surface-3 border border-line rounded-[11px] px-4 py-3"
				>
					<div class="text-[22px] font-bold text-ink-1">
						{{ agentsService.runsToday() }}
					</div>
					<div class="text-xs text-ink-4 mt-px">runs today</div>
				</div>
				<div
					class="bg-warn-page border border-warn-border rounded-[11px] px-4 py-3"
				>
					<div class="text-[22px] font-bold text-warn-text">
						{{ agentsService.pendingReviewCount() }}
					</div>
					<div class="text-xs text-warn-text mt-px">pending review</div>
				</div>
				<div
					class="bg-surface-3 border border-line rounded-[11px] px-4 py-3"
				>
					<div class="text-[22px] font-bold text-ok-text">
						{{ agentsService.autoAppliedToday() }}
					</div>
					<div class="text-xs text-ink-4 mt-px">auto-applied</div>
				</div>
				<div
					class="bg-surface-3 border border-line rounded-[11px] px-4 py-3"
				>
					<div class="text-[22px] font-bold text-ink-1">
						{{ agentsService.enabledCount() }}
					</div>
					<div class="text-xs text-ink-4 mt-px">agents enabled</div>
				</div>
			</div>

			<!-- Filter pills -->
			<div class="flex flex-wrap gap-2">
				@for (f of filters; track f.value) {
					<button
						type="button"
						(click)="filter.set(f.value)"
						class="border-none cursor-pointer rounded-lg px-3 py-1.5 text-[12.5px] transition-colors"
						[class.bg-ink-1]="filter() === f.value"
						[class.text-canvas]="filter() === f.value"
						[class.font-semibold]="filter() === f.value"
						[class.bg-hairline]="filter() !== f.value"
						[class.text-ink-2]="filter() !== f.value"
						[class.font-medium]="filter() !== f.value"
					>
						{{ f.label }}
					</button>
				}
				<button
					type="button"
					(click)="filter.set('needs-review')"
					class="cursor-pointer rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors bg-warn-page text-warn-text border border-warn-border"
					[class.ring-1]="filter() === 'needs-review'"
					[class.ring-warn-icon]="filter() === 'needs-review'"
				>
					Needs review · {{ agentsService.pendingReviewCount() }}
				</button>
			</div>
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityHeader {
	protected readonly agentsService = inject(AgentsService);

	/** Currently active feed filter (two-way bound to the page). */
	readonly filter = model<ActivityFilter>('all');

	/** Non-review filter pills, rendered in order. */
	readonly filters: { value: ActivityFilter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'edit', label: 'On edit' },
		{ value: 'create', label: 'On create' },
		{ value: 'cron', label: 'Cron' },
	];
}
