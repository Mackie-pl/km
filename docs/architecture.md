# Architecture Overview — Filesystem-Native Local-First Knowledge App

## Stack

- Angular (signal-first)
- Tauri 2
- Tailwind
- Taiga UI
- IndexedDB
- Markdown files
- Offline-first
- Filesystem-native
- Local embeddings/vector search

---

# Core Philosophy

The application is NOT a database pretending to be files.

The application is:

```text
Filesystem-native software
with local acceleration layers
and pluggable synchronization adapters.
```

Real markdown files are canonical.

Everything else is:

- indexing
- caching
- synchronization
- acceleration
- semantic enhancement

Users must always be able to:

- open files directly
- use another editor
- sync with external tools
- inspect cloud storage manually
- keep ownership of data

No proprietary storage format.

---

# Core Principles

## 1. Filesystem is canonical

The canonical durable data is:

```text
real .md files
```

stored in:

- local filesystem
- Google Drive
- OneDrive
- Syncthing
- Git
- WebDAV
- S3-compatible storage

The app must NEVER require export to recover user data.

---

## 2. IndexedDB is acceleration layer only

IndexedDB is NOT the source of truth.

It exists for:

- fast startup
- reactive querying
- metadata cache
- embeddings
- search indexes
- backlinks
- UI state
- sync metadata
- operation journal

Everything in IndexedDB should be rebuildable from vault files.

---

## 3. Sync synchronizes FILES, not proprietary operations

Cloud providers store actual markdown files.

Adapters synchronize:

- file contents
- timestamps
- hashes
- metadata

NOT hidden application state.

This preserves:

- interoperability
- transparency
- portability
- user trust

---

## 4. Operations still exist internally

Operations are internal optimization tools.

They are used for:

- undo
- retries
- batching
- crash recovery
- async processing
- UI responsiveness

Operations are NOT the canonical replication protocol.

---

## 5. Local-first UX

The app must:

- work fully offline
- never block editing on cloud sync
- open instantly from local cache
- tolerate cloud failures
- tolerate adapter failures

Cloud is enhancement, NOT dependency.

---

# High-Level Architecture

```text
┌─────────────────────────────┐
│          Angular UI         │
│   Signals + Components      │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│         Vault Engine        │
│                             │
│ - business logic            │
│ - document lifecycle        │
│ - state orchestration       │
│ - conflict handling         │
│ - operation emission        │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│      Local Projection       │
│                             │
│ IndexedDB acceleration layer│
│                             │
│ - cache                     │
│ - search                    │
│ - embeddings                │
│ - metadata                  │
│ - backlinks                 │
│ - sync state                │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│         Sync Engine         │
│                             │
│ - reconciliation            │
│ - adapter orchestration     │
│ - retries                   │
│ - conflict detection        │
└──────┬─────────┬────────────┘
       │         │
       ▼         ▼

┌──────────────┐ ┌──────────────┐
│ Local FS     │ │ Cloud        │
│ Adapter      │ │ Adapters     │
└──────────────┘ └──────────────┘

       ▼
┌─────────────────────────────┐
│      Real Markdown Files    │
└─────────────────────────────┘
```

---

# Main Layers

## 1. UI Layer

Responsibilities:

- rendering
- editor interaction
- command dispatch
- reactive presentation

Technologies:

- Angular
- Signals
- Tailwind
- Taiga UI

UI must NEVER:

- manipulate IndexedDB directly
- contain sync logic
- contain filesystem logic

Correct flow:

```text
Component
  ↓
Vault Engine
  ↓
Services/Adapters
```

---

## 2. Vault Engine

The main application brain.

Responsibilities:

- note lifecycle
- move/rename/delete
- metadata
- conflict handling
- orchestration
- emitting local operations
- coordinating projections

Example API:

```ts
vault.createNote();
vault.rename();
vault.move();
vault.delete();
vault.open();
vault.applyExternalChanges();
```

Business logic belongs HERE.

Not in adapters.
Not in components.

---

## 3. Local Projection Layer

IndexedDB-backed acceleration layer.

Responsibilities:

- fast querying
- reactive state
- indexing
- embeddings
- search
- cached note content
- sync metadata

Projection is rebuildable from files.

---

## 4. Sync Engine

Responsible for:

- scanning adapters
- comparing states
- reconciliation
- retries
- conflict detection

Sync is:

- asynchronous
- eventual
- non-blocking

NOT transactional.

---

## 5. Storage Adapters

Adapters are intentionally dumb.

Responsibilities:

- reading files
- writing files
- listing files
- watching filesystem changes
- uploading/downloading files

Adapters must NOT:

- contain business rules
- resolve conflicts
- know UI state

Example adapters:

```text
LocalFsAdapter
TauriAdapter
AndroidSafAdapter
GoogleDriveAdapter
OneDriveAdapter
WebDAVAdapter
GitAdapter
```

Example interface:

```ts
interface StorageAdapter {
	list(path: string): Promise<FileEntry[]>;

	read(path: string): Promise<string>;

	write(path: string, content: string): Promise<void>;

	delete(path: string): Promise<void>;

	watch?(callback: (event) => void): Promise<void>;
}
```

---

# Sync Philosophy

## Filesystem-first synchronization

The sync engine compares:

- timestamps
- hashes
- file metadata
- file existence

Adapters synchronize REAL files.

NOT hidden databases.

---

## Startup flow

```text
1. Load IndexedDB projection
2. UI becomes usable instantly
3. Adapters scan sources
4. Differences detected
5. Reconciliation applied
6. Projection updated reactively
```

App must NEVER wait for cloud before becoming usable.

---

## Conflict handling

Preferred early strategy:

```text
note.md
note.conflict-deviceA.md
```

Human-readable filesystem-native conflicts.

Avoid opaque merge systems early.

---

# Recommended IndexedDB Stores

```text
vault
├── entries
├── sync_metadata
├── operation_journal
├── embeddings
├── search_index
├── backlinks
├── kv
└── blobs
```

---

# Operation Journal

Operation journal is INTERNAL ONLY.

Used for:

- undo
- retries
- batching
- crash recovery
- background processing

Example:

```json
{
	"type": "write_file",
	"path": "notes/test.md",
	"timestamp": 123456
}
```

Operations are ephemeral implementation details.

They are NOT canonical storage.

---

# Embeddings & Vector Search

Embeddings are local semantic acceleration structures.

They are rebuildable.

They are NOT canonical data.

---

## Uses

- semantic search
- related notes
- AI context retrieval
- smart backlinks
- local knowledge graph

---

## Pipeline

```text
Markdown Files
      ↓
Chunking
      ↓
Local embedding model
      ↓
Vector storage
      ↓
Semantic retrieval
```

---

## Preferred approach

Prefer:

- local embeddings
- WASM/WebGPU inference
- offline capability
- optional native acceleration later

Avoid:

- mandatory cloud AI
- opaque hosted vector DBs

---

# Search Architecture

Use hybrid search.

## Lexical search

Fast keyword search.

Possible implementations:

- IndexedDB indexes
- SQLite FTS later

---

## Semantic search

Embedding similarity retrieval.

---

## Combined ranking

```text
score =
  lexical_score +
  semantic_score +
  recency_score +
  backlink_score
```

---

# Architectural Principles

## Prefer:

- simple files
- rebuildable indexes
- eventual consistency
- adapter isolation
- local responsiveness
- human-readable state

---

## Avoid:

- hidden proprietary formats
- cloud dependency
- giant global stores
- synchronous sync assumptions
- filesystem abstraction leakage
- tightly coupled persistence

---

# Recommended Folder Structure

```text
src/app/
├── vault/
├── sync/
├── indexing/
├── embeddings/
├── editor/
├── platform/
├── adapters/
└── ui/
```

---

# AGENTS.md Guidance

Use:

- consistent vocabulary
- subsystem-level AGENTS.md files
- architecture-first instructions

Important repeated terms:

- Vault Engine
- Projection
- Adapter
- Canonical Files
- Local-first
- Filesystem-native

---

# Design Summary

The application is:

```text
Filesystem-native
Local-first
Projection-indexed
Adapter-based
Offline-capable
Event-assisted
Human-readable
Portable
```

The markdown vault is the durable protocol.

Everything else is acceleration, synchronization, or enhancement.
