# Coding Standards — Type Safety & Code Quality

## Core Principle

**Never sacrifice type safety for convenience.** Type errors are the most preventable category of bugs.

---

## TypeScript: Type Safety

### ❌ NEVER use `any`

`any` disables TypeScript's type checking entirely and defeats the purpose of using TypeScript.

```typescript
// ❌ BAD
const handle = await (window as any).showDirectoryPicker();
const data = JSON.parse(jsonString) as any;
```

### ✅ Narrow `unknown` quickly

When you truly don't know the type (e.g., from JSON, external APIs, runtime values), use `unknown` but **narrow immediately**:

```typescript
// ✅ GOOD
function parseConfig(input: unknown): Config {
	if (typeof input !== 'object' || input === null) {
		throw new Error('Config must be an object');
	}
	if (!('name' in input) || typeof input.name !== 'string') {
		throw new Error('Config.name must be a string');
	}
	return input as Config; // Now safe
}
```

#### Pattern: Type Guards

```typescript
// ✅ GOOD: Reusable type guard
function isFileSystemPickerSupported(
	obj: unknown,
): obj is { showDirectoryPicker: Function } {
	return (
		typeof obj === 'object' &&
		obj !== null &&
		'showDirectoryPicker' in obj &&
		typeof obj.showDirectoryPicker === 'function'
	);
}

// Usage
if (isFileSystemPickerSupported(window)) {
	const handle = await window.showDirectoryPicker();
}
```

---

## Magic Strings & Constants

### ❌ NEVER hardcode strings, numbers, or mode values

Magic strings scatter throughout code, are impossible to refactor, and cause silent bugs.

```typescript
// ❌ BAD
async pickWorkspaceFolder() {
  const dirHandle = await window.showDirectoryPicker({
    mode: "readwrite", // ← magic string
  });
  const path = `browser:${name}`; // ← magic string prefix
  if (error.name === "AbortError") { // ← magic string
    return null;
  }
}
```

### ✅ Use readonly const objects or enums

```typescript
// ✅ GOOD: Const object (preferred in modern TypeScript)
const FILE_SYSTEM_MODES = {
	READ_WRITE: 'readwrite',
	READ_ONLY: 'readonly',
} as const;

const WORKSPACE_PATH_PREFIX = 'browser:' as const;

const DOM_EXCEPTION_NAMES = {
	ABORT_ERROR: 'AbortError',
	SECURITY_ERROR: 'SecurityError',
	NOT_ALLOWED_ERROR: 'NotAllowedError',
} as const;

// Usage
const dirHandle = await window.showDirectoryPicker({
	mode: FILE_SYSTEM_MODES.READ_WRITE,
});

const path = `${WORKSPACE_PATH_PREFIX}${name}`;

if (
	error instanceof DOMException &&
	error.name === DOM_EXCEPTION_NAMES.ABORT_ERROR
) {
	return null;
}
```

#### Const Objects vs Enums

**Prefer `const` objects** — they are:

- More ergonomic with autocomplete
- Smaller bundle size
- Simpler TypeScript

```typescript
// ✅ PREFERRED
const OPERATION_TYPE = {
	CREATE: 'create',
	UPDATE: 'update',
	DELETE: 'delete',
} as const;

type OperationType = (typeof OPERATION_TYPES)[keyof typeof OPERATION_TYPES];
```

Reserve `enum` for when you need:

- Reverse mapping (string → number)
- Numeric values for binary flags
- Very large value sets

---

## Error Handling

### ✅ Discriminate errors with constants, never by string message

```typescript
// ❌ BAD
if (error.message.includes('not allowed')) {
}

// ✅ GOOD
if (
	error instanceof DOMException &&
	error.name === DOM_EXCEPTION_NAMES.ABORT_ERROR
) {
}

// ✅ GOOD: Custom error types
const ERROR_CODES = {
	INVALID_WORKSPACE: 'INVALID_WORKSPACE',
	PERMISSION_DENIED: 'PERMISSION_DENIED',
	NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

class AppError extends Error {
	constructor(
		public code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
		message: string,
	) {
		super(message);
		this.name = 'AppError';
	}
}

throw new AppError(ERROR_CODES.PERMISSION_DENIED, 'Cannot access workspace');
```

---

## API Boundaries

### ✅ Define strict types at entry points

Whenever data enters from outside (APIs, form inputs, file I/O, `JSON.parse`):

```typescript
// ✅ GOOD
interface WorkspaceConfig {
	readonly name: string;
	readonly path: string;
	readonly created: Date;
}

function parseWorkspaceConfig(input: unknown): WorkspaceConfig {
	if (!isValidConfig(input)) {
		throw new Error('Invalid workspace config');
	}
	return input;
}

// NEVER let untyped data flow into your business logic
```

---

## Signal & Component Props

### ✅ Always define input types explicitly

```typescript
// ❌ BAD
export class NoteComponent {
	note = input<any>();
}

// ✅ GOOD
export interface Note {
	readonly id: string;
	readonly title: string;
	readonly content: string;
	readonly created: Date;
}

export class NoteComponent {
	note = input<Note>();
}
```

---

## Readonly Properties

### ✅ Use `readonly` for immutable data

```typescript
// ✅ GOOD
interface NoteData {
	readonly id: string;
	readonly content: string;
	readonly tags: readonly string[];
}

const DEFAULTS = {
	MAX_WORKSPACE_SIZE_MB: 1024,
	DEFAULT_THEME: 'light',
} as const;
```

---

## Defensive Programming

### ✅ Guard clauses — fail fast at the top

Validate inputs, state, and preconditions immediately. Don't let bad data propagate.

```typescript
// ❌ BAD — processes with invalid state
loadNotes() {
  if (this.workspaceId()) {
    this.fetchNotes(this.workspaceId());
  }
}

// ✅ GOOD — guard clause, fail fast
loadNotes() {
  const id = this.workspaceId();
  if (!id) return;
  this.fetchNotes(id);
}
```

```typescript
// ✅ GOOD: Validate at function entry
async deleteNote(id: string): Promise<void> {
  if (!id.trim()) throw new Error('Cannot delete note: id is empty');
  if (!this.notes().has(id)) throw new Error(`Note not found: ${id}`);
  // ... proceed safely
}
```

### ✅ Null/undefined safety — check before accessing

Optional values must be narrowed before use. Never assume a value is present.

```typescript
// ❌ BAD
this.note()!.content;

// ✅ GOOD
const note = this.note();
if (note) {
	render(note.content);
}
```

When dealing with chained optional access, always provide a fallback:

```typescript
// ⚠️ Acceptable if the access chain is purely display-only
const title = note?.title ?? 'Untitled';

// ✅ Better: narrow explicitly when you need the value for logic
const n = this.selectedNote();
if (!n) return;
process(n.content);
```

### ✅ Validate at every boundary — never trust external data

Every point where data enters your system (forms, localStorage, IPC, file reads, URL params, `JSON.parse`) is a boundary. Validate immediately.

```typescript
// ✅ GOOD: Validate localStorage
function loadTheme(): Theme {
	const raw = localStorage.getItem('theme');
	if (raw !== 'light' && raw !== 'dark') return 'light'; // fallback
	return raw;
}
```

```typescript
// ✅ GOOD: Validate Tauri IPC response
interface FileMeta {
	readonly name: string;
	readonly size: number;
}
function parseFileMeta(input: unknown): FileMeta {
	if (typeof input !== 'object' || input === null)
		throw new Error('Invalid file meta');
	if (!('name' in input) || typeof input.name !== 'string')
		throw new Error('File meta: name must be string');
	if (!('size' in input) || typeof input.size !== 'number')
		throw new Error('File meta: size must be number');
	return { name: input.name, size: input.size };
}
```

### ✅ Wrap third-party calls in try/catch

Never assume external libraries, browser APIs, or Tauri commands won't throw.

```typescript
// ✅ GOOD
async function readFile(path: string): Promise<string> {
	try {
		return await invoke('read_text_file', { path });
	} catch (err) {
		console.error(`Failed to read file: ${path}`, err);
		throw new AppError(
			ERROR_CODES.FILE_READ_ERROR,
			`Could not read ${path}`,
		);
	}
}
```

### ✅ Defensive copies — don't mutate shared state

When receiving arrays or objects from external sources or signals, copy before mutating.

```typescript
// ❌ BAD — mutates the original array in place
sortNotes() {
  this.notes().sort((a, b) => a.title.localeCompare(b.title));
}

// ✅ GOOD — creates a sorted copy
sortNotes() {
  this.notes.update(list => [...list].sort((a, b) => a.title.localeCompare(b.title)));
}
```

```typescript
// ✅ GOOD: Copy before mutating external data
updateNote(id: string, updates: Partial<Note>) {
  this.notes.update(list =>
    list.map(n => n.id === id ? { ...n, ...updates } : n)
  );
}
```

### ✅ Default/fallback values — always have a plan B

Optional configuration, environment variables, and function parameters should have sensible defaults.

```typescript
// ✅ GOOD
const SETTINGS_DEFAULTS = {
	theme: 'light',
	fontSize: 14,
	autoSave: true,
} as const;

function loadSettings(
	overrides?: Partial<typeof SETTINGS_DEFAULTS>,
): typeof SETTINGS_DEFAULTS {
	return { ...SETTINGS_DEFAULTS, ...overrides };
}
```

### ✅ Prefer early returns to deep nesting

Flatten conditional logic with early returns instead of deeply nested `if` blocks.

```typescript
// ❌ BAD — nested
if (user) {
	if (user.isActive) {
		if (user.canEdit) {
			// render editor
		}
	}
}

// ✅ GOOD — early returns
if (!user) return;
if (!user.isActive) return;
if (!user.canEdit) return;
// render editor
```

---

## Checklist

Before committing code:

- [ ] No `any` types (except absolute last resort with `// @ts-ignore` comment)
- [ ] All `unknown` values narrowed with type guards
- [ ] No magic strings/numbers — all in const objects
- [ ] Errors discriminated by name/code, not message
- [ ] API boundary types explicitly defined
- [ ] Input props have explicit types
- [ ] Mutable data marked `readonly` where appropriate
- [ ] Guard clauses at function entry for all preconditions
- [ ] External data validated at the boundary
- [ ] Third-party calls wrapped in try/catch
- [ ] Shared arrays/objects defensively copied before mutation
- [ ] Early returns used to flatten deep nesting
