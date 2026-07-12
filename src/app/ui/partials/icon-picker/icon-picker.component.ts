import {
	ChangeDetectionStrategy,
	Component,
	computed,
	signal,
	Type,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { injectContext } from '@taiga-ui/polymorpheus';
import type { TuiDialogContext } from '@taiga-ui/core/portals/dialog';
import { LucideSearch } from '@lucide/angular';
import { searchIcons, type IconItem } from '@core/utils/icon-data';
import { LUCIDE_COMPONENT_MAP } from '@core/utils/lucide-map';

/**
 * Icon picker dialog — searchable grid of emoji + Lucide icons.
 *
 * Opened via IconPickerService. Returns the selected icon value string
 * (e.g. "📝" or "lucide:file-text") or null if cancelled.
 */
@Component({
	selector: 'app-icon-picker',
	standalone: true,
	imports: [NgComponentOutlet, LucideSearch],
	template: `
		<div class="flex flex-col max-h-[80vh]">
			<!-- Search input -->
			<div
				class="flex items-center gap-3 px-4 py-3 border-b border-line"
			>
				<svg lucideSearch class="size-5 shrink-0 text-ink-4"></svg>
				<input
					#searchInput
					[value]="query()"
					(input)="onInput($event)"
					placeholder="Search icons…"
					class="flex-1 bg-transparent text-sm text-ink-1 placeholder-ink-4 outline-none"
					autocomplete="off"
					spellcheck="false"
				/>
				@if (query()) {
					<button
						type="button"
						(click)="clearQuery()"
						class="flex items-center justify-center size-5 rounded-full text-ink-4 hover:text-ink-2 hover:bg-hairline transition-colors border-none bg-transparent cursor-pointer"
						[attr.aria-label]="'Clear search'"
					>
						×
					</button>
				}
			</div>

			<!-- Results grid -->
			<div class="overflow-y-auto flex-1 p-3">
				@if (filteredIcons().length === 0) {
					<div class="py-12 text-center text-sm text-ink-4">
						No icons found
					</div>
				} @else {
					<div class="grid grid-cols-8 gap-1.5">
						@for (
							icon of filteredIcons();
							track icon.value;
							let i = $index
						) {
							<button
								type="button"
								[attr.data-icon-index]="i"
								(click)="selectIcon(icon)"
								class="flex items-center justify-center size-9 rounded-lg border border-line bg-surface cursor-pointer transition-all duration-100"
								[class.border-accent]="focusedIndex() === i"
								[class.ring-2]="focusedIndex() === i"
								[class.ring-accent/30]="focusedIndex() === i"
								[class.scale-110]="focusedIndex() === i"
								[class.hover:border-accent-border]="
									focusedIndex() !== i
								"
								[class.hover:shadow-hairline]="
									focusedIndex() !== i
								"
								[attr.aria-label]="icon.label"
								[title]="icon.label"
							>
								@if (icon.type === 'emoji') {
									<span class="text-lg leading-none">{{
										icon.value
									}}</span>
								} @else {
									<ng-container
										[ngComponentOutlet]="
											getLucideComponent(icon.value)
										"
									/>
								}
							</button>
						}
					</div>
				}
			</div>

			<!-- Footer hint -->
			<div
				class="flex items-center gap-3 px-4 py-2 border-t border-line text-xs text-ink-4"
			>
				<span>↑↓ Navigate</span>
				<span class="text-ink-5">·</span>
				<span>⏎ Select</span>
				<span class="text-ink-5">·</span>
				<span>Esc Close</span>
			</div>
		</div>
	`,
	host: {
		'(keydown)': 'onKeydown($event)',
		autofocus: '',
	},
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconPickerComponent {
	protected readonly context =
		injectContext<TuiDialogContext<string | null, void>>();

	/** Current search query. */
	readonly query = signal('');

	/** Currently focused item index (for keyboard nav). */
	readonly focusedIndex = signal(0);

	/** Filtered icon results based on query. */
	readonly filteredIcons = computed(() => {
		const q = this.query();
		return searchIcons(q, 80);
	});

	/** Handle search input change and reset focus. */
	onInput(event: Event): void {
		const value = (event.target as HTMLInputElement).value;
		this.query.set(value);
		this.focusedIndex.set(0);
	}

	/** Clear the search query. */
	clearQuery(): void {
		this.query.set('');
		this.focusedIndex.set(0);
	}

	/** Select an icon and close the dialog. */
	selectIcon(icon: IconItem): void {
		this.context.completeWith(icon.value);
	}

	/** Cancel the dialog. */
	cancel(): void {
		this.context.completeWith(null);
	}

	/** Keyboard navigation: arrows, enter, escape. */
	onKeydown(event: KeyboardEvent): void {
		const results = this.filteredIcons();
		if (results.length === 0) {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.cancel();
			}
			return;
		}

		switch (event.key) {
			case 'ArrowDown': {
				event.preventDefault();
				this.focusedIndex.update((i) => (i + 1) % results.length);
				this.#scrollIntoView();
				break;
			}
			case 'ArrowUp': {
				event.preventDefault();
				this.focusedIndex.update(
					(i) => (i - 1 + results.length) % results.length,
				);
				this.#scrollIntoView();
				break;
			}
			case 'Enter': {
				event.preventDefault();
				const icon = results[this.focusedIndex()];
				if (icon) this.selectIcon(icon);
				break;
			}
			case 'Escape': {
				event.preventDefault();
				this.cancel();
				break;
			}
		}
	}

	/** Scroll the focused item into view. */
	#scrollIntoView(): void {
		const el = document.querySelector(
			`[data-icon-index="${String(this.focusedIndex())}"]`,
		);
		el?.scrollIntoView({ block: 'nearest' });
	}

	/** Look up the Angular component for a Lucide icon value (e.g. "lucide:file-text"). */
	getLucideComponent(value: string): Type<unknown> | null {
		const kebab = value.replace('lucide:', '');
		return LUCIDE_COMPONENT_MAP.get(kebab) ?? null;
	}
}
