#!/usr/bin/env bash

set -euo pipefail

BASE_DIR="${BASE_DIR:-./.test}"
REMOTE_REPO_DIR="${BASE_DIR}/repo.git"
WORKTREE_DIR="${BASE_DIR}/test-git-checkout"
SEED_DIR="${BASE_DIR}/seed"
REMOTE_WORK_DIR="${BASE_DIR}/remote-work"

SCRIPT_NAME="$(basename "$0")"

MAIN_BRANCH="main"
REMOTE_BRANCH="origin/feature/smart-checkout"
LOCAL_BRANCH="feature/smart-checkout"

log() {
    printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$1"
}

die() {
    echo "Error: $1" >&2
    exit 1
}

require_git() {
    command -v git >/dev/null 2>&1 || die "git is required"
}

repo_root() {
    cd "$1" && pwd
}

run_git() {
    local repo_dir="$1"
    shift
    git -C "$repo_dir" "$@"
}

write_file() {
    local path="$1"
    local content="$2"
    mkdir -p "$(dirname "$path")"
    printf '%s\n' "$content" > "$path"
}

append_file() {
    local path="$1"
    local content="$2"
    mkdir -p "$(dirname "$path")"
    printf '%s\n' "$content" >> "$path"
}

reset_workspace() {
    rm -rf "$BASE_DIR"
    mkdir -p "$BASE_DIR"
}

init_remote_repo() {
    log "Initializing bare remote"
    git init --bare "$REMOTE_REPO_DIR" >/dev/null
}

init_seed_repo() {
    log "Seeding repository history"
    git init -b "$MAIN_BRANCH" "$SEED_DIR" >/dev/null
    run_git "$SEED_DIR" config user.name "Setup User"
    run_git "$SEED_DIR" config user.email "setup@example.com"

    mkdir -p "$SEED_DIR/docs" "$SEED_DIR/src" "$SEED_DIR/untracked"

    write_file "$SEED_DIR/README.md" "# Checkout test repository"
    write_file "$SEED_DIR/docs/shared.txt" "shared-on-main"
    write_file "$SEED_DIR/src/conflict.txt" "main-base"
    write_file "$SEED_DIR/src/delete-on-feature.txt" "base-delete-on-feature"
    write_file "$SEED_DIR/src/delete-on-main.txt" "base-delete-on-main"
    write_file "$SEED_DIR/src/safe.txt" "same-on-main-and-feature"
    write_file "$SEED_DIR/src/staged.txt" "main-staged-base"
    write_file "$SEED_DIR/src/local-only.txt" "main-local-base"
    run_git "$SEED_DIR" add .
    run_git "$SEED_DIR" commit -m "Initial commit on main" >/dev/null

    append_file "$SEED_DIR/docs/shared.txt" "main-second-line"
    run_git "$SEED_DIR" add docs/shared.txt
    run_git "$SEED_DIR" commit -m "Main branch follow-up" >/dev/null

    run_git "$SEED_DIR" checkout -b "$LOCAL_BRANCH" >/dev/null
    write_file "$SEED_DIR/src/conflict.txt" "feature-branch-version"
    rm -f "$SEED_DIR/src/delete-on-feature.txt"
    write_file "$SEED_DIR/src/delete-on-main.txt" "feature-modified-delete-on-main"
    write_file "$SEED_DIR/src/both-added.txt" "feature-added-version"
    write_file "$SEED_DIR/src/staged.txt" "feature-staged-version"
    write_file "$SEED_DIR/untracked/feature-only.txt" "feature-branch-file"
    mkdir -p "$SEED_DIR/feature"
    write_file "$SEED_DIR/feature/branch-note.txt" "feature-branch-note"
    run_git "$SEED_DIR" add .
    run_git "$SEED_DIR" commit -m "Feature branch changes" >/dev/null

    append_file "$SEED_DIR/feature/branch-note.txt" "feature-second-commit"
    run_git "$SEED_DIR" add feature/branch-note.txt
    run_git "$SEED_DIR" commit -m "Feature branch follow-up" >/dev/null

    run_git "$SEED_DIR" remote add origin "$(repo_root "$REMOTE_REPO_DIR")"
    run_git "$SEED_DIR" push -u origin "$MAIN_BRANCH" "$LOCAL_BRANCH" >/dev/null
    run_git "$SEED_DIR" checkout "$MAIN_BRANCH" >/dev/null
}

clone_workspace() {
    log "Cloning workspace repository"
    git clone "$(repo_root "$REMOTE_REPO_DIR")" "$WORKTREE_DIR" >/dev/null
    run_git "$WORKTREE_DIR" config user.name "Test User"
    run_git "$WORKTREE_DIR" config user.email "test@example.com"
}

setup_remote_worktree() {
    log "Preparing helper clone for remote updates"
    git clone "$(repo_root "$REMOTE_REPO_DIR")" "$REMOTE_WORK_DIR" >/dev/null
    run_git "$REMOTE_WORK_DIR" config user.name "Remote User"
    run_git "$REMOTE_WORK_DIR" config user.email "remote@example.com"
}

bootstrap() {
    reset_workspace
    init_remote_repo
    init_seed_repo
    clone_workspace
    setup_remote_worktree
}

ensure_on_main() {
    run_git "$WORKTREE_DIR" checkout "$MAIN_BRANCH" >/dev/null
}

create_local_tracking_branch() {
    if run_git "$WORKTREE_DIR" show-ref --verify --quiet "refs/heads/$LOCAL_BRANCH"; then
        return
    fi

    run_git "$WORKTREE_DIR" checkout -b "$LOCAL_BRANCH" --track "$REMOTE_BRANCH" >/dev/null
    run_git "$WORKTREE_DIR" checkout "$MAIN_BRANCH" >/dev/null
}

advance_remote_feature() {
    run_git "$REMOTE_WORK_DIR" checkout "$LOCAL_BRANCH" >/dev/null
    append_file "$REMOTE_WORK_DIR/feature/branch-note.txt" "remote-update-$1"
    write_file "$REMOTE_WORK_DIR/feature/remote-$1.txt" "remote-$1"
    run_git "$REMOTE_WORK_DIR" add feature
    run_git "$REMOTE_WORK_DIR" commit -m "Remote update $1" >/dev/null
    run_git "$REMOTE_WORK_DIR" push >/dev/null
}

make_local_feature_commit() {
    create_local_tracking_branch
    run_git "$WORKTREE_DIR" checkout "$LOCAL_BRANCH" >/dev/null
    append_file "$WORKTREE_DIR/feature/branch-note.txt" "local-update-$1"
    write_file "$WORKTREE_DIR/feature/local-$1.txt" "local-$1"
    run_git "$WORKTREE_DIR" add feature
    run_git "$WORKTREE_DIR" commit -m "Local update $1" >/dev/null
    run_git "$WORKTREE_DIR" checkout "$MAIN_BRANCH" >/dev/null
}

scenario_clean_remote() {
    :
}

scenario_safe_local_change() {
    write_file "$WORKTREE_DIR/src/safe.txt" "same-on-main-and-feature"
    append_file "$WORKTREE_DIR/src/safe.txt" "local-safe-change"
}

scenario_conflicting_tracked_change() {
    write_file "$WORKTREE_DIR/src/conflict.txt" "local-conflict-change"
}

scenario_untracked_conflict() {
    write_file "$WORKTREE_DIR/untracked/feature-only.txt" "local-untracked-conflict"
}

scenario_staged_conflict() {
    write_file "$WORKTREE_DIR/src/staged.txt" "local-staged-change"
    run_git "$WORKTREE_DIR" add src/staged.txt
}

scenario_mixed_conflict() {
    write_file "$WORKTREE_DIR/src/conflict.txt" "local-conflict-change"
    write_file "$WORKTREE_DIR/untracked/feature-only.txt" "local-untracked-conflict"
    write_file "$WORKTREE_DIR/src/staged.txt" "local-staged-change"
    run_git "$WORKTREE_DIR" add src/staged.txt
}

scenario_local_branch_clean() {
    create_local_tracking_branch
}

scenario_local_branch_ahead() {
    make_local_feature_commit "ahead"
}

scenario_local_branch_behind() {
    create_local_tracking_branch
    advance_remote_feature "behind"
    run_git "$WORKTREE_DIR" fetch origin >/dev/null
}

scenario_local_branch_diverged() {
    make_local_feature_commit "diverged-local"
    advance_remote_feature "diverged-remote"
    run_git "$WORKTREE_DIR" fetch origin >/dev/null
}

scenario_ahead_with_conflict() {
    make_local_feature_commit "ahead-conflict"
    write_file "$WORKTREE_DIR/src/conflict.txt" "local-conflict-change"
}

scenario_behind_with_conflict() {
    create_local_tracking_branch
    advance_remote_feature "behind-conflict"
    run_git "$WORKTREE_DIR" fetch origin >/dev/null
    write_file "$WORKTREE_DIR/src/conflict.txt" "local-conflict-change"
}

scenario_merge_conflict() {
    create_local_tracking_branch
    write_file "$WORKTREE_DIR/src/conflict.txt" "main-merge-conflict-change"
    write_file "$WORKTREE_DIR/src/delete-on-feature.txt" "main-modified-delete-on-feature"
    rm -f "$WORKTREE_DIR/src/delete-on-main.txt"
    write_file "$WORKTREE_DIR/src/both-added.txt" "main-added-version"
    run_git "$WORKTREE_DIR" add -A src/conflict.txt src/delete-on-feature.txt src/delete-on-main.txt src/both-added.txt
    run_git "$WORKTREE_DIR" commit -m "Main side conflict commit" >/dev/null

    run_git "$WORKTREE_DIR" merge "$LOCAL_BRANCH" || true
}

scenario_stash_pop_conflict() {
    write_file "$WORKTREE_DIR/src/conflict.txt" "local-stash-change"
    run_git "$WORKTREE_DIR" stash push -m "Test stash pop conflict" >/dev/null

    run_git "$WORKTREE_DIR" checkout -b "$LOCAL_BRANCH" --track "$REMOTE_BRANCH" >/dev/null
    run_git "$WORKTREE_DIR" stash pop || true
}

print_usage() {
    cat <<EOF
Usage:
  $SCRIPT_NAME <scenario>
  $SCRIPT_NAME list

Scenarios:
  clean-remote         Clean workspace, checkout remote branch for first time
  safe                 Local tracked change that should carry across checkout
  conflict             Local tracked change that conflicts with target branch
  untracked            Untracked file conflicts with file introduced on target branch
  staged               Staged tracked change conflicts with target branch
  mixed                Conflict + staged conflict + untracked conflict together
  local-clean          Local tracking branch already exists and is clean
  ahead                Local tracking branch exists and is ahead of remote
  behind               Local tracking branch exists and is behind remote
  diverged             Local tracking branch exists and diverged from remote
  ahead-conflict       Local branch ahead, while current branch also has checkout conflict
  behind-conflict      Local branch behind, while current branch also has checkout conflict
  merge-conflict       Create a real merge conflict state in git status
  stash-pop-conflict   Simulate Smart Checkout stash pop restoring into conflict
EOF
}

print_ascii_guide() {
    cat <<EOF

Scenario topology:

  origin/main ---------------------o
        \\
         \\---- origin/feature/smart-checkout ----o----o
                                                  ^
                                                  target branch

  workspace starts on: main
  checkout target:     $REMOTE_BRANCH
  local branch name:   $LOCAL_BRANCH
EOF
}

print_summary() {
    local scenario="$1"

    cat <<EOF

Ready.

Workspace:
  remote:   $(repo_root "$REMOTE_REPO_DIR")
  worktree: $(repo_root "$WORKTREE_DIR")
  current:  $(run_git "$WORKTREE_DIR" branch --show-current)
  target:   $REMOTE_BRANCH

Suggested validation:
  1. Open the repository at $(repo_root "$WORKTREE_DIR")
EOF

    case "$scenario" in
        stash-pop-conflict)
            cat <<EOF
  2. Inspect the stash-pop result on branch "$LOCAL_BRANCH"
  3. Verify the conflict markers and unresolved state below
EOF
            ;;
        merge-conflict)
            cat <<EOF
  2. Inspect the merge result on branch "$MAIN_BRANCH"
  3. Verify the conflict markers and unresolved state below
EOF
            ;;
        *)
            cat <<EOF
  2. Trigger branch checkout for "$REMOTE_BRANCH"
  3. Verify the dialog/behavior matches the scenario below
EOF
            ;;
    esac

    cat <<EOF

Scenario: $scenario
EOF

    case "$scenario" in
        clean-remote)
            echo "Expectation: checkout creates local tracking branch without prompts."
            ;;
        safe)
            echo "Expectation: checkout succeeds and carries src/safe.txt local changes to the new branch."
            ;;
        conflict)
            echo "Expectation: checkout is blocked because src/conflict.txt would be overwritten."
            ;;
        untracked)
            echo "Expectation: checkout is blocked because untracked/feature-only.txt would be overwritten."
            ;;
        staged)
            echo "Expectation: checkout is blocked by staged change on src/staged.txt."
            ;;
        mixed)
            echo "Expectation: checkout is blocked with multiple dirty states present."
            ;;
        local-clean)
            echo "Expectation: remote checkout resolves to existing local branch and then pulls cleanly."
            ;;
        ahead)
            echo "Expectation: UI should detect local branch ahead of remote and ask for rebase/reset/cancel."
            ;;
        behind)
            echo "Expectation: checkout should switch to local branch and pull remote commits."
            ;;
        diverged)
            echo "Expectation: UI should detect local commits ahead of remote and offer rebase/reset/cancel."
            ;;
        ahead-conflict)
            echo "Expectation: conflict handling appears before or during switch to the ahead local branch."
            ;;
        behind-conflict)
            echo "Expectation: local checkout conflict blocks the behind branch switch before pull completes."
            ;;
        merge-conflict)
            echo "Expectation: repository enters multiple real conflict states: UU, UD, DU, and AA."
            echo "Expectation: delete-related conflicts may require git rm or removing the file to resolve."
            ;;
        stash-pop-conflict)
            echo "Expectation: stash pop creates a real conflict on top of the checked out feature branch."
            ;;
    esac

    case "$scenario" in
        merge-conflict|stash-pop-conflict)
            echo "Note: this scenario should produce a real conflict state in git status."
            echo "Probe: git -C $(repo_root "$WORKTREE_DIR") status"
            ;;
        *)
            echo "Note: this is a checkout overwrite conflict, not a merge conflict."
            echo "Note: before attempting checkout, git status will usually show M/?? rather than UU."
            echo "Probe: git -C $(repo_root "$WORKTREE_DIR") checkout -b $LOCAL_BRANCH --track $REMOTE_BRANCH"
            ;;
    esac

    echo
    run_git "$WORKTREE_DIR" status --short --branch
    echo
    echo "Branches:"
    run_git "$WORKTREE_DIR" branch -vv --all
}

main() {
    require_git

    local scenario="${1:-}"
    case "$scenario" in
        list|--list|help|--help|-h|"")
            print_usage
            print_ascii_guide
            exit 0
            ;;
    esac

    bootstrap
    ensure_on_main

    case "$scenario" in
        clean-remote) scenario_clean_remote ;;
        safe) scenario_safe_local_change ;;
        conflict) scenario_conflicting_tracked_change ;;
        untracked) scenario_untracked_conflict ;;
        staged) scenario_staged_conflict ;;
        mixed) scenario_mixed_conflict ;;
        local-clean) scenario_local_branch_clean ;;
        ahead) scenario_local_branch_ahead ;;
        behind) scenario_local_branch_behind ;;
        diverged) scenario_local_branch_diverged ;;
        ahead-conflict) scenario_ahead_with_conflict ;;
        behind-conflict) scenario_behind_with_conflict ;;
        merge-conflict) scenario_merge_conflict ;;
        stash-pop-conflict) scenario_stash_pop_conflict ;;
        *) print_usage; exit 1 ;;
    esac

    print_ascii_guide
    print_summary "$scenario"
}

main "$@"
