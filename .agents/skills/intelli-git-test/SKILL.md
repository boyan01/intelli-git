---
name: intelli-git-test
description: Create and open reproducible Intelli Git VS Code extension test repositories. Use when testing Intelli Git checkout, branch switch, rebase, merge conflict resolver, stash-pop conflict, dirty worktree protection, index.lock race, or when the user asks to build a conflicted fixture repo and open it with the current debug extension.
---

# Intelli Git Test

## Quick Start

Use the repo-local launcher instead of hand-building Git histories:

```bash
bash .agents/skills/intelli-git-test/scripts/open-checkout-scenario.sh rebase-conflict
```

The launcher:

- runs `apps/extension/scripts/setup-checkout-test.sh` for the selected scenario;
- places fixture repos and VS Code state under ignored `.test/` paths;
- opens the fixture worktree with `code --extensionDevelopmentPath <repo>/apps/extension`;
- uses dedicated `--user-data-dir` and `--extensions-dir` so normal VS Code state does not affect the test.

If the current extension output may be stale, start `npm run watch:extension` separately, or pass `--compile` for a one-shot compile before opening.

## Scenario Selection

List supported fixture scenarios before guessing:

```bash
bash .agents/skills/intelli-git-test/scripts/open-checkout-scenario.sh --list
```

Prefer these scenarios for conflict testing:

- `rebase-conflict`: starts clean on `feature/smart-checkout`; trigger rebase onto `main` in Intelli Git, then abort and switch branches.
- `merge-conflict`: opens a repo already in a real merge conflict state.
- `stash-pop-conflict`: opens a repo after `stash pop` has created a real conflict.
- `conflict`, `untracked`, `staged`, `mixed`: checkout overwrite conflicts, not merge conflicts.

Use `--no-open` when only preparing or inspecting the fixture:

```bash
bash .agents/skills/intelli-git-test/scripts/open-checkout-scenario.sh merge-conflict --no-open
```

## Launcher Options

Common options:

- `--base-dir <path>`: set the fixture root. Defaults to `.test/intelli-git-test/<scenario>`.
- `--code-cmd <command>`: use another VS Code CLI, such as `code-insiders`.
- `--compile`: run `npm run compile` before opening.
- `--no-open`: generate the fixture without launching VS Code.

Environment knobs:

- `BASE_DIR`: default fixture root when `--base-dir` is omitted.
- `CODE_CMD`: default VS Code CLI command when `--code-cmd` is omitted.
- `INTELLI_GIT_TEST_COMPILE=1`: compile before launch.
- `INTELLI_GIT_TEST_OPEN=0`: generate the fixture without launching VS Code.

## Verification Pattern

After generating a fixture, use the printed worktree path for probes:

```bash
git -C <worktree> status --short --branch
```

For `rebase-conflict`, the setup script intentionally starts clean on the feature branch. Trigger the rebase from Intelli Git or run:

```bash
git -C <worktree> rebase main
```

Do not duplicate scenario construction in this skill. If a new scenario is needed, extend `apps/extension/scripts/setup-checkout-test.sh` and keep this skill as the launcher and testing guide.
