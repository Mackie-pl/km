import {
	ChangeDetectionStrategy,
	Component,
	input,
} from '@angular/core';
import type { AgentRun, VaultAgent } from '@core/agents/agents.service';
import { AgentTriggerCard } from './_agent-trigger-card';
import { AgentRunItem } from './_agent-run-item';

/**
 * Agent detail right rail — "WHEN IT RUNS" trigger cards and the
 * "RECENT RUNS" list. Extracted to keep the page template within the
 * nesting limit.
 */
@Component({
	selector: 'app-agent-rail',
	standalone: true,
	imports: [AgentTriggerCard, AgentRunItem],
	template: `
		<div
			class="lg:w-82 flex-shrink-0 lg:border-l border-t lg:border-t-0 border-line bg-canvas px-5 py-6"
		>
			<div
				class="text-[10.5px] font-bold tracking-[0.07em] text-ink-4 mb-2.5"
			>
				WHEN IT RUNS
			</div>
			<div class="flex flex-col gap-2 mb-6">
				@for (trigger of agent().triggers; track trigger.label) {
					<app-agent-trigger-card [trigger]="trigger" />
				}
			</div>

			<div
				class="text-[10.5px] font-bold tracking-[0.07em] text-ink-4 mb-2.5"
			>
				RECENT RUNS
			</div>
			<div class="flex flex-col">
				@for (run of runs(); track run.id) {
					<app-agent-run-item [run]="run" />
				} @empty {
					<div class="py-3 text-[12.5px] text-ink-4">No runs yet.</div>
				}
			</div>
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentRail {
	readonly agent = input.required<VaultAgent>();
	readonly runs = input.required<AgentRun[]>();
}
