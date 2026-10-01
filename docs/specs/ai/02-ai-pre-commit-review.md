# Spec: AI Pre-Commit Review

## Goal

AI Pre-Commit Review 在用户提交前检查当前 commit scope 中的明显风险。它不是完整 code review，而是一个轻量 gate：发现可能影响提交质量、发布可信度或仓库约定的问题。

## Why It Matters

用户使用 Git tool 时最怕提交错文件、漏 l10n、带 debug log、误提交 secret 或生成物。Pre-Commit Review 能在 commit 前提供最后一层信任保护。

## Entry Points

- commit form: `Review with AI`
- commit button dropdown: `Review before Commit`
- AI Commit Plan 中每个 planned commit: `Review Commit`
- keyboard command: `Intelli Git: Review Current Commit Scope`

## Review Scope

- `changes` mode: active changelist。
- `staged` mode: staged files。
- amend mode: staged files plus previous commit metadata。
- selected files override full scope when user explicitly selected subset。

## Main UI

```text
AI Pre-Commit Review
+------------------------------------------------------------------+
| Scope: Active Changelist "Fix AI setup"       Files: 6  Hunks: 12 |
| Provider: Anthropic claude-sonnet-4.5                            |
+------------------------------------------------------------------+
| Blocking                                                         |
| [!] Missing l10n entry                                            |
|     CommitForm.tsx uses "AI Review" but bundle has no key.        |
|     [Open File] [Add to Ignore]                                   |
+------------------------------------------------------------------+
| Warnings                                                         |
| [ ] Debug log left in GitService.ts                               |
|     logger.info("[getLog] git", args.join(" ")) is noisy.          |
|     [Open File] [Dismiss]                                         |
+------------------------------------------------------------------+
| Info                                                             |
| [i] No tests changed.                                             |
|     Consider adding focused tests for provider setup failure.      |
+------------------------------------------------------------------+
| [Re-run] [Commit Anyway] [Close]                                  |
+------------------------------------------------------------------+
```

## Finding Levels

- `blocking`: likely violates product or repository rules, should block default commit.
- `warning`: risky but user may reasonably commit.
- `info`: useful context, never blocks.

## Functional Requirements

- Review selected commit scope before Git mutation.
- Classify findings by severity.
- Every finding must include:
  - title
  - explanation
  - affected file path when available
  - suggested action
  - confidence
- Allow user to dismiss individual findings for the current review session.
- Allow `Commit Anyway` with explicit confirmation when blocking findings exist.
- Re-run review after files or commit message changes.
- Show review status next to commit button when a review is fresh.

## Checks To Include

### Repository Rule Checks

- user-facing text missing l10n entry
- hardcoded English/Chinese UI strings
- context menu change missing `package.json` contribution or `data-vscode-context`
- commit view behavior that violates staged/changes mode contract

### Generic Code Checks

- obvious debug logs
- secrets or token-looking strings
- generated files in wrong scope
- large binary or lockfile changes
- test-only changes without source change
- source change without tests, when affected area has nearby tests

### Git Workflow Checks

- active changelist includes unrelated files
- inactive files accidentally staged
- conflict files still present
- amend enabled but target commit appears pushed
- commit message empty, too vague, or mismatched to diff

## Non-Goals

- Do not replace CI.
- Do not run arbitrary tests automatically unless user opted in.
- Do not comment on style preferences that are not supported by repo evidence.
- Do not block on low-confidence findings.

## Interaction With Commit Button

```text
Before review:
  [Review with AI] [Commit]

After clean review:
  [Review passed] [Commit]

After warnings:
  [2 warnings] [Commit]

After blocking findings:
  [1 blocking] [Commit Anyway...]
```

## AI Input

- scoped diff
- commit message draft
- repository mode: `staged` or `changes`
- active changelist metadata
- relevant project rules summary
- nearby filenames indicating tests or l10n bundles

## AI Output Contract

```ts
interface AiPreCommitReview {
  verdict: 'pass' | 'warning' | 'blocked';
  findings: Array<{
    id: string;
    severity: 'blocking' | 'warning' | 'info';
    title: string;
    body: string;
    file?: string;
    line?: number;
    actionLabel?: string;
    confidence: 'low' | 'medium' | 'high';
  }>;
}
```

## Implementation Notes

- Use deterministic local checks before AI where cheap, especially l10n key existence and conflict file presence.
- AI review should cite exact path and diff evidence.
- Findings should be session-scoped, not stored permanently unless user asks.
- The review freshness key should include file list, hunk ids, commit message, mode, and amend flag.

## Acceptance Criteria

- User can run review from commit form.
- Review does not mutate Git state.
- Blocking findings prevent default one-click commit but allow confirmed override.
- Dismissed findings stay dismissed until diff/message changes.
- Missing l10n and conflict files are caught without relying only on AI.
