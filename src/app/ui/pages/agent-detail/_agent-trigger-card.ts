import {
	ChangeDetectionStrategy,
	Component,
	input,
} from '@angular/core';
import {
	LucideCheck,
	LucideClock,
	LucidePencil,
	LucidePlus,
} from '@lucide/angular';
import type { AgentTrigger } from '@core/agents/agents.service';

/**
 * One "WHEN IT RUNS" trigger card in the agent detail rail.
 * Extracted to keep the rail template within the nesting limit.
 */
@Component({
	selector: 'app-agent-trigger-card',
	standalone: true,
	imports: [LucideCheck, LucideClock, LucidePencil, LucidePlus],
	template: `
		<div
			class="flex items-center gap-2.5 bg-surface border border-line rounded-[10px] px-3 py-2.5"
		>
			@switch (trigger().kind) {
				@case ('create') {
					<svg lucidePlus class="size-4 text-accent"></svg>
				}
				@case ('edit') {
					<svg lucidePencil class="size-4 text-accent"></svg>
				}
				@default {
					<svg lucideClock class="size-4 text-accent"></svg>
				}
			}
			<span class="text-[13px] text-ink-2 flex-1">{{
				trigger().label
			}}</span>
			<svg lucideCheck class="size-3.5 text-ok-dot"></svg>
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentTriggerCard {
	readonly trigger = input.required<AgentTrigger>();
}
