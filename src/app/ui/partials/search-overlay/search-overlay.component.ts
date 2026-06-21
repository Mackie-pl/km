import {
	Component,
	inject,
	signal,
	viewChild,
	afterNextRender,
	type ElementRef,
} from '@angular/core';
import { SearchService } from '@core/services/search.service';
import { LucideSearch } from '@lucide/angular';
import { SearchResultItem } from './_search-result-item';

@Component({
	selector: 'app-search-overlay',
	standalone: true,
	imports: [LucideSearch, SearchResultItem],
	templateUrl: './search-overlay.component.html',
	styleUrl: './search-overlay.component.scss',
	host: {
		'(keydown)': 'onKeydown($event)',
		'(document:keydown.escape)': 'handleEscape()',
	},
})
export class SearchOverlayComponent {
	readonly search = inject(SearchService);

	/** Track the currently highlighted result index for keyboard navigation. */
	readonly selectedIndex = signal(0);

	private readonly inputRef =
		viewChild<ElementRef<HTMLInputElement>>('searchInput');

	constructor() {
		afterNextRender(() => {
			this.inputRef()?.nativeElement.focus();
		});
	}

	/** Close on Escape globally. */
	handleEscape(): void {
		if (this.search.isOpen()) this.search.close();
	}

	/** Close when clicking on the backdrop (not on the panel). */
	onBackdropClick(event: MouseEvent): void {
		if ((event.target as HTMLElement).hasAttribute('data-backdrop')) {
			this.search.close();
		}
	}

	/**
	 * Handle keyboard events on the overlay:
	 * - ArrowDown / ArrowUp → navigate results
	 * - Enter → open the selected result
	 */
	onKeydown(event: KeyboardEvent): void {
		const results = this.search.results();
		if (results.length === 0) return;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			this.selectedIndex.update((i) => {
				return (i + 1) % results.length;
			});
			void Promise.resolve().then(() => {
				this.#scrollIntoView();
			});
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			this.selectedIndex.update((i) => {
				return (i - 1 + results.length) % results.length;
			});
			void Promise.resolve().then(() => {
				this.#scrollIntoView();
			});
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const entry = results[this.selectedIndex()];
			if (entry) this.search.openDocument(entry);
		}
	}

	/** Click handler for result items — opens the document. */
	openResult(index: number): void {
		const results = this.search.results();
		const entry = results[index];
		if (entry) this.search.openDocument(entry);
	}

	/** React to input changes — update query and reset selection. */
	onQueryChange(value: string): void {
		this.search.query.set(value);
		this.selectedIndex.set(0);
	}

	/** Scroll the currently highlighted item into view. */
	#scrollIntoView(): void {
		const el = document.querySelector(
			`[data-search-index="${String(this.selectedIndex())}"]`,
		);
		el?.scrollIntoView({ block: 'nearest' });
	}
}
