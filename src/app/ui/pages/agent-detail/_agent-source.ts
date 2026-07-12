import {
	ChangeDetectionStrategy,
	Component,
	computed,
	input,
	signal,
} from '@angular/core';
import { LucideChevronRight, LucideCode } from '@lucide/angular';
import type { VaultAgent } from '@core/agents/agents.service';

/**
 * Agent detail main column — the plain-language "WHAT IT DOES" card and the
 * collapsible raw frontmatter disclosure. Extracted to keep the page template
 * within the nesting limit.
 */
@Component({
	selector: 'app-agent-source',
	standalone: true,
	imports: [LucideChevronRight, LucideCode],
	template: `
		<div class="px-4 sm:px-8 py-6">
			<div
				class="text-[10.5px] font-bold tracking-[0.07em] text-ink-4 mb-2.5"
			>
				WHAT IT DOES
			</div>
			<div
				class="bg-surface-3 border border-line rounded-xl px-4.5 py-4 text-sm leading-relaxed text-ink-2 mb-6"
			>
				{{ agent().instructions }}
			</div>

			<!-- Raw source disclosure -->
			<div class="border border-line rounded-xl overflow-hidden">
				<button
					type="button"
					(click)="rawOpen.set(!rawOpen())"
					class="flex w-full items-center gap-2.5 px-3.5 py-3 bg-surface-3 border-none cursor-pointer text-left"
				>
					<svg lucideCode class="size-4 text-ink-4"></svg>
					<span class="text-[12.5px] font-semibold text-ink-2 flex-1"
						>Raw file &amp; advanced settings</span
					>
					<span class="text-[11px] text-ink-4 font-mono"
						>frontmatter</span
					>
					<svg
						lucideChevronRight
						class="size-4 text-ink-4 transition-transform"
						[class.rotate-90]="rawOpen()"
					></svg>
				</button>
				@if (rawOpen()) {
					<pre
						class="m-0 bg-code-bg text-code-text px-4 py-3.5 font-mono text-xs leading-[1.7] overflow-x-auto"
					>{{ frontmatterText() }}</pre>
				}
			</div>
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentSource {
	readonly agent = input.required<VaultAgent>();

	/** Whether the raw-file disclosure is expanded. */
	readonly rawOpen = signal(true);

	/** Raw frontmatter joined for the <pre> block. */
	readonly frontmatterText = computed(() =>
		this.agent().frontmatter.join('\n'),
	);
}
