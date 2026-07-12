import {
	ChangeDetectionStrategy,
	Component,
	input,
} from '@angular/core';
import { LucideClock, LucideLoader, LucideZap } from '@lucide/angular';
import type { AgentRun } from '@core/agents/agents.service';

/**
 * Highlighted card for a run that is in flight right now (Activity feed,
 * "RUNNING NOW"). Extracted to keep the page template within the nesting
 * limit.
 */
@Component({
	selector: 'app-running-run-card',
	standalone: true,
	imports: [LucideClock, LucideLoader, LucideZap],
	template: `
		<div
			class="flex flex-wrap sm:flex-nowrap items-center gap-x-3.5 gap-y-1 px-4 py-3 rounded-[11px] bg-accent-bg/50 border border-accent-border/60"
		>
			<svg
				lucideLoader
				class="size-4.5 text-accent-2 flex-shrink-0 animate-spin"
			></svg>
			<span
				class="flex size-5.5 items-center justify-center rounded-md bg-accent-bg text-accent flex-shrink-0"
			>
				<svg lucideZap class="size-3"></svg>
			</span>
			<span class="text-[13.5px] font-semibold text-ink-1">{{
				run().agentName
			}}</span>
			<span
				class="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3"
			>
				<svg lucideClock class="size-3.5 text-ink-4"></svg>
				{{ run().triggerLabel }}
			</span>
			<span
				class="basis-full sm:basis-0 sm:flex-1 order-last sm:order-none text-[13px] text-ink-2 pl-9 sm:pl-0"
				>{{ run().summary }}</span
			>
			<span class="text-xs text-ink-4">started {{ run().when }} ago</span>
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunningRunCard {
	readonly run = input.required<AgentRun>();
}
