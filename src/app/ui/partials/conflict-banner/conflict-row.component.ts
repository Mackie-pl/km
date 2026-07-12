import { Component, input, output } from '@angular/core';

/**
 * One action row inside the conflict banner: a link to the other version
 * plus "use it" / "discard it" buttons. Extracted so the banner template
 * stays within the max nesting depth.
 */
@Component({
	selector: 'app-conflict-row',
	standalone: true,
	templateUrl: './conflict-row.component.html',
})
export class ConflictRowComponent {
	/** Label of the linked version (empty hides the link). */
	readonly name = input.required<string>();
	/** Label of the primary adopt-action button (empty hides it). */
	readonly useLabel = input.required<string>();
	/** Label of the secondary discard button. */
	readonly discardLabel = input.required<string>();

	readonly openVersion = output();
	readonly useVersion = output();
	readonly discardVersion = output();
}
