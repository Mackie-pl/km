# Project Context: Minimalistic Note App

You are an expert full-stack developer helping build a cross-platform, minimalistic note-taking app.

# TypeScript/Angular Commandments

1. **KISS** — Unless complexity is proven necessary, use as little code, abstraction, and entities as possible. A flat function beats a class hierarchy.

2. **DRY** — Every line removed is a win. If you write it twice, extract it. If you write it once, it's fine.

3. **Type Safety First** — Never use `any`. Use union types over strings, generics over type casts, `as const` over magic values. Narrow `unknown` immediately at boundaries.

4. **Signals Over RxJS** — Everything reactive is a `signal()` or `computed()`. Reserve `BehaviorSubject` only for complex async streams that Signals can't handle.

5. **No Premature Abstraction** — Build for what exists today, not what you imagine tomorrow. Extract when the third duplicate appears, not the second.

6. **Prefer Flat & Readable** — Flatter structures are easier to read and debug. Nesting = complexity tax. Code is read 10× more than it's written.

7. **Small Files** — If a file exceeds ~200 lines, it's probably doing too much. Split by responsibility.

## Tech Stack

- **Frontend:** Angular (Latest), TypeScript
- **Styling:** Tailwind CSS (v4)
- **UI Components:** Taiga UI
- **Desktop/Mobile Core:** Tauri 2.0 (Rust)

## Coding Standards & Rules

### TypeScript & Type Safety

**See [CODING_STANDARDS.md](../docs/CODING_STANDARDS.md) for comprehensive guidelines.**

Core principles:

- **NEVER use `any`** — always choose specific types or narrow `unknown` quickly
- **No magic strings/numbers** — use `readonly const` objects or enum-like structures
- **Type guards** — narrow types at boundaries (JSON, APIs, external data)
- **Error codes** — discriminate errors by code/name, never by message

Example:

```typescript
// ❌ BAD
const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });

// ✅ GOOD
const FILE_SYSTEM_MODES = { READ_WRITE: 'readwrite' } as const;
function isFileSystemPickerSupported(
	obj: unknown,
): obj is { showDirectoryPicker: Function } {
	return (
		typeof obj === 'object' && obj !== null && 'showDirectoryPicker' in obj
	);
}
if (isFileSystemPickerSupported(window)) {
	const handle = await window.showDirectoryPicker({
		mode: FILE_SYSTEM_MODES.READ_WRITE,
	});
}
```

### Angular

- **Strictly use Standalone Components:** Do NOT use or generate `NgModules`.
- **Reactivity:** Strictly use Angular Signals (`signal`, `computed`, `effect`) for state management. Avoid RxJS `BehaviorSubjects` unless absolutely necessary for complex asynchronous data streams.
- **Control Flow:** Use the modern Angular Control Flow syntax (`@if`, `@for`, `@defer`) instead of structural directives (`*ngIf`, `*ngFor`).
- **Inputs/Outputs:** Use Signal inputs (`input()`) and model inputs (`model()`) over the `@Input()` decorator.

### Tailwind CSS

- We are using Tailwind v4 (CSS-first configuration). Do NOT suggest adding or modifying `tailwind.config.js`.
- Use utility classes for ALL styling — colors, spacing, typography, hover states, dark mode.
- **No SCSS classes for theme colors** — component `.scss` files are intentionally empty placeholders. All colors come from Tailwind utilities.
- **No inline `style` attributes** — use `[ngClass]` for dynamic class switching when component logic drives which styles apply.
- Dark mode uses a manual `.dark` class on `<html>` (not `prefers-color-scheme`), configured via:
    ```css
    @custom-variant dark (&:where(.dark, .dark *));
    ```
- Use `dark:` variants for all dark mode overrides: `dark:bg-gray-900`, `dark:text-gray-100`, etc.

## UI Design Tokens (Tailwind Default Palette)

Our app uses Tailwind's default color palette — no custom `@theme` variables. This keeps the token surface minimal and leverages the full power of Tailwind's built-in color scale.

### Surface Colors

| Role                      | Light               | Dark                     |
| ------------------------- | ------------------- | ------------------------ |
| Main content area         | `bg-white`          | `dark:bg-gray-950`       |
| Sidebar, secondary panels | `bg-gray-50`        | `dark:bg-gray-900`       |
| Header bar                | `bg-gray-100`       | `dark:bg-gray-900`       |
| Interactive hover         | `hover:bg-gray-200` | `dark:hover:bg-gray-800` |

### Text Colors

| Role                      | Light           | Dark                 |
| ------------------------- | --------------- | -------------------- |
| Primary (headings, body)  | `text-gray-900` | `dark:text-gray-100` |
| Secondary (labels, icons) | `text-gray-500` | `dark:text-gray-400` |

### Borders & Dividers

| Role           | Light             | Dark                   |
| -------------- | ----------------- | ---------------------- |
| Default border | `border-gray-200` | `dark:border-gray-700` |

### Accent (Indigo)

| Role                         | Light               | Dark                     |
| ---------------------------- | ------------------- | ------------------------ |
| Accent border (selected)     | `border-indigo-500` | `dark:border-indigo-400` |
| Accent background (selected) | `bg-indigo-50`      | `dark:bg-indigo-900/50`  |

### Pattern: Hoverable Interactive Element

```html
<button
	class="text-gray-500 dark:text-gray-400
               hover:bg-gray-200 dark:hover:bg-gray-800
               hover:text-gray-900 dark:hover:text-gray-100
               transition-colors duration-150"
>
	<!-- icon/content -->
</button>
```

### Pattern: Themed Surface Container

```html
<div
	class="bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 border-r"
>
	<!-- sidebar / panel content -->
</div>
```

### Dark Mode

- Configured in `styles.scss`: `@custom-variant dark (&:where(.dark, .dark *));`
- Toggled via `document.documentElement.classList.toggle("dark", isDark)` in `settings.component.ts`
- Every color class gets a `dark:` counterpart

### Taiga UI

- Use Taiga UI strictly for micro-interactions (dropdowns, inputs, dialogs, rich text editor).
- Use granular imports for Taiga components directly in the standalone component's `imports` array (e.g., `import { TuiButton } from '@taiga-ui/core/components/button'` or `import { TuiBadge } from '@taiga-ui/kit/components/badge'`).
    - Core components: `@taiga-ui/core/components/<component-name>` (button, textfield, root, etc.)
    - Kit components: `@taiga-ui/kit/components/<component-name>` (badge, badge-notification, chip, select, etc.)
    - Dialog service: `@taiga-ui/core/portals/dialog`
    - Polymorpheus: `@taiga-ui/polymorpheus`

### Lucide Icons

- **Use `@lucide/angular` for ALL icons.** Do NOT use emoji, SVG files, or Taiga icons for iconography.
- Import icons individually from `@lucide/angular` (e.g., `import { LucideSettings, LucideMoon, LucideSun } from '@lucide/angular'`).
- Add each imported icon to the component's `imports` array.
- Use icons as SVG elements in templates: `<svg lucideSettings></svg>`, `<svg lucideMoon></svg>`, `<svg lucideSun></svg>`.
- Size icons with Tailwind classes: `<svg lucideSettings class="size-5"></svg>`.
- Available icons: https://lucide.dev/icons/ — search for the icon name, then import `Lucide<IconName>` (PascalCase).

### Tauri 2.0

- When generating Tauri commands, ensure they conform to the Tauri 2.0 IPC API syntax.
- Assume the app runs on Windows, Ubuntu, and Android. Use conditional Rust compilation (`#[cfg(target_os = "...")]`) when dealing with OS-specific window controls.
- For desktop window dragging, utilize the `data-tauri-drag-region` HTML attribute.

## Generation Rules

- Before outputting code, briefly outline the approach.
- Ensure the generated code is self-contained and handles edge cases.
- Do not over-engineer; prioritize simplicity, extreme performance, and small bundle sizes.

### Rust & Tauri 2.0 (Beginner Context)

- The user has zero Rust experience and comes from a TypeScript background.
- When generating Rust code, explain what it does using TypeScript analogies.
- Heavily comment the Rust code explaining concepts like Ownership, Borrowing, or Results if they appear.
- In Tauri 2.0, remember that File System operations require the `tauri-plugin-fs` plugin. Do not use standard library `std::fs` unless strictly necessary; prefer the Tauri API.
- Always show the Angular/TypeScript side of how to invoke the generated Rust command.

# Verification Protocol

Before you consider a coding task complete, you must adhere to the following rules:

1. Do not leave syntax or TypeScript errors.
2. Run `pnpm run verify` in the terminal.
3. If the command outputs any build, lint, or jscpd errors, you must analyze the errors and fix them automatically before concluding your response.
    - jscpd flags clones exceeding **50 tokens**. For wizard/multi-step templates where footer button groups are structurally similar, use different HTML elements (`<footer>` vs `<nav>`), vary class ordering, and slightly different text content to stay under the threshold.
