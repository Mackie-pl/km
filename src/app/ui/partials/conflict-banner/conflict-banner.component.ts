import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { VaultStore, type VaultEntry } from '@vault/store';
import { parseConflictName } from '@vault/vault-utils';
import { navigateToEntry } from '@core/utils/router-utils';
import { ConflictRowComponent } from './conflict-row.component';

/** A conflict copy shown in the banner, with its parsed source adapter. */
interface ConflictCopy {
	entry: VaultEntry;
	adapterId: string;
}

/**
 * Sync-conflict resolution banner for the editor.
 *
 * Shown above the note when the open note either HAS `.conflict-*` sibling
 * copies (created by the reconciler when local and remote diverged) or IS
 * such a copy itself. Offers one-click resolution: keep the current version
 * (discard the copy) or adopt the copy's content into the original.
 */
@Component({
	selector: 'app-conflict-banner',
	standalone: true,
	imports: [ConflictRowComponent],
	templateUrl: './conflict-banner.component.html',
})
export class ConflictBannerComponent {
	/** Vault path of the note open in the editor. */
	readonly entryPath = input.required<string>();

	private readonly vault = inject(VaultStore);
	private readonly router = inject(Router);

	/** The open entry, or undefined while loading / after delete. */
	readonly current = computed(() => this.vault.getByPath(this.entryPath()));

	/** Set when the open note is itself a conflict copy. */
	readonly asCopy = computed(() => {
		const entry = this.current();
		if (!entry) return null;
		const parsed = parseConflictName(entry.name);
		if (!parsed) return null;
		const originalPath = this.siblingPath(entry, parsed.originalName);
		return {
			entry,
			adapterId: parsed.adapterId,
			originalPath,
			original: this.vault.getByPath(originalPath),
		};
	});

	/** Conflict copies of the open note (when it is the original). */
	readonly copies = computed<ConflictCopy[]>(() => {
		const entry = this.current();
		if (!entry || parseConflictName(entry.name)) return [];
		return this.vault
			.files()
			.map((f) => ({ entry: f, parsed: parseConflictName(f.name) }))
			.filter(
				({ entry: f, parsed }) =>
					parsed !== null &&
					parsed.originalName === entry.name &&
					f.path === this.siblingPath(entry, f.name),
			)
			.map(({ entry: f, parsed }) => ({
				entry: f,
				adapterId: parsed?.adapterId ?? '',
			}));
	});

	/** Path of `name` in the same folder as `entry`. */
	private siblingPath(entry: VaultEntry, name: string): string {
		const dir = entry.path.slice(0, entry.path.length - entry.name.length);
		return `${dir}${name}`;
	}

	/** Open another version without resolving anything. */
	async open(path: string): Promise<void> {
		await navigateToEntry(this.router, path);
	}

	/**
	 * Adopt `copy`'s content as the current version of `original`,
	 * then delete the copy. Navigates to the original if we were viewing
	 * the copy.
	 */
	async useVersion(original: VaultEntry, copy: VaultEntry): Promise<void> {
		await this.vault.updateFile(original.id, copy.content ?? '');
		await this.vault.delete(copy.id);
		if (this.entryPath() === copy.path) {
			await navigateToEntry(this.router, original.path);
		}
	}

	/** Discard a conflict copy, keeping the current version untouched. */
	async discard(copy: VaultEntry, navigateTo?: string): Promise<void> {
		await this.vault.delete(copy.id);
		if (navigateTo && this.entryPath() === copy.path) {
			await navigateToEntry(this.router, navigateTo);
		}
	}
}
