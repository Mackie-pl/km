---
name: tailwind-styling
description: 'Tailwind CSS v4 utility-first styling for Angular templates. Use when: creating new components, styling buttons/links/panels, reducing verbose class lists (>5 classes per element), handling conditional active/hover/focus states, or refactoring duplicated utility class strings. Covers @apply extraction, [attr.data-*] + CSS selectors, component extraction, and the project design tokens.'
argument-hint: 'Component or pattern to style (e.g., "file entry button", "sidebar panel")'
---

# Tailwind CSS v4 Styling for Angular

## When to Use

- Creating a new UI component or template
- An element has **more than ~5 utility classes** in a single `class` attribute
- The same class string is **copied verbatim** across multiple elements or files
- You need conditional styling for active/selected/hover/disabled states
- You're unsure whether to use `@apply`, `[attr.data-*]`, or component extraction

## Design Tokens (Quick Reference)

These are the project's standard Tailwind utility patterns. Use them directly in templates.

| Role              | Light                            | Dark                                           |
| ----------------- | -------------------------------- | ---------------------------------------------- |
| Main content      | `bg-white`                       | `dark:bg-gray-950`                             |
| Sidebar / panels  | `bg-gray-50`                     | `dark:bg-gray-900`                             |
| Header bar        | `bg-gray-100`                    | `dark:bg-gray-900`                             |
| Interactive hover | `hover:bg-gray-200`              | `dark:hover:bg-gray-800`                       |
| Primary text      | `text-gray-900`                  | `dark:text-gray-100`                           |
| Secondary text    | `text-gray-500`                  | `dark:text-gray-400`                           |
| Borders           | `border-gray-200`                | `dark:border-gray-700`                         |
| Accent (selected) | `border-indigo-500 bg-indigo-50` | `dark:border-indigo-400 dark:bg-indigo-900/50` |

### Standard Interactive Button Pattern

```html
<button
	class="flex items-center justify-center size-8 rounded-lg border-none
         bg-transparent cursor-pointer transition-colors duration-150
         text-gray-500 dark:text-gray-400
         hover:bg-gray-200 dark:hover:bg-gray-800
         hover:text-gray-900 dark:hover:text-gray-100"
>
	<!-- icon -->
</button>
```

### Standard Interactive Row Pattern (wider, with gap)

```html
<button
	class="flex items-center w-full gap-3 px-3 py-2.5 rounded-lg border-none
         bg-transparent cursor-pointer transition-colors duration-150 text-left
         text-gray-500 dark:text-gray-400
         hover:bg-gray-200 dark:hover:bg-gray-800
         hover:text-gray-900 dark:hover:text-gray-100"
>
	<!-- icon + label -->
</button>
```

## Decision Tree: How to Reduce Class Bloat

When an element has >5 classes or the same class list repeats across many elements, choose one:

### Strategy 1: `[attr.data-*]` + CSS `@apply` (BEST for state-based styling)

**When**: One element has many `[class.*]` bindings for active/selected states.

**How**: Add a `[attr.data-active]` attribute, then define styles in the component's `.scss` using `@apply`.

```html
<!-- BEFORE: 16 [class.*] bindings in template -->
<button
	[class.border-l-2]="entry.path === activeEntryPath()"
	[class.border-indigo-500]="entry.path === activeEntryPath()"
	[class.dark:border-indigo-400]="entry.path === activeEntryPath()"
	[class.bg-indigo-50]="entry.path === activeEntryPath()"
	[class.dark:bg-indigo-900/50]="entry.path === activeEntryPath()"
	[class.text-indigo-600]="entry.path === activeEntryPath()"
	[class.dark:text-indigo-400]="entry.path === activeEntryPath()"
	[class.text-gray-500]="entry.path !== activeEntryPath()"
	[class.dark:text-gray-400]="entry.path !== activeEntryPath()"
	[class.hover:bg-gray-200]="entry.path !== activeEntryPath()"
	[class.dark:hover:bg-gray-800]="entry.path !== activeEntryPath()"
	[class.hover:text-gray-900]="entry.path !== activeEntryPath()"
	[class.dark:hover:text-gray-100]="entry.path !== activeEntryPath()"
	class="flex items-center w-full gap-3 px-3 py-2.5 rounded-lg ..."
	[attr.data-active]="entry.path === activeEntryPath()"
></button>
```

```html
<!-- AFTER: One [attr.data-active] + CSS handles the rest -->
<button
	class="file-entry-btn"
	[attr.data-active]="entry.path === activeEntryPath()"
></button>
```

```scss
/* In the component's .scss file */
.file-entry-btn {
	@apply flex items-center w-full gap-3 px-3 py-2.5 rounded-lg border-none
         bg-transparent cursor-pointer transition-colors duration-150 text-left
         text-gray-500 dark:text-gray-400;

	&:hover {
		@apply bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100;
	}

	&[data-active='true'] {
		@apply border-l-2 border-indigo-500 bg-indigo-50 text-indigo-600
           dark:border-indigo-400 dark:bg-indigo-900/50 dark:text-indigo-400;
	}
}
```

**Rules for `@apply` in SCSS**:

- Only use `@apply` when a `[attr.data-*]` selector or repeated pattern justifies it
- Keep the SCSS class in the **same component's `.scss` file** — don't create global utility classes
- The SCSS file is no longer an "empty placeholder" — it now serves a purpose
- Don't `@apply` a single-use class list; only extract when it eliminates duplication

### Strategy 2: Extract to a Component (BEST for repeated UI elements)

**When**: The same styled element (button, card, chip) appears in **3+ different parent components** with the same structure AND behavior.

**How**: Create a dedicated component that encapsulates both the template and styles.

```typescript
// file-entry-button.component.ts
@Component({
	selector: 'app-file-entry-button',
	standalone: true,
	imports: [LucideFileText],
	template: `
		<button
			class="file-entry-btn"
			[attr.data-active]="active()"
			(click)="clicked.emit()"
			[attr.aria-label]="label()"
		>
			<svg lucideFileText class="size-5 flex-shrink-0"></svg>
			@if (showLabel()) {
				<span class="text-sm truncate">{{ label() }}</span>
			}
		</button>
	`,
	styleUrl: './file-entry-button.component.scss',
})
export class FileEntryButtonComponent {
	readonly active = input(false);
	readonly label = input.required<string>();
	readonly showLabel = input(true);
	readonly clicked = output();
}
```

**When NOT to extract**: The element appears only in one parent, or it has no unique behavior (just a `<button>` with styles). Use Strategy 1 instead.

### Strategy 3: Multi-cursor / Accept Repetition (OK for 2–3 copies)

**When**: The same class string appears on 2–3 elements in the **same file**, and each element has slightly different other attributes (different `(click)` handlers, icons, labels).

**How**: Just keep the classes inline. It's not worth the abstraction overhead. Tailwind's own docs recommend this.

```html
<!-- Fine: two similar buttons in same file, different icons/actions -->
<button
	class="flex items-center ... hover:bg-gray-200 dark:hover:bg-gray-800 ..."
	(click)="syncNow()"
>
	<svg lucideRefreshCw class="size-5"></svg>
</button>
<button
	class="flex items-center ... hover:bg-gray-200 dark:hover:bg-gray-800 ..."
	(click)="openSettings()"
>
	<svg lucideSettings class="size-5"></svg>
</button>
```

## Anti-Patterns

### ❌ `[class.*]` for every state variant

Binding every conditional class individually creates enormous templates:

```html
<!-- ❌ 16 bindings for one button's active/inactive state -->
<button
	[class.border-indigo-500]="isActive"
	[class.dark:border-indigo-400]="isActive"
	[class.bg-indigo-50]="isActive"
	[class.text-indigo-600]="isActive"
	[class.text-gray-500]="!isActive"
	[class.hover:bg-gray-200]="!isActive"
	...10
	more...
></button>
```

→ Use `[attr.data-active]` + `@apply` in SCSS (Strategy 1).

### ❌ `@apply` for a single-use class

```scss
/* ❌ No duplication to eliminate — just keep it in the template */
.my-single-use-button {
	@apply flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white;
}
```

### ❌ Creating a component for a styled `<button>` used once

A component that wraps a single `<button>` with no reusable behavior is over-engineering. Only extract when it's used in 3+ places AND has shared behavior/logic.

### ❌ Inline `style` attributes

Never use `style=""` for colors, spacing, or typography. The only exception is dynamic CSS variables set via `[style.--var]` for values from a database/API.

### ❌ SCSS classes that duplicate Tailwind's design tokens

Don't hardcode colors in SCSS. Always use `@apply` with Tailwind utilities so the design system stays consistent:

```scss
/* ❌ */
.my-btn {
	background-color: #4f46e5;
}

/* ✅ */
.my-btn {
	@apply bg-indigo-600;
}
```

## Procedure for New Components

1. **Start with inline utilities** — build the component entirely with Tailwind classes in the template
2. **Identify repetition** — if the same class string appears 3+ times or any element has >5 classes, stop
3. **Choose a strategy** from the decision tree above
4. **Apply** the strategy and verify: `pnpm run verify`
5. **Self-review**: Could someone new to the file understand the styling in 30 seconds? If not, simplify

## Dark Mode

- Every color utility gets a `dark:` counterpart
- The `.dark` class on `<html>` is toggled manually (not `prefers-color-scheme`)
- Configured in `styles.scss`: `@custom-variant dark (&:where(.dark, .dark *));`

## Taiga UI + Tailwind Coexistence

- Use Tailwind for ALL layout, colors, spacing, and typography
- Use Taiga UI ONLY for complex interactive widgets: dropdowns, dialogs, rich text editor, selects
- Don't mix — a Taiga button should not have Tailwind color classes; a Tailwind-styled `<button>` should not use Taiga button directives

## Verification

After any styling change, run:

```bash
pnpm run verify
```

This checks build, lint, and jscpd (duplication detection). If jscpd flags clones, use Strategy 1 or 2 — but note the project's threshold is **50 tokens**, so small repetitions are fine.
