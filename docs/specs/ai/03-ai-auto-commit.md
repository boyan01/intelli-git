# Spec: AI Auto Commit

## Goal

AI Auto Commit 在用户确认后自动创建 commit。它必须先展示 dry-run preview，清楚说明会提交哪些文件、使用什么 message、是否 amend、是否 push。默认不能直接执行。

## Product Positioning

不要把这个功能命名成不可控的 `Auto Commit Everything`。推荐命名：

- `AI Commit`
- `Commit with AI`
- `Create Commit from AI Plan`

产品语义是：AI 准备 commit，用户确认执行。

## Entry Points

- commit form split button: `AI Commit...`
- AI Commit Plan: `Commit First...`
- AI Pre-Commit Review: `Fix Message and Commit...`
- command palette: `Intelli Git: Commit Current Scope with AI`

## Main Flow

```text
User clicks AI Commit
        |
        v
AI generates message and commit preview
        |
        v
Pre-commit checks run
        |
        v
Dry-run preview
        |
        v
User confirms
        |
        v
Commit is created
        |
        v
Result shows commit hash and next actions
```

## Dry-Run Preview UI

```text
AI Commit Preview
+------------------------------------------------------------------+
| Mode: Changes                                                     |
| Scope: Active Changelist "Provider setup"                         |
| Files: 5   Hunks: 9   Excluded: 2 inactive                        |
+------------------------------------------------------------------+
| Commit message                                                    |
| Improve AI provider setup flow                                    |
|                                                                  |
| - Add guided provider configuration from the commit form.         |
| - Keep API keys in VS Code SecretStorage.                         |
| - Show provider-specific errors before commit generation.         |
+------------------------------------------------------------------+
| Files                                                            |
| [x] apps/extension/src/commands/aiCommands.ts                     |
| [x] apps/webview-ui/src/components/commit/CommitForm.tsx          |
| [x] packages/shared/l10n/bundle.l10n.json                         |
| [x] packages/shared/l10n/bundle.l10n.zh-cn.json                   |
+------------------------------------------------------------------+
| Checks                                                           |
| [pass] No conflict files                                          |
| [warn] No tests changed                                           |
+------------------------------------------------------------------+
| [Edit Message] [Review Again] [Create Commit] [Cancel]            |
+------------------------------------------------------------------+
```

## Functional Requirements

- Generate commit message when current message is empty.
- If current message is non-empty, ask whether to keep, rewrite, or append body.
- Show exact file/hunk scope before commit.
- Run lightweight preflight:
  - no conflicts
  - no inactive staged items
  - non-empty commit message
  - mode-specific commit scope is valid
- Support amend only if user explicitly enabled amend.
- Support `sign-off` if existing commit form option is selected.
- After commit, show result:
  - short hash
  - subject
  - files count
  - next actions: `Push`, `Open Git Log`, `Undo Commit` when safe

## Commit Scope Semantics

### Staged Mode

- Commit staged files only.
- If no staged files, offer:
  - `Stage selected tracked files`
  - `Switch to changes mode`
  - `Cancel`
- Do not auto-stage untracked files without preview.

### Changes Mode

- Commit active changelist only.
- Preserve other changelists and inactive changes.
- If active changelist is empty, show clean empty state.

## Push Behavior

AI Auto Commit should not push by default.

If user enables `Commit & Push`:

- show push target in preview
- require target confirmation when upstream is missing
- reuse Push tab target selection when available
- do not guess `origin/currentBranch` when repository has multiple remotes

## Non-Goals

- Do not automatically create PR.
- Do not run formatters or tests unless user explicitly chooses that option.
- Do not auto-stage unrelated unstaged changes in staged mode.
- Do not bypass commit hooks by default.

## AI Output Contract

```ts
interface AiAutoCommitPreview {
  message: {
    subject: string;
    body?: string;
  };
  scope: {
    mode: 'staged' | 'changes';
    changelistId?: string;
    files: Array<{ path: string; hunkIds?: string[] }>;
  };
  warnings: string[];
}
```

## Implementation Notes

- Reuse existing `commit` and `commitChangelistPlan` execution path.
- Add a dedicated preview RPC that validates scope and returns normalized commit files.
- Keep preview data immutable between display and execution by validating again at execution time.
- If diff changed after preview, block execution and ask user to refresh preview.

## Acceptance Criteria

- No commit is created before explicit confirmation.
- Preview shows exact message and scope.
- Diff changes after preview are detected.
- changes mode commits only active changelist.
- staged mode commits only staged files.
- Result screen shows commit hash and next actions.

