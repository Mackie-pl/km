# Plan: 3-Step Workspace Creation Wizard

## Status: IMPLEMENTED (May 18, 2026)

> This plan was implemented. Notes below reflect the **actual build** — see deviations from original plan at the bottom.

## Summary

Replace the current single-button "Choose Folder" workspace creation with a 3-step wizard that handles both folder-backed and standalone workspaces, and provides a stub for future remote adapter selection.

---

## 1. New Component: `WorkspaceWizardComponent`

**File:** `src/app/ui/pages/workspace-config/workspace-wizard.component.ts`

A standalone component with **component-local signals** for wizard state. No dedicated service — state is ephemeral and disposed when the route is navigated away from.

### State Shape

```typescript
type WizardStep = 1 | 2 | 3;
type CreationMode = 'folder' | 'standalone'; // NOTE: 'standalone' not 'manual'
```

All fields are `signal<>` — no RxJS, no service.

### Step 1 — Mode Selection

**UI:** Two large option cards side-by-side:

| Card | Behaviour |
|---|---|
| **From Folder** | Enabled if `AdaptersManager.getWorkspacePickerAdapter()` returns non-null. Clicking sets `mode = 'folder'` → advances to Step 2. |
| **Standalone** | Always enabled. Clicking sets `mode = 'standalone'` → advances to Step 2. |

**No local adapter available:** The "From Folder" card is rendered with `opacity-50 cursor-not-allowed` and a small message: *"Folder picker not available on this device."* The card's click handler is a no-op.

**Footer:** Cancel button (navigates back to `/workspace`).

### Step 2 — Name / Folder Selection

**Two variants depending on `mode`:**

#### Folder mode
- A dashed-border "Browse Folders" button that calls `adapter.pickWorkspaceFolder()` on the available local adapter.
- Once a folder is selected, display the folder name and path.
- A "Continue →" button (disabled until folder is picked).
- Back button → Step 1.

#### Standalone mode
- A standard `<input>` for the workspace name (NOT `TuiInput` — plain HTML with Tailwind styling).
- A "Continue →" button (disabled while name is empty).
- Back button → Step 1.

**Both variants:** Cancel button.

### Step 3 — Remote Adapter Selection

**UI:**
- Info banner: *"Sync adapters let you keep your notes in sync across devices. You can configure these later in workspace settings."*
- List of available remote adapters:
  - **Google Drive** — disabled card with "Coming soon" badge (plain `<span>`, not `TuiBadge`)
- Action buttons:
  - "Create Workspace" — finalises creation, navigates to `/`
  - "← Back" → Step 2
  - Cancel

### Completion Logic

On create:
1. Generates ID: `ws-${Date.now()}`
2. If folder mode + folder picked: sets `activeSyncAdapters` to `[pickerAdapter.id]`
3. Calls `workspaceService.addWorkspace(workspace)` then `workspaceService.activateWorkspace(id)`
4. Navigates to `/`

---

## 2. Files Created

| File | Purpose |
|---|---|
| `src/app/ui/pages/workspace-config/workspace-wizard.component.ts` | Component class with signals, step logic, Lucide icons |
| `src/app/ui/pages/workspace-config/workspace-wizard.component.html` | Template with `@if (step() === 1/2/3)` blocks |
| `src/app/ui/pages/workspace-config/workspace-wizard.component.scss` | Placeholder (`:host { display: block; }`) |

---

## 3. Files Modified

### `src/app/core/services/workspace.service.ts`

`addWorkspaceWithoutLocalAdapter()` now takes `name: string` parameter — removed `window.prompt`.

### `src/app/ui/pages/workspace-config/workspace-config.ts` + `.html`

Replaced `pickAndAddWorkspace()` with `openWizard()` that navigates to `/workspace/new`. Button text changed to "Add Workspace".

### `src/app/ui/app.component.ts`

`openWorkspacePicker()` navigates to `/workspace/new` (route-only, no dialog). Added `isOnWizardRoute()` to keep router outlet visible during wizard.

### `src/app/ui/app.component.html`

No-workspace overlay hidden when on wizard route. Shell (sidebar + header) visible for wizard too.

### `src/app/app.routes.ts`

Added `/workspace/new` → `WorkspaceWizardComponent`.

---

## 4. Deviations from Original Plan

| Original Plan | Actual Implementation | Rationale |
|---|---|---|
| Hybrid dialog/route (desktop dialog, mobile route) | **Route-only** everywhere | Dialog lifecycle management was fragile (missing `TuiDialogContext` injection); routes are simpler and work universally |
| `TuiInput` for name input | **Plain `<input>` with Tailwind classes** | Matches the minimalistic aesthetic; avoids adding Taiga dependency just for one text field |
| `TuiBadge` for "Coming soon" | **Plain `<span>` with Tailwind classes** | Same reasoning — avoids extra Taiga import |
| Mode name: `'manual'` | **`'standalone'`** | More descriptive of what it is |
| No folder adapter association | **`activeSyncAdapters` set to `[pickerAdapter.id]`** | Better UX — the folder workspace is immediately linked to its adapter |
| `@lucide/angular` used for all icons | **Implemented correctly** — `LucideFolder`, `LucideStickyNote`, `LucidePlus`, `LucideCloud` | — |

---

## 5. Integration Points

```
NoWorkspaceComponent          WorkspaceConfig Page
       │                             │
       │ pickWorkspace.emit()        │ "Add Workspace" button
       ▼                             ▼
  AppComponent.openWorkspacePicker()  │
       │                             │
       └──────────┬──────────────────┘
                  ▼
     WorkspaceWizardComponent (route: /workspace/new — same on all platforms)
```

---

## 6. What This Plan Does NOT Cover

These are deferred to the UX discussion:

- Workspace name collision detection
- Error state if folder picker is cancelled mid-flow
- What happens to the wizard state if the user closes the browser tab
- Remote adapter configuration UI (beyond the disabled stub)
- Folder adapter association (linking the workspace to its local adapter)
