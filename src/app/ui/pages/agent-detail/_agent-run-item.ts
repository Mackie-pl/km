import {
	ChangeDetectionStrategy,
	Component,
	input,
} from '@angular/core';
import {
	LucideClock,
	LucidePencil,
	LucidePlus,
} from '@lucide/angular';
import type { AgentRun } from '@core/agents/agents.service';
import { RunStatusPill } from '@ui/partials/agents/run-status-pill.component';

/**
 * One "RECENT RUNS" entry in the agent detail rail.
 * Extracted to keep the rail template within the nesting limit.
 */
@Component({
	selector: 'app-agent-run-item',
	standalone: true,
	imports: [LucideClock, LucidePencil, LucidePlus, RunStatusPill],
	template: `
		<div class="flex gap-2.5 py-2.5 border-b border-hairline last:border-b-0">
			@switch (run().trigger) {
				@case ('create') {
					<svg
						lucidePlus
						class="size-3.5 text-ink-4 flex-shrink-0 mt-0.5"
					></svg>
				}
				@case ('edit') {
					<svg
						lucidePencil
						class="size-3.5 text-accent flex-shrink-0 mt-0.5"
					></svg>
				}
				@default {
					<svg
						lucideClock
						class="size-3.5 text-ink-4 flex-shrink-0 mt-0.5"
					></svg>
				}
			}
			<div class="flex-1 min-w-0">
				<div class="text-[12.5px] text-ink-2 leading-snug">
					{{ run().triggerLabel }} · {{ run().summary }}
				</div>
				<div class="flex items-center gap-1.5 mt-1 text-[11px]">
					<app-run-status-pill [status]="run().status" />
					<span class="text-ink-4">{{ run().when }}</span>
				</div>
			</div>
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentRunItem {
	readonly run = input.required<AgentRun>();
}
