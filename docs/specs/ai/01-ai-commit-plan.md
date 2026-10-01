# Spec: AI Commit Plan

## Goal

AI Commit Plan 帮用户把当前工作区或 active changelist 拆成一组合理 commits。它不是自动提交，而是生成一个可编辑的 commit plan：每个 planned commit 包含 scope、文件、hunks、message、reason 和风险提示。

## Why It Matters

Intelli Git 的核心差异化是 changelist 和 hunk-level commit precision。AI Commit Plan 可以把这个能力产品化：用户不用手动思考“这些改动应该怎么拆”，但仍然保留最终控制权。

## Entry Points

- `Commit View` toolbar: `AI Plan`
- commit form split button: `Plan Commits with AI`
- changes mode changelist root context menu: `Plan Commits for Changelist`
- staged mode staged root context menu: `Plan Commits for Staged Changes`

## Scope Rules

- `changes` mode: 默认只分析 active changelist。用户可以显式选择 include untracked。
- `staged` mode: 默认分析 staged files。若没有 staged files，可提示用户改用 unstaged changes 或 stage tracked changes。
- inactive changes 默认排除。
- conflict files 默认排除，并在 plan header 中提示必须先解决 conflicts。
- untracked files 默认作为独立 candidate group，避免混入已有 tracked changes。

## User Flow

```text
User clicks AI Plan
        |
        v
Collect current scoped diff
        |
        v
AI proposes commit groups
        |
        v
User edits groups / messages / scope
        |
        v
User chooses:
  [Apply as Changelists] [Commit First] [Commit All With Confirmation]
```

## Main UI

```text
AI Commit Plan
+------------------------------------------------------------------+
| Scope: Active Changelist "Changes"              Provider: Copilot |
| Files: 8   Hunks: 17   Excluded: 1 conflict, 2 inactive           |
+------------------------------------------------------------------+
| Commit 1                                                          |
| Subject: Improve AI provider setup flow                           |
| Reason: Provider setup and API key storage belong together.       |
|                                                                  |
| Files                                                            |
| [x] apps/extension/src/commands/aiCommands.ts                     |
| [x] apps/extension/src/utils/aiSecrets.ts                         |
| [ ] packages/shared/l10n/bundle.l10n.json                         |
|                                                                  |
| [Edit Message] [Move Files...] [Split] [Remove]                   |
+------------------------------------------------------------------+
| Commit 2                                                          |
| Subject: Add commit view AI entry points                          |
| Reason: UI entry points should be separate from provider setup.   |
|                                                                  |
| Files                                                            |
| [x] apps/webview-ui/src/components/commit/CommitForm.tsx          |
| [x] apps/webview-ui/src/components/commit/CommitToolbar.tsx       |
+------------------------------------------------------------------+
| [Regenerate] [Apply as Changelists] [Commit First...] [Close]     |
+------------------------------------------------------------------+
```

## Functional Requirements

- Generate 1 to N planned commits.
- Each planned commit must include:
  - `subject`
  - optional `body`
  - `reason`
  - file list
  - hunk list when hunk data is available
  - warnings, such as `contains generated file`, `missing l10n`, `test not found`
- User can edit subject and body inline.
- User can move files between planned commits.
- If hunk-level assignment is available, user can move hunks through existing editor hunk actions instead of rendering hunk children in the tree.
- User can apply planned commits as changelists in `changes` mode.
- User can commit one planned commit at a time with preview.
- User can regenerate while preserving manual edits only when explicitly requested.

## Non-Goals

- Do not silently create commits.
- Do not create hunk child nodes in the commit tree.
- Do not automatically push after creating planned commits.
- Do not infer issue tracker metadata unless an issue reference is already present in branch name, commit message, or user instruction.

## AI Input

The request should include:

- current mode: `staged` or `changes`
- selected changelist id/name when applicable
- files and status codes
- hunk summaries and diff snippets, bounded by size
- existing commit message draft
- current branch and target branch if known
- user instruction

The request should not include:

- entire repository content
- inactive changes unless explicitly included
- secrets or binary files

## AI Output Contract

```ts
interface AiCommitPlan {
  summary: string;
  excluded: Array<{ path: string; reason: string }>;
  commits: Array<{
    id: string;
    subject: string;
    body?: string;
    reason: string;
    files: Array<{ path: string; hunkIds?: string[] }>;
    warnings: string[];
  }>;
}
```

## Validation

- Every planned file must exist in the scoped diff.
- A file or hunk cannot be assigned to two planned commits unless the split is hunk-level and explicit.
- Empty commit groups are invalid.
- Commit subject must be non-empty.
- If output references paths outside scope, mark output invalid and show regeneration prompt.

## Implementation Notes

- Start with file-level plan first; add hunk-level plan only after the file-level flow is stable.
- Use extension-side service for plan validation because it owns changelist and inactive state.
- Webview owns editing UI and dispatches apply/commit actions.
- Reuse existing `ChangelistStateService` when applying plan as changelists.
- For `Commit First`, use existing commit execution path and temporary index behavior.

## Acceptance Criteria

- In `changes` mode, AI plan only includes active changelist by default.
- In `staged` mode, AI plan only includes staged files by default.
- User can edit plan before any Git mutation occurs.
- Applying as changelists preserves exactly one active changelist.
- Commit execution shows exact files/message before creating a commit.
- Conflicts and inactive changes are visible in excluded summary.
