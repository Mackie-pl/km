import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { VaultStore } from '@vault/store';
import { Router } from '@angular/router';

@Component({
	selector: 'app-empty',
	imports: [],
	templateUrl: './empty.html',
	styleUrl: './empty.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { class: 'flex-1 flex flex-col' },
})
export class Empty {
	private readonly vaultDb = inject(VaultStore);
	private readonly router = inject(Router);

	async addNote(): Promise<void> {
		const fileName = `untitled-${Date.now().toString()}.md`;
		await this.vaultDb.createFile(fileName);
		void this.router.navigate(['/e', fileName]);
	}
}
