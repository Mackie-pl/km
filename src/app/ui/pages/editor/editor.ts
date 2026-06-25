import {
	Component,
	effect,
	inject,
	input,
	OnDestroy,
	signal,
	viewChild,
	afterNextRender,
	type ElementRef,
} from '@angular/core';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, parserCtx } from '@milkdown/kit/core';
import { Slice } from '@milkdown/kit/prose/model';
import { VaultStore } from '@vault/store';
import { SyncEngineService } from '@core/sync/sync-engine';
import { NoteToolbarComponent } from '@ui/partials/note-toolbar/note-toolbar.component';
import {
	parseFrontmatter,
	serializeFrontmatter,
} from '@core/utils/frontmatter-parser';
import type { NoteMetadata } from '@core/types/note-metadata';

@Component({
	selector: 'app-editor',
	standalone: true,
	imports: [NoteToolbarComponent],
	templateUrl: './editor.html',
	styles: `
		:host::ng-deep .milkdown {
			height: 100%;
		}
	`,
	host: {
		class: 'flex-1',
		'(window:focus)': 'onWindowFocus()',
	},
})
export class Editor implements OnDestroy {
	entryId = input.required<string>();

	private readonly vault = inject(VaultStore);
	private readonly syncEngine = inject(SyncEngineService);
	private readonly editorContainer = viewChild<ElementRef>('editorContainer');

	private crepe: Crepe | null = null;

	/** Frontmatter metadata for the current note. */
	readonly metadata = signal<NoteMetadata>({});

	/**
	 * Verbatim frontmatter lines for keys this app doesn't manage (aliases,
	 * custom fields, etc.). Captured on parse and re-emitted on save so editing
	 * a note never strips frontmatter written by other tools.
	 */
	private preservedFrontmatter = signal<string[]>([]);

	/** Snapshot of the last BODY content we saved — avoids echo-loop on external updates. */
	private lastSavedContent = '';

	/** Guard that prevents the save callback from firing when we push content. */
	private isExternalUpdate = false;

	/** Re-read the visible note when the window regains focus. */
	onWindowFocus(): void {
		void this.refreshCurrentEntry('focus');
	}

	/** Polling interval handle for re-reading the visible file from disk. */
	private refreshTimer: ReturnType<typeof setInterval> | null = null;

	/** Set once per entryId to avoid re-refreshing on the same note. */
	private lastRefreshedPath = '';

	constructor() {
		// Bootstrap Crepe once the DOM is ready
		afterNextRender((): void => {
			void this.initEditor();
		});

		// Reactively push vault content into the editor when it changes externally.
		// Compares the body (stripped of frontmatter) to avoid re-rendering on
		// frontmatter-only changes.
		effect((): void => {
			const entry = this.vault.getByPath(this.entryId());
			const currentContent = entry?.content ?? '';
			if (!this.crepe) return;

			const { body: currentBody } = parseFrontmatter(currentContent);
			if (currentBody !== this.lastSavedContent) {
				this.setContent(currentContent);
			}
		});

		// Re-read from disk on note navigation (entryId change).
		// Fires on mount and every time the route param changes.
		effect((): void => {
			const id = this.entryId();
			const entry = this.vault.getByPath(id);
			if (!entry) return;
			const path = entry.path;
			if (path === this.lastRefreshedPath) return;
			this.lastRefreshedPath = path;
			void this.refreshCurrentEntry('open');
		});
	}

	// ──────────────────────────────────────────────
	// Lifecycle
	// ──────────────────────────────────────────────

	ngOnDestroy(): void {
		void this.crepe?.destroy();
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	// ──────────────────────────────────────────────
	// Editor initialisation
	// ──────────────────────────────────────────────

	private async initEditor(): Promise<void> {
		const containerRef = this.editorContainer();
		if (!containerRef) return;
		const container = containerRef.nativeElement as HTMLElement;

		const initialContent =
			this.vault.getByPath(this.entryId())?.content ?? '';
		const { metadata, body, preserved } = parseFrontmatter(initialContent);
		this.metadata.set(metadata);
		this.preservedFrontmatter.set(preserved);
		this.lastSavedContent = body;

		this.crepe = new Crepe({
			root: container,
			defaultValue: body,
			features: {
				[Crepe.Feature.Cursor]: true,
			},
			featureConfigs: {
				[Crepe.Feature.Cursor]: {
					color: '#ff0000',
					width: 2,
					virtual: false,
				},
			},
		});

		// Auto-save on user edit — re-inject frontmatter before saving
		this.crepe.on((listener) => {
			listener.markdownUpdated((_ctx, markdown) => {
				if (this.isExternalUpdate) return;

				const entry = this.vault.getByPath(this.entryId());
				if (!entry) return;

				const full = serializeFrontmatter(
					{ ...this.metadata(), createdAt: entry.createdAt },
					markdown,
					this.preservedFrontmatter(),
				);
				if (entry.content !== full) {
					this.lastSavedContent = markdown;
					void this.vault.updateFile(entry.id, full);
				}
			});
		});

		// Suppress Milkdown's initial markdownUpdated("") during create
		this.isExternalUpdate = true;
		await this.crepe.create();

		// Feed the editor with current vault content
		const mountEntry = this.vault.getByPath(this.entryId());
		if (mountEntry) {
			this.setContent(mountEntry.content ?? '');
		}

		// Re-read from disk now that the editor is ready —
		// picks up changes made since the last vault init.
		void this.refreshCurrentEntry('open');

		// Start polling the visible note every 5 seconds.
		this.refreshTimer = setInterval(() => {
			void this.refreshCurrentEntry('poll');
		}, 5000);
	}

	// ──────────────────────────────────────────────
	// Window focus — re-read from disk when user
	// switches back to the app after editing externally
	// ──────────────────────────────────────────────

	/**
	 * Re-read the currently visible note from disk via the sync engine.
	 * Skips refresh if the entry has unsaved local pending changes
	 * (avoids creating conflict copies for the user's own edits).
	 */
	private async refreshCurrentEntry(trigger: string): Promise<void> {
		const entry = this.vault.getByPath(this.entryId());
		if (!entry || entry.deleted) return;

		// Skip if the entry has pending sync — the user is mid-edit and
		// the push hasn't completed yet. An external change arriving now
		// would create a .conflict-* copy, which is jarring when you're
		// typing.
		if (entry.pendingAdapters.length > 0) return;

		console.warn(
			`[Editor] Refreshing note "${entry.path}" (trigger: ${trigger})`,
		);
		await this.syncEngine.refreshEntry(entry.id);
	}

	/**
	 * Replace the editor's entire document via ProseMirror Slice.
	 * Strips frontmatter and updates the metadata signal before pushing to Milkdown.
	 * Used when vault content changes externally (sync, switch note, etc.).
	 */
	private setContent(markdown: string): void {
		const editor = this.crepe?.editor;
		if (!editor) return;

		this.isExternalUpdate = true;

		try {
			const { metadata, body, preserved } = parseFrontmatter(markdown);
			this.metadata.set(metadata);
			this.preservedFrontmatter.set(preserved);

			editor.action((ctx) => {
				const view = ctx.get(editorViewCtx);
				const parser = ctx.get(parserCtx);
				const doc = parser(body);

				const { state } = view;
				const tr = state.tr.replace(
					0,
					state.doc.content.size,
					new Slice(doc.content, 0, 0),
				);
				view.dispatch(tr);
			});

			this.lastSavedContent = body;
		} finally {
			this.isExternalUpdate = false;
		}
	}
}
