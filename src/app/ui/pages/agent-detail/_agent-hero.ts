import {
	ChangeDetectionStrategy,
	Component,
	input,
	output,
} from '@angular/core';
import { LucidePlay, LucideZap } from '@lucide/angular';
import type { VaultAgent } from '@core/agents/agents.service';

/**
 * Agent detail hero band — icon chip, name with status pill and file-name
 * chip, plain-language description, Run now, and the enable toggle.
 * Extracted to keep the page template within the nesting limit.
 */
@Component({
	selector: 'app-agent-hero',
	standalone: true,
	imports: [LucidePlay, LucideZap],
	template: `
		<div
			class="px-4 sm:px-8 py-6 border-b border-line flex items-center gap-4 flex-wrap sm:flex-nowrap"
		>
			<span
				class="flex size-13 items-center justify-center rounded-card bg-accent-bg text-accent flex-shrink-0"
			>
				<svg lucideZap class="size-6.5"></svg>
			</span>
			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-2.5 mb-1 flex-wrap">
					<span
						class="text-[23px] font-bold tracking-[-0.01em] text-ink-1"
						>{{ agent().name }}</span
					>
					@if (agent().enabled) {
						<span
							class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-ok-bg text-ok-text text-[11.5px] font-semibold"
						>
							<span class="size-1.5 rounded-full bg-ok-dot"></span>
							Enabled
						</span>
					} @else {
						<span
							class="inline-flex items-center px-2 py-0.5 rounded-full bg-hairline text-ink-3 text-[11.5px] font-semibold"
							>Paused</span
						>
					}
					<span
						class="inline-flex items-center px-2 py-0.5 rounded-[7px] bg-hairline text-ink-4 text-[11px] font-mono"
						>{{ agent().fileName }}</span
					>
				</div>
				<p class="text-sm leading-relaxed text-ink-2 m-0 max-w-xl">
					{{ agent().description }}
				</p>
			</div>
			<div class="flex items-center gap-3 flex-shrink-0">
				<button
					type="button"
					(click)="runNow.emit()"
					[disabled]="running()"
					class="inline-flex items-center gap-1.5 h-8 px-3 rounded-btn border border-line bg-surface text-ink-2 text-[12.5px] font-semibold cursor-pointer transition-colors hover:bg-hairline disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<svg lucidePlay class="size-3.5"></svg>
					{{ running() ? 'Running…' : 'Run now' }}
				</button>
				<button
					type="button"
					role="switch"
					[attr.aria-checked]="agent().enabled"
					(click)="toggleEnabled.emit()"
					class="relative inline-flex h-6.5 w-11.5 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200"
					[class.bg-accent]="agent().enabled"
					[class.bg-line]="!agent().enabled"
					[attr.aria-label]="
						agent().enabled ? 'Disable agent' : 'Enable agent'
					"
				>
					<span
						class="pointer-events-none inline-block size-5 rounded-full bg-white shadow transform transition duration-200"
						[class.translate-x-5]="agent().enabled"
						[class.translate-x-0]="!agent().enabled"
					></span>
				</button>
			</div>
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentHero {
	readonly agent = input.required<VaultAgent>();
	readonly running = input(false);
	readonly runNow = output();
	readonly toggleEnabled = output();
}
