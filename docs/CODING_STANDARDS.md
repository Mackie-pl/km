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

## Checklist

Before committing code:

- [ ] No `any` types (except absolute last resort with `// @ts-ignore` comment)
- [ ] All `unknown` values narrowed with type guards
- [ ] No magic strings/numbers — all in const objects
- [ ] Errors discriminated by name/code, not message
- [ ] API boundary types explicitly defined
- [ ] Input props have explicit types
- [ ] Mutable data marked `readonly` where appropriate
