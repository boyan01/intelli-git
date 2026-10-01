# Spec: AI PR Draft

## Goal

AI PR Draft 基于当前 branch 相对 target branch 的 commits 和 diff，生成可编辑的 PR title/body，并在用户确认后创建 draft PR。第一阶段可以只支持 GitHub，但 contract 必须为 GitLab 等 provider 预留。

## Why It Matters

创建 PR 的难点不是打开网页，而是写清楚用户可感知变化、风险、测试和 review focus。AI 可以把 branch history 转成结构化 PR draft，但不能直接发布不可审计内容。

## Entry Points

- Push tab: `Draft PR`
- Git Log branch summary panel: `Create PR Draft`
- after successful push: `Create Draft PR`
- command palette: `Intelli Git: Draft Pull Request`

## Main Flow

```text
User clicks Draft PR
        |
        v
Select target branch if unknown
        |
        v
Collect branch commits and diff summary
        |
        v
AI generates title/body
        |
        v
User edits preview
        |
        v
Readiness check
        |
        v
Create draft PR
```

## UI

```text
AI PR Draft
+------------------------------------------------------------------+
| Repository: idea-commit-pannel                                    |
| Source: feature/ai-commit-plan                                    |
| Target: main                              Provider: GitHub        |
+------------------------------------------------------------------+
| Title                                                            |
| Add AI commit planning workflow                                   |
+------------------------------------------------------------------+
| Body                                                             |
| Summary                                                          |
| - Add an AI-assisted commit planning entry point.                 |
| - Group scoped changes into editable planned commits.             |
|                                                                  |
| Tests                                                            |
| - Not run. Documentation-only spec.                               |
|                                                                  |
| Risks                                                            |
| - No runtime behavior changes yet.                                |
+------------------------------------------------------------------+
| Readiness                                                        |
| [pass] Branch pushed                                             |
| [warn] Working tree has uncommitted changes                       |
| [pass] Target branch selected                                    |
+------------------------------------------------------------------+
| [Regenerate] [Edit] [Create Draft PR] [Open in Browser] [Cancel]  |
+------------------------------------------------------------------+
```

## PR Body Template

Default sections:

```text
## Summary

## Changes

## Tests

## Risks

## Review Focus
```

Rules:

- `Summary` should be product-facing when changes are user-visible.
- `Changes` can include implementation details.
- `Tests` must state what was run or `Not run` with reason.
- `Risks` should not be empty when Git mutation, AI, changelist, push, or release behavior changed.
- `Review Focus` should point reviewers to the highest-risk files or flows.

## Functional Requirements

- Detect source branch and candidate target branch.
- Let user change target branch.
- Compute commit range using merge-base.
- Summarize commits and changed files.
- Generate title/body with editable preview.
- Run PR readiness check before creation.
- Create draft PR by default.
- Open created PR URL after success.
- Store last used target branch per repository.

## Provider Model

```ts
type RemoteProvider = 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'unknown';

interface PullRequestProviderCapabilities {
  canCreateDraft: boolean;
  canOpenCreateUrl: boolean;
  supportsReviewers?: boolean;
  supportsLabels?: boolean;
}
```

First implementation may use GitHub only, but UI and contracts should say provider/capability, not `isGitHub`.

## AI Input

- source branch
- target branch
- commit subjects and bodies in range
- changed files summary
- diff summary, bounded by size
- existing PR body template if configured
- user instruction
- repository product context from README when available

## AI Output Contract

```ts
interface AiPrDraft {
  title: string;
  body: string;
  summaryBullets: string[];
  testSummary: string;
  riskSummary: string;
  reviewFocus: string[];
}
```

## Safety And Confirmation

- Never create PR without preview.
- Default to draft PR.
- If branch is not pushed, offer `Push Branch` before `Create Draft PR`.
- If working tree is dirty, show warning but do not block PR creation unless uncommitted changes overlap PR scope in a risky way.
- If target branch cannot be detected, block until user selects one.

## Non-Goals

- Do not request reviewers automatically in first version.
- Do not assign labels automatically in first version.
- Do not create GitHub issue links unless branch or commits already mention issue ids.
- Do not create non-draft PR by default.

## Acceptance Criteria

- User can preview and edit PR title/body before creation.
- Target branch is explicit.
- Provider capability determines available action.
- Created PR URL is displayed and openable.
- Draft body includes Summary, Tests, Risks, and Review Focus.
