# AGENTS.md

## Available Agents

### `plan-sceptic` — Senior Engineering Review Agent

**Location:** `.github/agents/plan-sceptic.agent.md`

A read-only review agent that acts as a sceptic senior engineer. Use it to:

- Review architecture decisions and design docs before implementation
- Evaluate proposed features for long-term maintainability risks
- Catch anti-patterns (global stores, tight coupling, premature abstraction)
- Demand clarification on underspecified requirements
- Verify alignment with project standards (type safety, local-first, filesystem-native)

**Invoke via:** `@plan-sceptic review this design for ...`

---

### `reflection-agent` — Continuous Improvement Agent

**Location:** `.github/agents/reflection.agent.md`

A meta-cognitive process engineer that analyzes past coding sessions to improve agent configurations. Use it to:

- Review session history for patterns of wasted tokens, rework, or repeated errors
- Optimize agent tool restrictions, descriptions, and instructions
- Identify gaps in guardrails (missing instructions that could prevent common mistakes)
- Diagnose why an agent underperformed or wasn't invoked when needed
- Propose and apply concrete improvements to `.agent.md`, `SKILL.md`, `.prompt.md`, and instruction files

**Invoke via:** `@reflection-agent review last session for improvement opportunities`

---

### `session-review` — Post-Session Retrospective Prompt

**Location:** `.github/prompts/session-review.prompt.md`

A slash-command prompt that runs a focused retrospective through the reflection-agent. Use it to:

- Analyze the last coding session for tool waste, rework, and context waste
- Identify instruction gaps and missing guardrails
- Close the feedback loop after completing a task

**Invoke via:** Type `/session-review` in chat, optionally with a focus area:

- `/session-review tool usage` — focus on tool waste
- `/session-review error patterns` — focus on rework and errors
- `/session-review` — all categories

---

## Architecture

This app is:

- filesystem-native
- local-first
- event-driven
- adapter-based

Markdown files are canonical.
IndexedDB is acceleration layer only.

Never tightly couple UI to persistence.

Use:
UI -> Vault Engine -> Operations -> Adapters

Never:
UI -> IndexedDB directly.

---

## Code Quality

**See [CODING_STANDARDS.md](./CODING_STANDARDS.md) — mandatory reference for type safety.**

- Never use `any`
- Use `unknown` minimally with quick type narrowing
- No magic strings/numbers — always use const objects or enum-like patterns
- Type guards at all API boundaries
- Error discrimination by code, not message

---

## Angular

- Use signals first
- Prefer standalone components
- Avoid RxJS unless truly needed
- Keep services domain-oriented

---

## Styling

- Tailwind first
- Taiga UI components preferred
- Minimalist UI
- Dense information layout
- Avoid excessive animations

---

## Storage

- Real markdown files are canonical
- IndexedDB is rebuildable cache/index
- Sync is asynchronous
- Prefer append-only operation journal

---

## AI Features

- Prefer local embeddings
- Offline-first inference
- Avoid cloud dependency assumptions

---

## Avoid

- giant global stores
- overengineered abstractions
- hidden proprietary formats
- synchronous sync assumptions

# Verification Protocol

Before you consider a coding task complete, you must adhere to the following rules:

1. Do not leave syntax or TypeScript errors.
2. Run `pnpm run verify` in the terminal.
3. If the command outputs any build, lint, or jscpd errors, you must analyze the errors and fix them automatically before concluding your response.
