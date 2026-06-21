import { Component, computed, inject, input, Type } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
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

/**
 * Note toolbar — icon picker button + tag pills for the current note.
 *
 * Displays the note's icon (from frontmatter or a default emoji) and tag pills.
 * The icon button opens the full icon picker dialog (emoji + Lucide searchable).
 *
 * Reads metadata reactively from VaultStore via parseFrontmatter on the entry content.
 */
@Component({
	selector: 'app-note-toolbar',
	standalone: true,
	imports: [NgComponentOutlet],
	templateUrl: './note-toolbar.component.html',
	styleUrl: './note-toolbar.component.scss',
})
export class NoteToolbarComponent {
	readonly entryId = input.required<string>();

	private readonly vault = inject(VaultStore);
	private readonly iconPicker = inject(IconPickerService);

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

	/** Tags to display — falls back to sample data when no tags set. */
	readonly displayTags = computed(() => {
		const tags = this.metadata().tags;
		if (tags && tags.length > 0) return tags;
		return ['sample', 'demo'];
	});

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
}
