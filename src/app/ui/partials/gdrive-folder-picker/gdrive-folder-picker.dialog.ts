import {
	ChangeDetectionStrategy,
	Component,
	computed,
	signal,
	type OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideFolder, LucideFolderPlus, LucideLoader } from '@lucide/angular';
import { injectContext } from '@taiga-ui/polymorpheus';
import { type TuiDialogContext } from '@taiga-ui/core/portals/dialog';
import { DriveClient, type DriveFile } from '@core/adapters/cloud/gdrive/drive-client';
import { gdriveAuth } from '@core/adapters/cloud/gdrive/auth-provider';

/** Result of the folder picker — the chosen folder, or null on cancel. */
export type FolderPickResult = { id: string; name: string } | null;

interface Crumb {
	id: string;
	name: string;
}

/**
 * In-app Google Drive folder browser.
 *
 * Browses the user's My Drive tree via {@link DriveClient} (on the shared
 * {@link gdriveAuth}), supports creating a folder inline, and returns the chosen
 * folder. Selecting the My Drive root itself is disallowed — syncing a whole
 * Drive is never intended — so the user must enter or create a sub-folder.
 */
@Component({
	selector: 'app-gdrive-folder-picker',
	standalone: true,
	imports: [CommonModule, LucideFolder, LucideFolderPlus, LucideLoader],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="p-4 space-y-3">
			<!-- Breadcrumbs -->
			<div class="flex flex-wrap items-center gap-1 text-xs text-gray-500">
				@for (
					crumb of breadcrumbs();
					track crumb.id;
					let i = $index;
					let last = $last
				) {
					<button
						type="button"
						(click)="crumbTo(i)"
						[disabled]="last"
						class="rounded px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:font-medium disabled:text-gray-900 dark:disabled:text-gray-100"
					>
						{{ crumb.name }}
					</button>
					@if (!last) {
						<span class="text-gray-400">/</span>
					}
				}
			</div>

			<!-- Body -->
			@if (needsAuth()) {
				<div class="py-8 text-center space-y-3">
					<p class="text-sm text-gray-500">
						Connect your Google account to browse folders.
					</p>
					<button
						type="button"
						(click)="connect()"
						class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
					>
						Connect Google Drive
					</button>
				</div>
			} @else if (loading()) {
				<div
					class="flex items-center justify-center gap-2 py-8 text-sm text-gray-500"
				>
					<svg lucideLoader class="size-4 animate-spin"></svg>
					Loading…
				</div>
			} @else if (error(); as e) {
				<div class="py-6 text-center text-sm text-red-500">{{ e }}</div>
			} @else {
				<div
					class="max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700"
				>
					@for (folder of subfolders(); track folder.id) {
						<button
							type="button"
							(click)="open(folder)"
							class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
						>
							<svg lucideFolder class="size-4 text-gray-400"></svg>
							{{ folder.name }}
						</button>
					} @empty {
						<div class="px-3 py-6 text-center text-xs text-gray-500">
							No sub-folders here.
						</div>
					}
				</div>

				<!-- Create folder -->
				<div class="flex items-center gap-2">
					<input
						type="text"
						[value]="newFolderName()"
						(input)="newFolderName.set($any($event.target).value)"
						placeholder="New folder name"
						class="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
					/>
					<button
						type="button"
						(click)="createFolder()"
						[disabled]="creating() || newFolderName().trim() === ''"
						class="inline-flex items-center gap-1 rounded-lg border border-gray-300 dark:border-gray-600 px-2.5 py-1.5 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
					>
						<svg lucideFolderPlus class="size-3.5"></svg>
						Create
					</button>
				</div>
			}

			<!-- Footer -->
			<div class="flex items-center justify-end gap-2 pt-1">
				<button
					type="button"
					(click)="cancel()"
					class="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800"
				>
					Cancel
				</button>
				<button
					type="button"
					(click)="select()"
					[disabled]="atRoot()"
					class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					Select this folder
				</button>
			</div>
		</div>
	`,
})
export class GDriveFolderPickerDialog implements OnInit {
	private readonly context =
		injectContext<TuiDialogContext<FolderPickResult>>();
	private readonly client = new DriveClient(gdriveAuth);

	protected readonly breadcrumbs = signal<Crumb[]>([
		{ id: 'root', name: 'My Drive' },
	]);
	protected readonly subfolders = signal<DriveFile[]>([]);
	protected readonly loading = signal(false);
	protected readonly error = signal<string | null>(null);
	protected readonly needsAuth = signal(false);
	protected readonly newFolderName = signal('');
	protected readonly creating = signal(false);

	/** The folder currently being viewed (breadcrumbs always has ≥1 entry). */
	private readonly current = computed<Crumb>(
		() => this.breadcrumbs().at(-1) ?? { id: 'root', name: 'My Drive' },
	);

	/** Root can't be selected — force choosing/creating a sub-folder. */
	protected readonly atRoot = computed(() => this.breadcrumbs().length <= 1);

	ngOnInit(): void {
		void this.#load();
	}

	protected open(folder: DriveFile): void {
		this.breadcrumbs.update((b) => [
			...b,
			{ id: folder.id, name: folder.name },
		]);
		void this.#load();
	}

	protected crumbTo(index: number): void {
		this.breadcrumbs.update((b) => b.slice(0, index + 1));
		void this.#load();
	}

	protected async connect(): Promise<void> {
		try {
			await gdriveAuth.ensureSignedIn();
			this.needsAuth.set(false);
			await this.#load();
		} catch (err: unknown) {
			this.error.set(this.#message(err));
		}
	}

	protected async createFolder(): Promise<void> {
		const name = this.newFolderName().trim();
		if (!name) return;
		this.creating.set(true);
		this.error.set(null);
		try {
			const created = await this.client.createFolder(
				name,
				this.current().id,
			);
			// Creating a folder implies intent to use it — select it right away
			// instead of making the user hunt for it in the list.
			this.context.completeWith({ id: created.id, name: created.name });
		} catch (err: unknown) {
			this.error.set(this.#message(err));
			this.creating.set(false);
		}
	}

	protected select(): void {
		const folder = this.current();
		this.context.completeWith({ id: folder.id, name: folder.name });
	}

	protected cancel(): void {
		this.context.completeWith(null);
	}

	async #load(): Promise<void> {
		this.loading.set(true);
		this.error.set(null);
		try {
			this.subfolders.set(await this.client.listFolders(this.current().id));
			this.needsAuth.set(false);
		} catch {
			// Most likely sign-in needed / popup blocked — offer a manual connect.
			this.needsAuth.set(true);
		} finally {
			this.loading.set(false);
		}
	}

	#message(err: unknown): string {
		return err instanceof Error ? err.message : 'Something went wrong';
	}
}
