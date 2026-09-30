# Spec: AI Release Notes

## Goal

AI Release Notes 从 commit history 中提炼 product-facing changelog，帮助维护者准备 extension release。它应遵守本仓库 commit message requirements：只写真实用户可见变化，不把内部 build、CI、依赖和测试整理误写成产品变更。

## Why It Matters

Intelli Git 的 release changelog 依赖 commit history。AI 可以提高整理速度，但必须区分 product-facing change 和 internal maintenance，否则会污染 release notes。

## Entry Points

- command palette: `Intelli Git: Draft Release Notes`
- release workflow doc / script integration
- Git Log range selection: `Draft Release Notes from Range`

## Main Flow

```text
Select product tag range
        |
        v
Load commits since previous product tag
        |
        v
Classify commits
        |
        v
Generate release notes draft
        |
        v
User edits and confirms
        |
        v
Copy markdown or write release draft
```

## UI

```text
AI Release Notes
+------------------------------------------------------------------+
| Product: intelli-git extension                                   |
| Range: v0.0.10..HEAD                                             |
+------------------------------------------------------------------+
| Product-facing                                                   |
| [x] Improve Git Log reference labels                              |
| [x] Add GitHub commit context menu action                         |
| [x] Add dev extension package/install workflow                    |
+------------------------------------------------------------------+
| Internal / excluded                                               |
| [ ] Refactor package scripts                                      |
| [ ] Update tests for diff parser                                  |
+------------------------------------------------------------------+
| Draft                                                            |
| ## What's Changed                                                 |
| - Improved Git Log reference labels for branches and tags.        |
| - Added a GitHub commit context action when the remote supports it.|
+------------------------------------------------------------------+
| [Regenerate] [Copy Markdown] [Save Draft] [Close]                 |
+------------------------------------------------------------------+
```

## Functional Requirements

- Detect the previous release tag in `vX.Y.Z` format.
- Let user choose range manually.
- Parse commit subjects and bodies.
- Classify commits:
  - product-facing
  - bug fix
  - UX polish
  - AI workflow
  - Git workflow
  - internal
  - release/build/test
- Generate concise changelog.
- Show excluded commits and reasons.
- Let user toggle inclusion before regenerating.
- Support output as copied Markdown or file draft.

## Product-Facing Rules

Include:

- user-visible behavior
- UI/UX change
- Git workflow change
- AI provider/setup behavior
- bug fix that affects users
- release-relevant limitation or migration

Exclude by default:

- internal refactor
- tests only
- CI only
- packaging script only, unless user workflow changes
- dependency bumps without user-visible impact
- local agent notes

## AI Output Contract

```ts
interface AiReleaseNotesDraft {
  range: string;
  included: Array<{
    hash: string;
    category: string;
    userFacingSummary: string;
  }>;
  excluded: Array<{
    hash: string;
    reason: string;
  }>;
  markdown: string;
}
```

## Changelog Style

- English output for release notes by default.
- Product-facing, concise bullets.
- No exaggerated claims.
- No implementation-only detail unless needed for user trust.
- Mention breaking changes or behavior changes explicitly.

## Non-Goals

- Do not publish release automatically.
- Do not create tags.
- Do not modify version files.
- Do not include every commit just for completeness.

## Implementation Notes

- Use Git Log service to load commits.
- Use product tag prefix from project docs.
- First version can copy Markdown to clipboard instead of writing release files.
- Later version can integrate with GitHub release draft.

## Acceptance Criteria

- User can choose previous tag / range.
- Draft excludes internal commits by default.
- Excluded commits are visible with reasons.
- Generated markdown is editable before use.
- No publish/tag side effect occurs.
