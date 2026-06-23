import {
	Component,
	computed,
	inject,
	input,
	signal,
	Type,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgComponentOutlet } from '@angular/common';
import { LucidePlus } from '@lucide/angular';
import {
	TuiDropdownDirective,
	TuiDropdownManual,
} from '@taiga-ui/core/portals/dropdown';
import { VaultStore } from '@vault/store';
import {
	parseFrontmatter,
	serializeFrontmatter,
} from '@core/utils/frontmatter-parser';
import {
	type NoteMetadata,
	DEFAULT_NOTE_ICON,
} from '@core/types/note-metadata';
import { IconPickerService } from '@ui/partials/icon-picker/icon-picker.service';
import { LUCIDE_COMPONENT_MAP } from '@core/utils/lucide-map';

/** Characters that would break inline YAML tag array syntax. */
const FORBIDDEN_TAG_CHARS = /[[\],]/;

/**
 * Note toolbar — icon picker button + tag pills + tag picker for the current note.
 *
 * Displays the note's icon (from frontmatter or a default emoji) and tag pills.
 * The icon button opens the full icon picker dialog (emoji + Lucide searchable).
 * The tag picker button opens a dropdown with a checkbox list of all known tags
 * plus an "add new tag" input.
 *
 * Reads metadata reactively from VaultStore via parseFrontmatter on the entry content.
 */
@Component({
	selector: 'app-note-toolbar',
	standalone: true,
	imports: [
		FormsModule,
		NgComponentOutlet,
		LucidePlus,
		TuiDropdownDirective,
		TuiDropdownManual,
	],
	templateUrl: './note-toolbar.component.html',
	styleUrl: './note-toolbar.component.scss',
})
export class NoteToolbarComponent {
	readonly entryId = input.required<string>();

	private readonly vault = inject(VaultStore);
	private readonly iconPicker = inject(IconPickerService);

	/** Whether the tag picker dropdown is open. */
	readonly tagDropdownOpen = signal(false);

	/** The "add new tag" input value. */
	readonly newTagInput = signal('');

	/** Metadata extracted from the current note's frontmatter. */
	private readonly metadata = computed<NoteMetadata>(() => {
		const entry = this.vault.getByPath(this.entryId());
		if (!entry?.content) return {};
		const { metadata } = parseFrontmatter(entry.content);
		return metadata;
	});

	/** The icon value from frontmatter — falls back to the default emoji. */
	readonly displayIcon = computed(
		() => this.metadata().icon ?? DEFAULT_NOTE_ICON,
	);

	/** True when the stored icon is a Lucide icon (starts with "lucide:"). */
	readonly isLucideIcon = computed(() =>
		this.displayIcon().startsWith('lucide:'),
	);

	/** The Lucide component class to render, or null if the icon is an emoji. */
	readonly lucideComponent = computed<Type<unknown> | null>(() => {
		const icon = this.displayIcon();
		if (!icon.startsWith('lucide:')) return null;
		const kebab = icon.slice('lucide:'.length);
		return LUCIDE_COMPONENT_MAP.get(kebab) ?? null;
	});

	/** Tags for the current note, lowercased. */
	readonly currentTags = computed(() => {
		const tags = this.metadata().tags;
		return tags ? tags.map((t) => t.toLowerCase()) : [];
	});

	/** Tags for display as pills — uses current note tags or empty array. */
	readonly displayTags = computed(() => this.currentTags());

	/** All tags across the workspace that aren't already on this note. */
	readonly availableTags = computed(() => {
		const current = new Set(this.currentTags());
		return this.vault.allTags().filter((t) => !current.has(t));
	});

	/** Whether the new-tag input contains forbidden characters. */
	readonly newTagInvalid = computed(() =>
		FORBIDDEN_TAG_CHARS.test(this.newTagInput()),
	);

	/** Open the icon picker dialog and persist the selection to frontmatter. */
	async openIconPicker(): Promise<void> {
		const selected = await this.iconPicker.openIconPicker();
		if (selected === null) return; // cancelled

		const entry = this.vault.getByPath(this.entryId());
		if (!entry?.content) return;

		const { metadata, body } = parseFrontmatter(entry.content);
		metadata.icon = selected;

		const newContent = serializeFrontmatter(metadata, body);
		await this.vault.updateFile(entry.id, newContent);
	}

	/** Toggle a tag on the current note — add if absent, remove if present. */
	async toggleTag(tag: string): Promise<void> {
		const lowerTag = tag.toLowerCase();
		const entry = this.vault.getByPath(this.entryId());
		if (!entry?.content) return;

		const { metadata, body } = parseFrontmatter(entry.content);
		const current = metadata.tags ?? [];

		if (current.map((t) => t.toLowerCase()).includes(lowerTag)) {
			metadata.tags = current.filter((t) => t.toLowerCase() !== lowerTag);
		} else {
			metadata.tags = [...current, lowerTag];
		}

		const newContent = serializeFrontmatter(metadata, body);
		await this.vault.updateFile(entry.id, newContent);
	}

	/**
	 * Add a brand-new tag. Validates, lowercases, then toggles it onto the note.
	 * Resets the input on success.
	 */
	async addNewTag(): Promise<void> {
		const raw = this.newTagInput().trim();
		if (!raw || FORBIDDEN_TAG_CHARS.test(raw)) return;
		this.newTagInput.set('');
		await this.toggleTag(raw);
	}

	/** Close the tag picker dropdown. */
	closeTagDropdown(): void {
		this.tagDropdownOpen.set(false);
		this.newTagInput.set('');
	}
}
