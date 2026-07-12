import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	inject,
	signal,
} from '@angular/core';
import {
	LucideChevronRight,
	LucidePlus,
	LucideSearch,
	LucideSparkles,
	LucideZap,
} from '@lucide/angular';
import {
	TuiDropdownDirective,
	TuiDropdownManual,
} from '@taiga-ui/core/portals/dropdown';
import { AgentsService } from '@core/agents/agents.service';

/**
 * THE single agent button (design: "Agents Vault v2").
 *
 * A primary indigo "Ask" button in the header that opens a popover with the
 * three agent entry points. The actions are placeholders until the agent
 * runtime exists — the popover is the committed UI surface.
 */
@Component({
	selector: 'app-ask-button',
	standalone: true,
	imports: [
		LucideChevronRight,
		LucidePlus,
		LucideSearch,
		LucideSparkles,
		LucideZap,
		TuiDropdownDirective,
		TuiDropdownManual,
	],
	template: `
		@if (agentsService.hasAgents()) {
			<button
				type="button"
				class="inline-flex items-center gap-1.5 h-8 px-3 rounded-btn border-none bg-accent hover:bg-accent-2 text-white text-[12.5px] font-semibold cursor-pointer transition-colors"
				[tuiDropdownManual]="open()"
				[tuiDropdown]="askMenu"
				(click)="open.set(!open())"
				aria-label="Ask the vault or run an agent"
				title="Ask"
			>
				<svg lucideSparkles class="size-4"></svg>
				<span class="hidden sm:inline">Ask</span>
			</button>
		}

		<ng-template #askMenu>
			<div
				class="w-71 bg-surface border border-line rounded-xl shadow-popover overflow-hidden"
			>
				<div
					class="flex items-center gap-2 px-3 py-2.5 border-b border-hairline text-ink-4"
				>
					<svg lucideSearch class="size-4"></svg>
					<span class="text-[13px]">Ask the vault, or run an agent…</span>
				</div>
				<div class="p-1.5">
					<button
						type="button"
						class="flex w-full items-center gap-2.5 px-2 py-2 rounded-lg border-none bg-transparent cursor-pointer text-left hover:bg-hairline transition-colors"
						(click)="open.set(false)"
					>
						<svg lucideSparkles class="size-4 text-accent"></svg>
						<span class="text-[13px] text-ink-2 flex-1"
							>Ask about your notes</span
						>
					</button>
					<button
						type="button"
						class="flex w-full items-center gap-2.5 px-2 py-2 rounded-lg border-none bg-transparent cursor-pointer text-left hover:bg-hairline transition-colors"
						(click)="open.set(false)"
					>
						<svg lucideZap class="size-4 text-ink-3"></svg>
						<span class="text-[13px] text-ink-2 flex-1"
							>Run an agent on this note</span
						>
						<svg lucideChevronRight class="size-3.5 text-ink-5"></svg>
					</button>
					<button
						type="button"
						class="flex w-full items-center gap-2.5 px-2 py-2 rounded-lg border-none bg-transparent cursor-pointer text-left hover:bg-hairline transition-colors"
						(click)="open.set(false)"
					>
						<svg lucidePlus class="size-4 text-ink-3"></svg>
						<span class="text-[13px] text-ink-2 flex-1">New agent…</span>
					</button>
				</div>
			</div>
		</ng-template>
	`,
	host: {
		'(document:click)': 'onDocumentClick($event)',
	},
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AskButtonComponent {
	private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
	protected readonly agentsService = inject(AgentsService);

	/** Whether the popover is open. */
	readonly open = signal(false);

	/**
	 * Close on any click outside the trigger button. The popover content is
	 * portaled elsewhere in the DOM, but every item click closes explicitly,
	 * so containment against the host is sufficient.
	 */
	onDocumentClick(event: Event): void {
		if (
			this.open() &&
			!this.elementRef.nativeElement.contains(event.target as Node)
		) {
			this.open.set(false);
		}
	}
}
