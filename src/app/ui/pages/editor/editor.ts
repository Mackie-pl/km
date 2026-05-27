import {
	Component,
	effect,
	inject,
	input,
	OnDestroy,
	viewChild,
	afterNextRender,
	type ElementRef,
} from '@angular/core';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, parserCtx } from '@milkdown/kit/core';
import { Slice } from '@milkdown/kit/prose/model';
import { VaultStore } from '@vault/store';

@Component({
	selector: 'app-editor',
	templateUrl: './editor.html',
	styles: `
		:host::ng-deep .milkdown {
			height: 100%;
		}
	`,
	host: {
		class: 'flex-1',
	},
})
export class Editor implements OnDestroy {
	entryId = input.required<string>();

	private readonly vault = inject(VaultStore);
	private readonly editorContainer = viewChild<ElementRef>('editorContainer');

	private crepe: Crepe | null = null;

	/** Snapshot of the last content we saved — avoids echo-loop on external updates. */
	private lastSavedContent = '';

	/** Guard that prevents the save callback from firing when we push content. */
	private isExternalUpdate = false;

	constructor() {
		// Bootstrap Crepe once the DOM is ready
		afterNextRender((): void => {
			void this.initEditor();
		});

		// Reactively push vault content into the editor when it changes externally.
		effect((): void => {
			const entry = this.vault.getByPath(this.entryId());
			const currentContent = entry?.content ?? '';
			if (!this.crepe) return;

			if (currentContent !== this.lastSavedContent) {
				this.setContent(currentContent);
			}
		});
	}

	// ──────────────────────────────────────────────
	// Lifecycle
	// ──────────────────────────────────────────────

	ngOnDestroy(): void {
		void this.crepe?.destroy();
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
		this.lastSavedContent = initialContent;

		console.log('Initializing editor with content:', initialContent);
		this.crepe = new Crepe({
			root: container,
			defaultValue: initialContent,
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

		// Auto-save on user edit
		this.crepe.on((listener) => {
			listener.markdownUpdated((_ctx, markdown) => {
				if (this.isExternalUpdate) return;

				const entry = this.vault.getByPath(this.entryId());
				if (entry && entry.content !== markdown) {
					this.lastSavedContent = markdown;
					void this.vault.updateFile(entry.id, markdown);
				}
			});
		});

		await this.crepe.create();
	}

	/**
	 * Replace the editor's entire document via ProseMirror Slice.
	 * Used when vault content changes externally (sync, switch note, etc.).
	 */
	private setContent(markdown: string): void {
		const editor = this.crepe?.editor;
		if (!editor) return;

		this.isExternalUpdate = true;

		try {
			editor.action((ctx) => {
				const view = ctx.get(editorViewCtx);
				const parser = ctx.get(parserCtx);
				const doc = parser(markdown);

				const { state } = view;
				const tr = state.tr.replace(
					0,
					state.doc.content.size,
					new Slice(doc.content, 0, 0),
				);
				view.dispatch(tr);
			});

			this.lastSavedContent = markdown;
		} finally {
			this.isExternalUpdate = false;
		}
	}
}
