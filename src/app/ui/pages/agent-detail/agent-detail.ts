import {
	ChangeDetectionStrategy,
	Component,
	computed,
	inject,
	input,
} from '@angular/core';
import { AgentsService } from '@core/agents/agents.service';
import { AgentHero } from './_agent-hero';
import { AgentSource } from './_agent-source';
import { AgentRail } from './_agent-rail';

/**
 * Agent detail page — an agent is a note you can open (Agents Vault v2,
 * frame 2): plain-language settings up front, the raw file a click away.
 *
 * Hero band with enable toggle, "what it does" card, collapsible raw
 * frontmatter, and a rail with triggers + recent runs.
 */
@Component({
	selector: 'app-agent-detail',
	standalone: true,
	imports: [AgentHero, AgentSource, AgentRail],
	templateUrl: './agent-detail.html',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentDetail {
	/** Agent slug from the /agent/:agentId route. */
	readonly agentId = input.required<string>();

	protected readonly agentsService = inject(AgentsService);

	readonly agent = computed(() => {
		// Depend on the agents signal so toggles re-render the page.
		this.agentsService.agents();
		return this.agentsService.agentById(this.agentId());
	});

	readonly runs = computed(() => {
		this.agentsService.runs();
		return this.agentsService.runsForAgent(this.agentId());
	});

	readonly isRunning = computed(() =>
		this.runs().some((r) => r.status === 'running'),
	);

	toggleEnabled(): void {
		this.agentsService.toggleAgent(this.agentId());
	}

	runNow(): void {
		this.agentsService.simulateManualRun(this.agentId());
	}
}
