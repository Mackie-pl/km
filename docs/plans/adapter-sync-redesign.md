# Plan: Adapter Interface Redesign + Per-Adapter Sync Tracking

## Status: COMPLETED — Implemented via TDD (May 20, 2026)

## Motivation

The current `VaultEntry.dirty: boolean` is a single-adapter model pretending to support multiple. When an entry is pushed to adapter A and marked clean, adapter B (e.g., cloud) never gets it.

**Fix:** Replace `dirty: boolean` with `pendingAdapters: string[]` — per-adapter tracking so each adapter is independently synced.

---

## Architecture

```text
.── interface layer (Adapter)
├── singleton implementations (TauriFsAdapter, BrowserFsApiAdapter)
├── manager (AdaptersManager — DI, routing calls to the right adapter)
├── state (VaultStore.pendingAdapters[])
└── orchestrator (SyncEngineService — push + pull loop)
```

---

## Phase A — Redesign `Adapter` interface

**File:** `src/app/core/adapters/adapter.interface.ts`

### Changes

1. Add `FileEntry` type
2. Add `WatchEvent` type
3. Replace blob-oriented `upload/download` with text-oriented `read`/`write`
4. Add `list`
5. Make `watch` optional

### New types

```typescript
export interface WorkspacePickResult {
	path: string;
	name: string;
}

export interface FileEntry {
	path: string;
	name: string;
	isDirectory: boolean;
	lastModified: number; // Unix timestamp ms, 0 if unknown
}

export interface WatchEvent {
	type: 'create' | 'modify' | 'delete';
	path: string;
}
```

### New Adapter interface

Old methods removed: `upload`, `download`
Old methods kept: `pickWorkspaceFolder`

```typescript
export interface Adapter {
	readonly id: string;
	readonly isLocal: boolean;

	isAvailable(): boolean;
	pickWorkspaceFolder(): Promise<WorkspacePickResult | null>;

	read(path: string, root?: string): Promise<string>;
	write(path: string, content: string, root?: string): Promise<void>;
	delete(path: string, root?: string): Promise<void>;
	list(path: string, root?: string): Promise<FileEntry[]>;
	watch?(
		callback: (events: WatchEvent[]) => void,
		root?: string,
	): Promise<() => void>;
}
```

### Config types — unchanged

`TauriFsAdapterConfig`, `BrowserFsAdapterConfig`, `AdapterConfig`, `AdapterId` stay as-is.

---

## Phase B — Update `AdaptersManager`

**File:** `src/app/core/adapters/manager.ts`

### New method signatures

```typescript
@Injectable({ providedIn: 'root' })
export class AdaptersManager {
	private readonly strategies: Adapter[] = inject(ADAPTERS);

	getAdaptersByIds(ids: string[]): Adapter[];
	getWorkspacePickerAdapter(): Adapter | null;

	async write(
		path: string,
		content: string,
		adapterIds: string[],
		root?: string,
	): Promise<void>;
	async read(path: string, adapterId: string, root?: string): Promise<string>;
	async list(
		path: string,
		adapterIds: string[],
		root?: string,
	): Promise<FileEntry[][]>;
	async deleteFile(
		path: string,
		adapterIds: string[],
		root?: string,
	): Promise<void>;
	async forEachAdapter(
		adapterIds: string[],
		fn: (adapter: Adapter, root?: string) => Promise<void>,
	): Promise<void>;
}
```

**Design note:** `read` takes a single `adapterId` (we read from one source, not all). `write`/`list`/`deleteFile` fan out across all given IDs. `forEachAdapter` is a utility that calls a callback for each adapter, passing the resolved root from `WorkspaceService.getAdapterConfig()`.

### Remove old methods

`upload`, `download`, `delete` (the blob versions) — removed.

---

## Phase C — Implement `TauriFsAdapter`

**File:** `src/app/core/adapters/local/tauri-fs.adapter.ts`

### Dependencies

`@tauri-apps/plugin-fs` v2 API:

- `readTextFile(path)`
- `writeTextFile(path, content)`
- `mkdir(path, { recursive: true })`
- `readDir(path)`
- `remove(path)`

### Method implementations

```typescript
readonly id = 'tauri-fs';

async read(path: string, root?: string): Promise<string> {
	const resolved = this.resolve(root, path);
	return readTextFile(resolved);
}

async write(path: string, content: string, root?: string): Promise<void> {
	const resolved = this.resolve(root, path);
	const parent = resolved.split('/').slice(0, -1).join('/');
	await mkdir(parent, { recursive: true });
	await writeTextFile(resolved, content);
}

async delete(path: string, root?: string): Promise<void> {
	const resolved = this.resolve(root, path);
	await remove(resolved);
}

async list(path: string, root?: string): Promise<FileEntry[]> {
	const resolved = this.resolve(root, path);
	const entries = await readDir(resolved);
	return entries.map((e) => ({
		path: e.name ?? '',
		name: e.name ?? '',
		isDirectory: e.isDirectory ?? false,
		lastModified: e.mtime != null ? Number(e.mtime) * 1000 : 0,
	}));
}
```

**Edge cases:**

- `resolve()` joins `root + '/' + path`, handling leading/trailing slashes
- `write` creates parent dirs via `mkdir({ recursive: true })`
- `list` on non-existent dir returns `[]`
- `isAvailable()` — unchanged, checks `window.__TAURI__`

### `pickWorkspaceFolder()` — unchanged

---

## Phase D — Implement `BrowserFileSystemApiAdapter`

**File:** `src/app/core/adapters/local/browser-file-system-api.adapter.ts`

### Handle management

```typescript
export class BrowserFileSystemApiAdapter implements Adapter {
	readonly id = 'browser-file-system-api';
	readonly isLocal = true;

	/** In-memory handle registry: root-prefix → DirectoryHandle */
	private readonly handleRegistry = new Map<
		string,
		FileSystemDirectoryHandle
	>();

	/** Persist handle to IndexedDB after pickWorkspaceFolder() */
	private async persistHandle(
		root: string,
		handle: FileSystemDirectoryHandle,
	): Promise<void>;
	/** Restore handles from IndexedDB on construction */
	private async restoreHandles(): Promise<void>;
}
```

### Directory handle resolution

```typescript
private async resolveRoot(root?: string): Promise<FileSystemDirectoryHandle> {
	if (!root) throw new AdapterError('BrowserFsAdapter: root is required');
	const handle = this.handleRegistry.get(root);
	if (!handle) throw new AdapterError(`BrowserFsAdapter: no handle for root "${root}"`);
	return handle;
}
```

### File ops

```typescript
async read(path: string, root?: string): Promise<string> {
	const dir = await this.resolveRoot(root);
	const fileHandle = await dir.getFileHandle(path);
	const file = await fileHandle.getFile();
	return file.text();
}

async write(path: string, content: string, root?: string): Promise<void> {
	const dir = await this.resolveRoot(root);
	const fileHandle = await dir.getFileHandle(path, { create: true });
	const writable = await fileHandle.createWritable();
	await writable.write(content);
	await writable.close();
}

async delete(path: string, root?: string): Promise<void> {
	const dir = await this.resolveRoot(root);
	await dir.removeEntry(path);
}

async list(path: string, root?: string): Promise<FileEntry[]> {
	const dir = await this.resolveDir(path, root);
	const entries: FileEntry[] = [];
	for await (const [name, handle] of dir.entries()) {
		entries.push({
			name,
			path: path === '/' ? name : `${path}/${name}`,
			isDirectory: handle.kind === 'directory',
			lastModified: 0,
		});
	}
	return entries;
}
```

**Edge cases:**

- Catch `NotAllowedError` (user revoked permission) — re-request picker, return `[]` on failure
- `resolveDir` navigates into subdirectories via `getDirectoryHandle`
- `delete` catches `NotFoundError` silently

### `pickWorkspaceFolder()` — store handle + persist

```typescript
async pickWorkspaceFolder(): Promise<WorkspacePickResult | null> {
	const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
	const name = dirHandle.name || 'Workspace';
	const root = `browser:${name}`;
	this.handleRegistry.set(root, dirHandle);
	await this.persistHandle(root, dirHandle);
	return { path: root, name };
}
```

---

## Phase E — Update Tauri capabilities

**File:** `src-tauri/capabilities/default.json`

```json
{
	"permissions": [
		"core:default",
		"opener:default",
		"fs:default",
		"dialog:allow-open",
		"dialog:allow-save"
	]
}
```

**Check:** `fs:default` may already include write. If not, expand to:

```json
{
	"permissions": [
		"core:default",
		"opener:default",
		"dialog:allow-open",
		"fs:allow-read",
		"fs:allow-write",
		"fs:allow-exists",
		"fs:allow-mkdir",
		"fs:allow-remove",
		"fs:allow-read-dir",
		"fs:scope-app-recursive"
	]
}
```

---

## Phase F — Replace `dirty` with `pendingAdapters` on `VaultEntry`

**File:** `src/app/core/vault/store.ts`

### Schema change

```diff
- dirty: boolean;
+ pendingAdapters: string[];
```

### Database upgrade (v2 → v3)

The `dirty` index on the 'entries' object store is no longer needed. We add no new index but must handle the old data:

```typescript
// In open() — upgrade to version 3:
request.onupgradeneeded = () => {
	const db = request.result;
	if (e.oldVersion < 1) {
		/* create store + indexes */
	}
	if (e.oldVersion < 2) {
		/* add workspaceId index */
	}
	if (e.oldVersion < 3) {
		// Migrate old dirty:boolean → pendingAdapters:string[]
		const tx = request.transaction;
		const store = tx?.objectStore('entries');
		const cursor = store?.openCursor();
		// ... iterate and convert ...
	}
};
```

### New computed

```diff
- readonly dirtyEntries = computed(() =>
-   Array.from(this.entries().values()).filter((e) => e.dirty),
- );
+ readonly entriesNeedingSync = computed(() =>
+   Array.from(this.entries().values()).filter((e) => e.pendingAdapters.length > 0),
+ );
```

### Method changes

| Old                                              | New                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `createFile(path, content)` — sets `dirty: true` | Sets `pendingAdapters` to workspace's `activeSyncAdapters` at creation time                                                     |
| `updateFile(id, content)` — sets `dirty: true`   | Merges workspace's `activeSyncAdapters` into `pendingAdapters` (union, no dupes)                                                |
| `delete(id)` — sets `dirty: true, deleted: true` | Same merge approach                                                                                                             |
| `markClean(id)` — sets `dirty: false`            | **Removed**                                                                                                                     |
| —                                                | `markAdapterSynced(id, adapterId)` — removes `adapterId` from `pendingAdapters`                                                 |
| —                                                | `markAllPending(id, adapterIds)` — replaces `pendingAdapters` with given IDs (used by pull to spread imports to other adapters) |

### `markAdapterSynced` implementation

```typescript
async markAdapterSynced(id: string, adapterId: string): Promise<void> {
	const entry = this.entries().get(id);
	if (!entry) return;

	await this.put({
		...entry,
		pendingAdapters: entry.pendingAdapters.filter((a) => a !== adapterId),
	});
}
```

### `markAllPending` implementation

```typescript
async markAllPending(id: string, adapterIds: string[]): Promise<void> {
	const entry = this.entries().get(id);
	if (!entry) return;

	await this.put({
		...entry,
		pendingAdapters: [...new Set([...entry.pendingAdapters, ...adapterIds])],
	});
}
```

### `createFile` updated

```typescript
async createFile(path: string, content = '') {
	// ... same init logic ...
	const activeAdapters = this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];
	const entry: VaultEntry = {
		// ... same fields ...
		pendingAdapters: [...activeAdapters], // was: dirty: true
	};
	await this.put(entry);
}
```

### `updateFile` updated

```typescript
async updateFile(id: string, content: string) {
	const entry = this.entries().get(id);
	if (!entry) return;

	const activeAdapters = this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];
	const pendingAdapters = [...new Set([...entry.pendingAdapters, ...activeAdapters])];

	const updated: VaultEntry = {
		...entry,
		content,
		updatedAt: Date.now(),
		pendingAdapters, // was: dirty: true
		revision: entry.revision + 1,
	};
	await this.put(updated);
}
```

---

## Phase G — Rewrite `SyncEngineService` for push + pull

**File:** `src/app/core/sync/sync-engine.ts`

### Flow

```text
scheduleSync()
  └─ after 1s debounce → runSync()
       ├─ pushPhase()
       │    └─ for each active adapter:
       │         ├─ find entries where pendingAdapters.includes(adapter.id)
       │         ├─ for each entry: write to adapter
       │         └─ call vault.markAdapterSynced(entry.id, adapter.id)
       └─ pullPhase()
            └─ for each active adapter:
                 ├─ list remote files at base path
                 ├─ build local path index (via vault.files())
                 ├─ for each remote file NEW to local:
                 │    ├─ read content from adapter
                 │    ├─ call vault.createFile(path, content) — this populates pendingAdapters
                 │    └─ call vault.markAdapterSynced(newEntry.id, adapter.id)
                 │       (the source adapter is already in sync; other adapters still pending)
                 └─ (future: detect deletes, detect modifications)
```

### Push loop

```typescript
private async pushPhase(adapters: { adapter: Adapter; root?: string }[]): Promise<void> {
	const entries = this.vault.entriesNeedingSync();

	for (const { adapter, root } of adapters) {
		const pending = entries.filter((e) => e.pendingAdapters.includes(adapter.id));
		if (pending.length === 0) continue;

		for (const entry of pending) {
			try {
				if (entry.deleted) {
					await adapter.delete(entry.path, root);
				} else {
					await adapter.write(entry.path, entry.content ?? '', root);
				}
				await this.vault.markAdapterSynced(entry.id, adapter.id);
			} catch (err) {
				console.error(`[Sync] Push failed for ${entry.path} on ${adapter.id}:`, err);
				// Don't mark synced — will retry next cycle
			}
		}
	}
}
```

### Pull loop

```typescript
private async pullPhase(adapters: { adapter: Adapter; root?: string }[]): Promise<void> {
	const activeIds = this.workspaceService.activeWorkspace()?.activeSyncAdapters ?? [];
	const otherAdapterIds = activeIds; // all adapters except the pulling one will receive spreads

	for (const { adapter, root } of adapters) {
		try {
			const remoteFiles = (await adapter.list('/', root))
				.filter((e) => !e.isDirectory);

			const localByPath = new Map<string, VaultEntry>();
			for (const f of this.vault.files()) {
				localByPath.set(f.path, f);
			}

			for (const rf of remoteFiles) {
				if (localByPath.has(rf.path)) continue; // already known

				// NEW remote file — import
				const content = await adapter.read(rf.path, root);
				await this.vault.createFile(rf.path, content);

				// The createFile sets pendingAdapters to all active adapters.
				// Since we just synced with this adapter, mark it done here.
				const created = this.vault.getByPath(rf.path);
				if (created) {
					await this.vault.markAdapterSynced(created.id, adapter.id);
				}
			}
		} catch (err) {
			console.error(`[Sync] Pull failed for adapter ${adapter.id}:`, err);
		}
	}
}
```

### Sync orchestration

```typescript
constructor() {
	// Auto-push on dirty entries
	effect(() => {
		const needingSync = this.vault.entriesNeedingSync();
		if (needingSync.length > 0) void this.scheduleSync();
	});

	// Pull on workspace activation
	effect(() => {
		const ws = this.workspaceService.activeWorkspace();
		if (ws) void this.forcePull();
	});
}
```

### Public API

```typescript
async scheduleSync(): Promise<void>;
async forcePull(): Promise<void>;
```

---

## Phase H — Update consumers of old API

### Files that need updating

| File                            | What changed                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `sync-engine.ts`                | Uses `entriesNeedingSync()` instead of `dirtyEntries()`, calls `markAdapterSynced` instead of `markClean` |
| `sidebar.component.ts`          | Uses `vault.files` / `vault.folders` — unchanged (they filter `deleted` already)                          |
| `editor.html` / `editor.ts`     | Will in future call `vault.updateFile()` — unchanged signature                                            |
| `empty.ts`                      | Calls `vault.createFile()` — unchanged signature                                                          |
| `workspace-wizard.component.ts` | `completeWizard()` — no change needed                                                                     |
| `workspace.service.ts`          | `pickAndAddWorkspace()` — no change needed                                                                |

**No other consumer references `dirty` directly.**

---

## Dependency graph

```text
adapter.interface.ts ───── Phase A
    ├── tauri-fs.adapter.ts       ── Phase C
    ├── browser-fs.adapter.ts     ── Phase D
    ├── token.ts                  ── unchanged
    └── manager.ts                ── Phase B
            │
    vault/store.ts ─────────────── Phase F
            │
    sync/sync-engine.ts ───────── Phase G
            │
    capabilities/default.json ─── Phase E
```

---

## Edge cases & mitigations

| Edge case                                                    | Mitigation                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adapter A write succeeds, adapter B write fails**          | Don't call `markAdapterSynced` for B. A is already synced. Next cycle only retries B.                                                                                                                                             |
| **No active adapters on file creation**                      | `pendingAdapters = []` → entry is "fully synced" (locally only). When an adapter is later added, it won't retroactively sync existing files. _Fix:_ add a "sync now" button or re-scan on adapter config change.                  |
| **User unchecks an adapter in settings**                     | `activeSyncAdapters` changes. Existing entries may still have that adapter in `pendingAdapters` — they'll never be synced to it. _Fix:_ on adapter removal, iterate entries and filter out the removed ID from `pendingAdapters`. |
| **Browser FS API user revokes permission**                   | `write()` throws `NotAllowedError`. Sync catches it, doesn't mark synced. Next cycle retries but will fail again. UI should show a warning.                                                                                       |
| **Tauri `readDir` on non-existent path**                     | Returns `[]` — handled by returning empty array.                                                                                                                                                                                  |
| **Pull finds 10k+ new files**                                | Sequential read/import may be slow. For MVP this is acceptable; future: batch with `Promise.allSettled` and concurrency cap.                                                                                                      |
| **File created while no network (cloud adapter in pending)** | `pendingAdapters` includes cloud adapter. Next sync cycle (when online) will push it. No data loss.                                                                                                                               |
| **Simultaneous push + pull for same path**                   | Push-then-pull is sequential per cycle. Pull would re-detect the file it just wrote as "local" (matched by path) and skip it. No conflicts.                                                                                       |

---

## What this plan does NOT include (scoped out)

| Feature                                                   | Reason                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Content-level conflict detection                          | Deferred to later phase — for now, last-write-wins via `write()`                             |
| `watch()` implementation                                  | Interface is optional, stubs return `() => {}`                                               |
| Timestamp/hash comparison in pull                         | Pull only detects **new** files by path. Modification detection needs `sync_metadata` store. |
| Retroactive sync when adapter is added                    | Avoids complexity. User re-creates or uses "sync now" button.                                |
| IndexedDB handle persistence for browser                  | Handles kept in memory only. User re-picks on reload.                                        |
| Operation journal integration                             | Separate plan.                                                                               |
| Archive / Trash routes                                    | Separate concern.                                                                            |
| Adapter removal cleanup (`pendingAdapters` stale entries) | Minor — doesn't cause errors, just unused array elements.                                    |

---

## Verification

After implementation, the following scenarios must work:

1. **Create note** → `pendingAdapters` = all active adapters → each adapter gets a `write()` call → adapter removed from `pendingAdapters` → eventually `pendingAdapters = []`
2. **Pull on activation** → remote files not in IndexedDB get imported → `pendingAdapters` = all adapters except the one they were pulled from → next push sends them to remaining adapters
3. **Two adapters active** → note created → adapter A write succeeds → `pendingAdapters` still includes B → next cycle pushes to B → fully synced
4. **No adapters active** → note created → `pendingAdapters = []` → no sync attempted
5. **Edit note** → all active adapters re-added to `pendingAdapters` (union) → push cycle re-sends to all
6. **Delete note** → same flow as edit but `deleted: true` → push calls `adapter.delete()`

---

## Implementation order

1. Write Playwright E2E tests (CURRENT TASK — before any code changes)
2. Phase A: Adapter interface
3. Phase B: AdaptersManager
4. Phase C: TauriFsAdapter
5. Phase D: BrowserFsApiAdapter
6. Phase E: Tauri capabilities
7. Phase F: VaultStore `pendingAdapters`
8. Phase G: SyncEngineService push+pull
9. Phase H: Update consumers, remove `markClean`
