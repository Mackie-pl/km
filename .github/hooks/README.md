# Hooks

This directory contains automation hooks that enforce development practices throughout the workflow.

## Hook Types

Hooks are JSON files that define triggers, conditions, and actions for various events in the development lifecycle.

### Trigger Events

- **PreStop**: Fires before the agent completes work and hands off to the user
- **PreToolUse**: Fires before running any terminal command or tool
- **SessionStart**: Fires at the beginning of a session
- **TaskComplete**: Fires when marking a task as complete

### Hook Schema

```json
{
	"name": "hook-name",
	"description": "What this hook does",
	"trigger": "PreStop|PreToolUse|SessionStart|TaskComplete",
	"conditions": [
		{
			"type": "file-modified|branch|env-var",
			"patterns": ["glob patterns"]
		}
	],
	"actions": [
		{
			"type": "run-command|check-status|inject-context",
			"command": "command to run",
			"onFailure": "block|warn|log"
		}
	],
	"metadata": {
		"created": "YYYY-MM-DD",
		"version": "1.0",
		"priority": "low|medium|high"
	}
}
```

## Available Hooks

### `verify-before-completion.json`

**Trigger**: PreStop  
**Purpose**: Ensures all features pass build, lint, and jscpd checks before completing work

**Conditions**:

- Triggers if TypeScript, HTML, or SCSS files in `src/` were modified

**Actions**:

- Runs `pnpm run verify` which chains: `build` → `lint` → `jscpd`
- **On Failure**: Blocks completion and reports which checks failed

**Impact**: Prevents pushing incomplete or broken features to the user.

---

## Creating New Hooks

1. Create a new JSON file in `.github/hooks/`
2. Define the trigger event and conditions
3. List the actions to perform
4. Document in this README under "Available Hooks"

## Testing Hooks

To validate a hook works:

```bash
# Modify a file to trigger conditions
pnpm run verify  # Test the specific command

# Check hook file syntax
node -e "console.log(JSON.stringify(require('./.github/hooks/verify-before-completion.json'), null, 2))"
```
