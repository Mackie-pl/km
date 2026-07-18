import {
	ChangeDetectionStrategy,
	Component,
	input,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideZap } from '@lucide/angular';
import type { VaultAgent } from '@core/agents/agents.service';

/**
 * An agent row in the sidebar tree — indigo chip, hairline ring, status dot
 * (Agents Vault v2). Links to the agent detail page.
 * Extracted to keep the vault list template within the nesting limit.
 */
@Component({
	selector: 'app-sidebar-agent-row',
	standalone: true,
	imports: [LucideZap, RouterLink, RouterLinkActive],
	template: `
		<a
			[routerLink]="['/agent', agent().id]"
			routerLinkActive
			#rla="routerLinkActive"
			class="flex items-center w-full gap-2 py-1.5 rounded-lg cursor-pointer transition-colors duration-150 text-left no-underline ring-1 ring-inset ring-accent-border/60"
			[class.px-2]="!collapsed()"
			[class.px-1]="collapsed()"
			[class.justify-center]="collapsed()"
			[class.bg-accent-bg2]="rla.isActive"
			[class.bg-surface]="!rla.isActive"
			[class.hover:bg-accent-bg]="!rla.isActive"
			[attr.aria-label]="agent().name + ' (agent)'"
		>
			<span
				class="flex size-4.5 items-center justify-center rounded-[5px] bg-accent-bg text-accent flex-shrink-0"
			>
				<svg lucideZap class="size-3"></svg>
			</span>
			<span
				class="flex-1 text-[13px] font-medium text-accent-deep truncate"
				[class.sr-only]="collapsed()"
				>{{ agent().name }}</span
			>
			@if (running()) {
				<span
					class="size-1.5 rounded-full bg-accent-2 shadow-[0_0_0_3px_var(--indigo-bg2)] flex-shrink-0"
				></span>
			} @else if (agent().enabled) {
				<span class="size-1.5 rounded-full bg-ok-dot flex-shrink-0"></span>
			}
		</a>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarAgentRow {
	readonly agent = input.required<VaultAgent>();
	readonly running = input(false);
	readonly collapsed = input(false);
}
