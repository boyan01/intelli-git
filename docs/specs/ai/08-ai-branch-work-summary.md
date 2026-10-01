# Spec: AI Branch Work Summary

## Goal

AI Branch Work Summary 总结当前 branch 相对 target branch 做了什么、风险是什么、还差什么。它是 Git Log / Push / PR Draft 的前置 context，让用户快速判断当前分支是否适合继续 commit、push 或创建 PR。

## Why It Matters

用户经常需要回答这些问题：

- 这个 branch 到底改了什么？
- 和 main 相比还有多少 commits？
- 改动是否集中？
- 有哪些文件或模块风险高？
- 是否适合 squash、拆 PR 或直接提交 review？

Branch Work Summary 可以成为 Intelli Git 的 branch-level dashboard。

## Entry Points

- Git Log toolbar: `Branch Summary`
- Push tab header: `Summarize Branch`
- PR Draft flow: auto-generated context
- command palette: `Intelli Git: Summarize Current Branch`

## Main UI

```text
Branch Work Summary
+------------------------------------------------------------------+
| Branch: feature/ai-workflow                     Target: main      |
| Ahead: 5 commits   Behind: 1 commit   Files: 18                   |
+------------------------------------------------------------------+
| Summary                                                          |
| This branch adds AI-assisted commit planning and PR draft specs.  |
| It changes documentation only and does not affect runtime code.   |
+------------------------------------------------------------------+
| Change areas                                                     |
| - docs/specs/ai: new AI workflow specs                            |
| - docs/product-opportunities.md: product roadmap context           |
+------------------------------------------------------------------+
| Risk                                                             |
| Low. Documentation-only changes.                                  |
+------------------------------------------------------------------+
| Suggested next actions                                            |
| [Draft PR] [Release Notes] [Open Git Log] [Update from main]      |
+------------------------------------------------------------------+
```

## Functional Requirements

- Select target branch, defaulting to upstream base or `main` / `master` when obvious.
- Show ahead/behind counts.
- Summarize commits in range.
- Summarize changed files by directory/module.
- Identify likely risk level:
  - low
  - medium
  - high
- Suggest next actions based on branch state.
- Cache summary until branch HEAD, target branch, or working tree state changes.

## Summary Inputs

- current branch
- target branch
- merge-base range
- commit subjects and bodies
- changed file paths
- diffstat
- working tree dirty state
- PR readiness result when available

## AI Output Contract

```ts
interface AiBranchWorkSummary {
  title: string;
  summary: string;
  changeAreas: Array<{
    label: string;
    files: string[];
    description: string;
  }>;
  risk: {
    level: 'low' | 'medium' | 'high';
    reasons: string[];
  };
  suggestedActions: Array<{
    label: string;
    reason: string;
    actionId: string;
  }>;
}
```

## Risk Heuristics

Low risk:

- documentation-only
- tests-only
- UI copy-only
- release metadata only

Medium risk:

- UI workflow changes
- AI provider configuration
- Git Log rendering or filters
- package / build scripts

High risk:

- commit execution
- changelist assignment
- inactive changes
- push / force push / branch update
- temporary stash / recovery
- RPC transport

AI can refine risk, but deterministic categories should seed the risk level.

## Suggested Actions

Examples:

- `Draft PR` when branch is pushed or can be pushed.
- `Run PR Readiness` when target branch or push state is unclear.
- `Split Commits` when commits touch unrelated change areas.
- `Update from Target` when branch is behind.
- `Release Notes` when branch contains product-facing commits.
- `Open Git Log` for manual inspection.

## Non-Goals

- Do not create PR directly.
- Do not mutate branch state.
- Do not claim tests passed unless the product actually observed a test result.
- Do not summarize uncommitted changes as part of branch commits unless explicitly included.

## Implementation Notes

- This can be the safest first AI branch feature because it is read-only.
- Reuse Git Log range loading.
- Reuse PR readiness deterministic checks for branch state.
- Use a small summary panel rather than a full route.
- Later, PR Draft can import this summary as context.

## Acceptance Criteria

- User can summarize current branch without mutating Git state.
- Target branch is visible and editable.
- Summary distinguishes committed branch changes from uncommitted working tree changes.
- Suggested actions are real product actions.
- Cached summary invalidates when HEAD or target changes.
