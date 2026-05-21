import { Injectable, signal, computed } from '@angular/core';
import { VaultOperation } from '../types/operations';

@Injectable({
	providedIn: 'root',
})
export class OperationJournalService {
	private operations = signal<VaultOperation[]>([]);

	readonly pending = computed(() =>
		this.operations().filter((op) => !op.synced),
	);

	append(operation: VaultOperation) {
		this.operations.update((ops) => [...ops, operation]);

		//
		// persist async to IndexedDB
		//
		void this.persist(operation);
	}

	markSynced(id: string) {
		this.operations.update((ops) =>
			ops.map((op) =>
				op.id === id
					? {
							...op,
							synced: true,
						}
					: op,
			),
		);
	}

	private async persist(_operation: VaultOperation) {
		//
		// IndexedDB write
		//
	}
}
