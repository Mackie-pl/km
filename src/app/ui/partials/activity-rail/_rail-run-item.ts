import {
	ChangeDetectionStrategy,
	Component,
	input,
} from '@angular/core';
import { LucideLoader, LucidePencil, LucideZap } from '@lucide/angular';
import type { AgentRun } from '@core/agents/agents.service';
import { RunStatusPill } from '@ui/partials/agents/run-status-pill.component';

/**
 * One run entry in the note-side activity rail.
 * Extracted to keep the rail template within the nesting limit.
 */
@Component({
	selector: 'app-rail-run-item',
	standalone: true,
	imports: [LucideLoader, LucidePencil, LucideZap, RunStatusPill],
	template: `
		<div
			class="flex gap-2.5 px-2 py-2.5 border-t border-hairline first:border-t-0"
			[class.bg-accent-bg]="run().status === 'running'"
			[class.rounded-xl]="run().status === 'running'"
			[class.border-t-transparent]="run().status === 'running'"
		>
			@if (run().status === 'running') {
				<svg
					lucideLoader
					class="size-4 text-accent-2 flex-shrink-0 mt-0.5 animate-spin"
				></svg>
			} @else if (run().status === 'needs-review') {
				<span
					class="flex size-6 items-center justify-center rounded-[7px] bg-accent-bg text-accent flex-shrink-0"
				>
					<svg lucidePencil class="size-3.5"></svg>
				</span>
			} @else {
				<span
					class="flex size-6 items-center justify-center rounded-[7px] bg-hairline text-ink-3 flex-shrink-0"
				>
					<svg lucideZap class="size-3"></svg>
				</span>
			}
			<div class="flex-1 min-w-0">
				<div class="text-[13px] text-ink-2 leading-snug">
					<strong class="text-ink-1">{{ run().agentName }}</strong>
					<span class="text-ink-4"> · {{ run().triggerLabel }}</span>
				</div>
				<div class="text-xs text-ink-3 mt-0.5 truncate">
					{{ run().summary }}
				</div>
				@if (run().status !== 'running') {
					<div class="flex items-center gap-2 mt-1.5">
						<app-run-status-pill [status]="run().status" />
						<span class="text-[11.5px] text-ink-4">{{
							run().when
						}}</span>
					</div>
				}
			</div>
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RailRunItem {
	readonly run = input.required<AgentRun>();
}
