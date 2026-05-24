# km-test — Minimalistic Note App

A cross-platform, minimalistic note-taking app built with Angular + Tauri 2.0.

**Philosophy:** Filesystem-native, local-first. Real markdown files are canonical — IndexedDB is acceleration only.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Rust](https://www.rust-lang.org/) (only for Tauri desktop builds)

## Commands

| Command               | Description                                |
| --------------------- | ------------------------------------------ |
| `pnpm start`          | Start dev server (`ng serve` on port 1420) |
| `pnpm run build`      | Production build                           |
| `pnpm run lint`       | ESLint check                               |
| `pnpm run jscpd`      | Copy-paste detection                       |
| `pnpm run verify`     | Build + lint + jscpd (CI gate)             |
| `pnpm run e2e`        | Run Playwright E2E tests (headless)        |
| `pnpm run e2e:headed` | Run Playwright E2E tests (visible browser) |
| `pnpm tauri dev`      | Start Tauri desktop app in dev mode        |

## Project Structure

```
src/
  app/
    core/          — Data layer (vault, sync, adapters, journal)
    ui/            — Angular components (sidebar, editor, settings, wizard)
  main.ts          — Bootstrap + E2E test hook (`__KM_TEST__`)
  styles.scss      — Tailwind v4 + Taiga UI theme
e2e/
  specs/           — Playwright E2E tests (sync, rename, smoke)
  fixtures/        — Test helpers + Tauri mock
src-tauri/         — Rust backend (Tauri 2.0)
```

## Tech Stack

- **Frontend:** Angular 21 (standalone components, Signals)
- **Styling:** Tailwind CSS v4 (CSS-first config)
- **UI Components:** Taiga UI v5 (dropdowns, dialogs)
- **Icons:** Lucide Angular
- **Rich Text:** TipTap editor
- **Desktop/Mobile:** Tauri 2.0 (Rust)
- **Testing:** Playwright (E2E)

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) + [Angular Language Service](https://marketplace.visualstudio.com/items?itemName=Angular.ng-template).
