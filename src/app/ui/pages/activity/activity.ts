import {
	ChangeDetectionStrategy,
	Component,
	computed,
	inject,
	signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { LucideZap } from '@lucide/angular';
import {
	AgentsService,
	type AgentRun,
} from '@core/agents/agents.service';
import { navigateToEntry } from '@core/utils/router-utils';
import { ActivityHeader, type ActivityFilter } from './_activity-header';
import { RunFeed } from './_run-feed';

/**
 * Activity page — every background run across the vault, event- and
 * cron-driven (design: "Agents Vault v2", frame 3 desktop / frame 4 mobile).
 *
 * Header with stat cards and filter pills, then the run feed grouped into
 * "running now", "earlier today", and "yesterday".
 */
@Component({
	selector: 'app-activity',
	standalone: true,
	imports: [LucideZap, ActivityHeader, RunFeed],
	templateUrl: './activity.html',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Activity {
	protected readonly agentsService = inject(AgentsService);
	private readonly router = inject(Router);

	/** Currently active feed filter. */
	readonly filter = signal<ActivityFilter>('all');

	private matchesFilter(run: AgentRun): boolean {
		const f = this.filter();
		if (f === 'all') return true;
		if (f === 'needs-review') return run.status === 'needs-review';
		return run.trigger === f;
	}

	readonly runningNow = computed(() =>
		this.agentsService
			.runs()
			.filter((r) => r.status === 'running' && this.matchesFilter(r)),
	);

	readonly earlierToday = computed(() =>
		this.agentsService
			.runs()
			.filter(
				(r) =>
					r.day === 'today' &&
					r.status !== 'running' &&
					this.matchesFilter(r),
			),
	);

	readonly yesterday = computed(() =>
		this.agentsService
			.runs()
			.filter((r) => r.day === 'yesterday' && this.matchesFilter(r)),
	);

	/** "Review" opens the affected note when the run has one. */
	openRun(run: AgentRun): void {
		if (run.notePath) {
			void navigateToEntry(this.router, run.notePath);
		}
	}
}
