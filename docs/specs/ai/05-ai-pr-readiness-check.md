# Spec: AI PR Readiness Check

## Goal

AI PR Readiness Check 在创建 PR 或 push 前检查 branch 是否准备好进入 review。它结合 deterministic Git checks 和 AI summary，告诉用户还缺什么。

## Why It Matters

很多低质量 PR 的问题不是代码本身，而是流程状态不清楚：branch 没 push、behind target、有 uncommitted changes、没跑测试、PR body 缺 Tests。Readiness Check 可以在 PR Draft 前建立可信 workflow。

## Entry Points

- PR Draft preview: automatic readiness section
- Push tab: `Check PR Readiness`
- Git Log branch toolbar: `Readiness`
- after push rejection: `Check branch state`

## Main UI

```text
PR Readiness
+------------------------------------------------------------------+
| Source: feature/ai-pr-draft                                      |
| Target: main                                                     |
+------------------------------------------------------------------+
| Required                                                         |
| [pass] Branch has 4 commits ahead of main                         |
| [fail] Branch is not pushed                                       |
| [pass] No conflict state detected                                 |
| [warn] Working tree has 3 uncommitted files                       |
+------------------------------------------------------------------+
| Quality                                                          |
| [warn] Tests not found in recent command history                  |
| [pass] PR body includes Summary, Tests, Risks                     |
| [info] 2 commits look squashable                                  |
+------------------------------------------------------------------+
| Actions                                                          |
| [Push Branch] [Update from main] [Draft PR] [Open Git Log]        |
+------------------------------------------------------------------+
```

## Check Categories

### Required Checks

- active repository exists
- current branch is not detached HEAD
- target branch selected
- source branch has commits ahead of target
- branch pushed or push action available
- no ongoing merge/rebase/cherry-pick conflict
- no blocked Git state

### Safety Checks

- working tree dirty
- staged changes not included in branch commits
- branch behind target
- force push would be required
- local branch has no upstream
- temporary stash recovery state exists

### Quality Checks

- test command not recently run or unknown
- no tests changed for code-heavy branch
- PR body missing key sections
- commits too many or too broad
- commit messages too vague for changelog

## Deterministic Vs AI Checks

Deterministic checks should run first:

- branch ahead/behind
- upstream status
- working tree state
- unpushed commits
- target branch selection
- conflict state

AI checks should interpret:

- summary quality
- risk level
- review focus
- commit grouping quality
- likely missing tests

## Result Model

```ts
interface PrReadinessResult {
  verdict: 'ready' | 'needs-action' | 'blocked';
  checks: Array<{
    id: string;
    category: 'required' | 'safety' | 'quality';
    status: 'pass' | 'warn' | 'fail' | 'info';
    title: string;
    detail?: string;
    action?: {
      label: string;
      command: string;
      args?: unknown;
    };
  }>;
}
```

## Action Rules

- `blocked`: hide `Create PR` primary action, show required fixes.
- `needs-action`: allow `Create Draft PR` only with explicit confirmation.
- `ready`: enable `Create Draft PR`.

## AI Prompt Inputs

- deterministic check output
- commit range summary
- file categories
- PR draft body when available
- recent known test command result if tracked
- repository product context

## Non-Goals

- Do not become CI.
- Do not require tests for documentation-only changes.
- Do not enforce one commit style globally.
- Do not auto-update branch or push without user confirmation.

## Acceptance Criteria

- Branch not pushed is detected and actionable.
- Dirty working tree is visible.
- Target branch is explicit.
- Readiness check can run without creating PR.
- PR Draft integrates readiness result before creation.
- AI findings never override deterministic Git facts.
