# AI Git Workflow Specs

Date: 2026-05-12

这一组 spec 描述 Intelli Git 后续增强 AI 能力时的产品边界、交互流程、功能点和实现提示。目标不是把 Git 操作变成不可控的 “auto everything”，而是把 AI 做成可预览、可编辑、可确认、可恢复的 Git workflow assistant。

## Spec Index

| Spec | Product goal |
| --- | --- |
| [AI Commit Plan](./01-ai-commit-plan.md) | AI 分析当前 diff / changelist，建议如何拆分 commits。 |
| [AI Pre-Commit Review](./02-ai-pre-commit-review.md) | commit 前检查明显风险、遗漏和质量问题。 |
| [AI Auto Commit](./03-ai-auto-commit.md) | 在 dry-run preview 和用户确认后执行 commit。 |
| [AI PR Draft](./04-ai-pr-draft.md) | 基于 branch diff / commits 生成 PR title 和 body。 |
| [AI PR Readiness Check](./05-ai-pr-readiness-check.md) | 创建 PR 前检查 branch、push、test、risk 和 metadata。 |
| [AI Release Notes](./06-ai-release-notes.md) | 从 commit history 提炼 product-facing changelog。 |
| [AI Recovery Assistant](./07-ai-recovery-assistant.md) | Git 操作失败后解释状态并给 recovery actions。 |
| [AI Branch Work Summary](./08-ai-branch-work-summary.md) | 总结当前 branch 做了什么、风险是什么、还差什么。 |

## Shared Product Principles

- AI 先生成 plan 或 preview，不直接修改 repository。
- 所有会改变 Git state 的操作必须有用户确认。
- 默认 scope 是 active repository 和当前 visible workflow。
- `changes` mode 下默认只处理 active changelist。
- 需要清楚展示 AI 使用了哪些输入：files、hunks、commits、target branch、provider/model。
- 所有 user-facing text 必须走 shared l10n bundle。
- AI 输出可以被用户编辑，不能把 AI 文案当成不可改的最终结果。
- 执行后必须给出可审计结果：created commit hash、PR URL、changed files、failed step、recovery action。

## Shared Surface

```text
Commit View
+--------------------------------------------------------------+
| [Mode: Changes v] [AI Plan] [AI Review] [Refresh] [Tree/List] |
+--------------------------------------------------------------+
| Active Changelist                                            |
|   src/foo.ts                                                 |
|   src/bar.ts                                                 |
+--------------------------------------------------------------+
| Commit message                                               |
| [Generate] [AI Commit...] [Commit] [Commit & Push]           |
+--------------------------------------------------------------+

Git Log / Push
+--------------------------------------------------------------+
| [Branch Summary] [PR Draft] [PR Readiness] [Release Notes]   |
+--------------------------------------------------------------+
```

## Shared Data Inputs

AI features should gather only the minimum context needed for the selected workflow.

- repository identity: active repository path, current branch, target branch when needed.
- working tree state: staged / unstaged / untracked / inactive / changelist assignment.
- selected files and hunks, with explicit mode semantics.
- commit history range, usually `merge-base(target, HEAD)..HEAD`.
- existing commit messages and file list.
- optional user-provided instruction, such as "write product-facing PR body".

## Shared Safety Model

```text
AI suggestion
     |
     v
Preview with exact scope
     |
     v
User edits / confirms
     |
     v
GitHub / Git / file mutation
     |
     v
Result with audit trail and recovery path
```

Do not allow a workflow to skip the preview when it creates commits, pushes, opens PRs, resets state, modifies files, or marks review findings as resolved.

## Shared Implementation Notes

- Prefer adding feature-specific RPC methods over reusing generic workspace state APIs.
- Keep provider-specific remote actions behind a provider-aware contract, not GitHub-only booleans.
- Keep command palette entries meaningful without webview context; context-only commands should be hidden or backed by a QuickPick.
- Reuse existing `CommitView`, `PushTab`, `GitLogView`, and native VS Code diff editors instead of creating a separate AI workspace UI.
- AI context preview should be inspectable before a paid/provider request when practical.

