#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${INTELLI_GIT_REPO_ROOT:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"
FIXTURE_SCRIPT="$REPO_ROOT/apps/extension/scripts/setup-checkout-test.sh"
EXTENSION_DEV_PATH="$REPO_ROOT/apps/extension"

log() {
    printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$1"
}

die() {
    echo "Error: $1" >&2
    exit 1
}

print_usage() {
    cat <<EOF
Usage:
  $SCRIPT_NAME [scenario] [options]
  $SCRIPT_NAME --list

Defaults:
  scenario: rebase-conflict
  base dir: .test/intelli-git-test/<scenario>
  VS Code CLI: \${CODE_CMD:-code}

Options:
  --scenario <name>   Scenario to pass to setup-checkout-test.sh
  --base-dir <path>   Fixture root passed as BASE_DIR
  --code-cmd <cmd>    VS Code CLI command, for example code-insiders
  --compile           Run npm run compile before launching VS Code
  --no-open           Generate the fixture without opening VS Code
  --list              List scenarios from setup-checkout-test.sh
  -h, --help          Show this help

Environment:
  BASE_DIR                    Default fixture root
  CODE_CMD                    Default VS Code CLI command
  INTELLI_GIT_TEST_COMPILE=1  Compile before launch
  INTELLI_GIT_TEST_OPEN=0     Do not open VS Code
EOF
}

abs_from_repo() {
    local path="$1"
    case "$path" in
        /*) printf '%s\n' "$path" ;;
        *) printf '%s\n' "$REPO_ROOT/$path" ;;
    esac
}

require_file() {
    local path="$1"
    [[ -f "$path" ]] || die "required file not found: $path"
}

scenario="rebase-conflict"
base_dir=""
code_cmd="${CODE_CMD:-code}"
compile="${INTELLI_GIT_TEST_COMPILE:-0}"
open_window="${INTELLI_GIT_TEST_OPEN:-1}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --scenario)
            [[ $# -ge 2 ]] || die "--scenario requires a value"
            scenario="$2"
            shift 2
            ;;
        --base-dir)
            [[ $# -ge 2 ]] || die "--base-dir requires a value"
            base_dir="$2"
            shift 2
            ;;
        --code-cmd)
            [[ $# -ge 2 ]] || die "--code-cmd requires a value"
            code_cmd="$2"
            shift 2
            ;;
        --compile)
            compile="1"
            shift
            ;;
        --no-open)
            open_window="0"
            shift
            ;;
        --list)
            require_file "$FIXTURE_SCRIPT"
            cd "$REPO_ROOT"
            bash "$FIXTURE_SCRIPT" list
            exit 0
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        --*)
            die "unknown option: $1"
            ;;
        *)
            scenario="$1"
            shift
            ;;
    esac
done

require_file "$FIXTURE_SCRIPT"
require_file "$EXTENSION_DEV_PATH/package.json"

if [[ -z "$base_dir" ]]; then
    base_dir="${BASE_DIR:-.test/intelli-git-test/$scenario}"
fi

base_dir_abs="$(abs_from_repo "$base_dir")"
worktree_dir="$base_dir_abs/test-git-checkout"
user_data_dir="$base_dir_abs/vscode-user-data"
extensions_dir="$base_dir_abs/vscode-extensions"

if [[ "$compile" == "1" ]]; then
    log "Compiling current extension output"
    (cd "$REPO_ROOT" && npm run compile)
fi

log "Creating Intelli Git fixture scenario: $scenario"
(cd "$REPO_ROOT" && BASE_DIR="$base_dir" bash "$FIXTURE_SCRIPT" "$scenario")

cat <<EOF

Fixture paths:
  base:       $base_dir_abs
  worktree:   $worktree_dir
  user data:  $user_data_dir
  extensions: $extensions_dir
  extension:  $EXTENSION_DEV_PATH
EOF

if [[ "$open_window" == "0" ]]; then
    echo
    echo "VS Code launch skipped because --no-open or INTELLI_GIT_TEST_OPEN=0 was set."
    exit 0
fi

command -v "$code_cmd" >/dev/null 2>&1 || die "VS Code CLI not found: $code_cmd"

mkdir -p "$user_data_dir" "$extensions_dir"

log "Opening fixture in VS Code Extension Development Host"
"$code_cmd" \
    --new-window \
    --disable-extensions \
    --user-data-dir "$user_data_dir" \
    --extensions-dir "$extensions_dir" \
    "--extensionDevelopmentPath=$EXTENSION_DEV_PATH" \
    "$worktree_dir"
