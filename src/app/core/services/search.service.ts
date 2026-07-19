import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { VaultStore, type VaultEntry } from '@vault/store';

@Injectable({
	providedIn: 'root',
})
export class SearchService {
	private readonly vaultStore = inject(VaultStore);
	private readonly router = inject(Router);

	/** Whether the search overlay is visible. */
	readonly isOpen = signal(false);

	/** The current search query. */
	readonly query = signal('');

	/** All visible (non-archived) files matching the query by name or content. */
	readonly results = computed(() => {
		const q = this.query().toLowerCase().trim();
		if (!q) return [];

		return this.vaultStore.visibleFiles().filter((e) => {
			if (e.name.toLowerCase().includes(q)) return true;
			if (e.content?.toLowerCase().includes(q)) return true;
			return false;
		});
	});

	/** Open the search overlay and clear any previous query. */
	open(): void {
		this.query.set('');
		this.isOpen.set(true);
	}

	/** Close the search overlay and reset the query. */
	close(): void {
		this.isOpen.set(false);
		this.query.set('');
	}

	/** Navigate to a file entry and close search. */
	openDocument(entry: VaultEntry): void {
		this.close();
		void this.router.navigateByUrl(`/e/${entry.path}`);
	}
}
