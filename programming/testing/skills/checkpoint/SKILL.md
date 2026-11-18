---
name: checkpoint
description: Create, verify, or list a checkpoint. Creating one runs this repository's tests and appends .cursor/checkpoints.log. Invoke only when the user asks.
disable-model-invocation: true
---

# Checkpoint Command

Create or verify a checkpoint in your workflow.

## Usage

`/checkpoint [create|verify|list] [name]`

## Cursor adaptation

- Record checkpoints in the current repository at `.cursor/checkpoints.log`. Do not write `.claude/checkpoints.log`.
- Before `create` or `verify`, run this repository's real tests. `/verify quick` only covers build and types. When that mode skips them and stops, run the same commands as `/verify full`.
- Append one line, using local time: `YYYY-MM-DD-HH:MM | <name> | <short SHA>`. Do not require bash.
- On `verify`, compare files and the test commands that just ran. Omit coverage and build when this repository does not produce them.

## Create Checkpoint

When creating a checkpoint:

1. Run this repository's real tests, as above
2. Create a git stash or commit with the checkpoint name
3. Append one line to `.cursor/checkpoints.log`:

`YYYY-MM-DD-HH:MM | <name> | <short SHA>`

4. Report checkpoint created

## Verify Checkpoint

When verifying against a checkpoint:

1. Read checkpoint from log
2. Compare current state to checkpoint:
   - Files added since checkpoint
   - Files modified since checkpoint
   - Test results now vs then, from the commands this repository runs
   - Coverage now vs then, only when a coverage report exists

3. Report:
```
CHECKPOINT COMPARISON: $NAME
============================
Files changed: X
Tests: <results of the commands that ran>
Coverage: <only when a coverage report exists>
Build: <only when this repository has a build>
```

## List Checkpoints

Show all checkpoints with:
- Name
- Timestamp
- Git SHA
- Status (current, behind, ahead)

## Workflow

Typical checkpoint flow:

```
[Start] --> /checkpoint create "feature-start"
   |
[Implement] --> /checkpoint create "core-done"
   |
[Test] --> /checkpoint verify "core-done"
   |
[Refactor] --> /checkpoint create "refactor-done"
   |
[PR] --> /checkpoint verify "feature-start"
```

## Arguments

$ARGUMENTS:
- `create <name>` - Create named checkpoint
- `verify <name>` - Verify against named checkpoint
- `list` - Show all checkpoints
- `clear` - Remove old checkpoints (keeps last 5)
