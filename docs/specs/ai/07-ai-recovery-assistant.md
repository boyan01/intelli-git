# Spec: AI Recovery Assistant

## Goal

AI Recovery Assistant 在 Git 操作失败后解释当前状态、失败原因和下一步 recovery actions。它面向真实 Git failure，不是聊天问答。它应该帮助用户从 rebase conflict、push rejection、temporary stash restore failure、detached HEAD 等状态恢复。

## Why It Matters

Git 工具最需要信任的时刻就是失败时。只显示 raw git error 会让用户回 terminal。Recovery Assistant 能把 Intelli Git 的工作流保护能力做完整。

## Trigger Points

- push rejected behind
- rebase / merge conflict
- cherry-pick / revert conflict
- temporary stash restore failed
- checkout blocked
- detached HEAD after checkout commit
- commit failed due to hooks
- AI provider failure that affects commit generation

## Main UI

```text
Recovery Assistant
+------------------------------------------------------------------+
| Operation: Pull with rebase                                       |
| Status: Completed fetch, conflict while restoring local changes   |
+------------------------------------------------------------------+
| What happened                                                     |
| Intelli Git saved your local changes to a temporary stash, ran     |
| pull --rebase, then hit conflicts while restoring the stash.       |
+------------------------------------------------------------------+
| Current state                                                     |
| - Rebase: none                                                    |
| - Working tree: conflicts in 2 files                              |
| - Temporary stash kept: Intelli Git pull --rebase 2026-05-12...    |
+------------------------------------------------------------------+
| Recommended actions                                               |
| [Open Conflicts] [Open Stash] [Mark Resolved] [Abort Guidance]     |
+------------------------------------------------------------------+
```

## Functional Requirements

- Capture original operation name and error.
- Preserve raw error details behind an expandable section.
- Inspect current Git state after failure.
- Explain what happened in product language.
- Provide concrete actions:
  - open conflicted files
  - open Git Log
  - open Stash tab
  - continue rebase / abort rebase
  - fetch / pull / push
  - copy diagnostic
- Do not hide unknown errors. Unknown failures must include original error and stack/log reference when available.

## Recovery States

### Push Rejected Behind

```text
Problem:
  Remote has commits you do not have.

Actions:
  [Fetch] [Open Git Log] [Update Branch] [Push with Lease after Review]
```

### Rebase Conflict

```text
Problem:
  Rebase stopped because files have conflicts.

Actions:
  [Open Conflicts] [Continue Rebase] [Abort Rebase]
```

### Temporary Stash Kept

```text
Problem:
  Operation completed, but local changes could not be restored cleanly.

Actions:
  [Open Stash] [Show Recovery Instructions] [Copy Stash Name]
```

### Detached HEAD

```text
Problem:
  You checked out a commit directly and are now detached.

Actions:
  [Create Branch Here] [Checkout Previous Branch] [Open Git Log]
```

## AI Role

Deterministic state detection should happen first. AI should only explain and prioritize actions based on:

- operation
- raw error
- Git status summary
- repository state
- known Intelli Git temporary stash naming
- current workflow mode

AI must not invent commands that are not available in the product UI.

## Result Model

```ts
interface RecoveryAssistantState {
  operation: string;
  status: 'blocked' | 'conflict' | 'recovery-needed' | 'unknown';
  explanation: string;
  rawError: string;
  gitState: {
    rebaseStatus?: 'none' | 'interactive' | 'merging';
    conflictedFiles: string[];
    temporaryStashes: string[];
    branch?: string;
    ahead?: number;
    behind?: number;
  };
  actions: Array<{
    label: string;
    command: string;
    kind: 'primary' | 'secondary' | 'danger';
  }>;
}
```

## Non-Goals

- Do not auto-resolve conflicts.
- Do not auto-run destructive recovery.
- Do not replace raw Git diagnostics.
- Do not classify unknown errors as safe.

## Implementation Notes

- Start by replacing string sentinel push errors with structured result codes.
- Add a reusable recovery panel component in webview.
- Native command errors can open the recovery panel with structured state.
- For command palette operations, use VS Code notification with `Open Recovery` action.

## Acceptance Criteria

- Push rejection shows actionable recovery instead of raw sentinel text.
- Temporary stash failure shows stash name.
- Conflict state shows conflicted files.
- Raw error remains available.
- Unknown errors are preserved and logged.

