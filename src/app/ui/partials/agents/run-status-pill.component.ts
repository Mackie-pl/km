import {
	ChangeDetectionStrategy,
	Component,
	input,
} from '@angular/core';
import { LucideCheck } from '@lucide/angular';
import type { RunStatus } from '@core/agents/agents.service';

/**
 * Status pill for an agent run — amber "Needs review", green "Applied" /
 * "Auto-applied", muted "No changes", indigo "Running…".
 *
 * Shared by the Activity feed, the activity rail, and agent detail.
 */
@Component({
	selector: 'app-run-status-pill',
	standalone: true,
	imports: [LucideCheck],
	template: `
		@switch (status()) {
			@case ('needs-review') {
				<span
					class="inline-flex items-center text-[11px] font-semibold text-warn-text bg-warn-tint rounded-md px-1.75 py-px"
					>Needs review</span
				>
			}
			@case ('running') {
				<span class="text-[11px] font-semibold text-accent-text"
					>Running…</span
				>
			}
			@case ('no-changes') {
				<span class="text-[11px] font-medium text-ink-4">No changes</span>
			}
			@default {
				<span
					class="inline-flex items-center gap-1 text-[11px] font-semibold text-ok-text"
				>
					<svg lucideCheck class="size-3"></svg>
					{{ status() === 'auto-applied' ? 'Auto-applied' : 'Applied' }}
				</span>
			}
		}
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunStatusPill {
	readonly status = input.required<RunStatus>();
}
