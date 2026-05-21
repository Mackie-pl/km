---
description: 'Post-session retrospective: analyze the last coding session for waste, errors, and improvement opportunities. Use after completing a task to close the feedback loop.'
name: 'Session Review'
argument-hint: 'optional focus area (e.g., tool usage, error patterns, rework)'
agent: 'reflection-agent'
---

Run a focused post-session retrospective. The user may specify a focus area — if not, cover all categories broadly.

## Instructions

1. Query the session store for the last few sessions using `session_store_sql`.
2. Read the current customization files (`docs/AGENTS.md`, `.github/agents/*.agent.md`, `.github/copilot-instructions.md`, and any `.prompt.md`/`SKILL.md` files).
3. Analyze the session data against the current customizations.

## Analysis Checklist

For **each** of the following categories that is relevant (or all if no focus given), flag issues:

### Tool Waste

- Were tools called unnecessarily (e.g., reading the same file repeatedly)?
- Were tools with no results called (e.g., searches that returned nothing)?
- Could tool restrictions be tightened?

### Rework & Errors

- Were there edits that had to be immediately corrected?
- Did build/lint errors repeat across multiple turns?
- Were there TypeScript errors that a type guard or stricter pattern could have prevented?

### Context Waste

- Were large files read multiple times when caching or smaller reads would suffice?
- Are `applyTo` patterns too broad, injecting irrelevant instructions?

### Instruction Gaps

- Did the agent make a mistake that a new instruction or memory could prevent next time?
- Were project conventions violated (e.g., `any` types, magic strings, NgModules)?

### Discoverability

- Are agent descriptions missing keywords that would have helped subagent delegation?
- Are any prompts/skills never used?

## Output

Return a concise report with:

```markdown
## Session Review — {date}

### By the Numbers

- Sessions analyzed: {N}
- Total turns: {N}
- Key metrics: {edits, reads, searches, errors}

### Findings

1. **{Issue}** — {evidence} → {fix suggestion}

### Action Items

- [ ] {change to make} ({file})
- [ ] {change to make} ({file})
```

End with a single `vscode_askQuestions` call asking the user which action items to apply.
