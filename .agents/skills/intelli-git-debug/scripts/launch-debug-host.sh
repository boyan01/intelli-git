#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${INTELLI_GIT_REPO_ROOT:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"
FIXTURE_LAUNCHER="$REPO_ROOT/.agents/skills/intelli-git-test/scripts/open-checkout-scenario.sh"
EXTENSION_DEV_PATH="$REPO_ROOT/apps/extension"
CONTROLLER="$SCRIPT_DIR/debug-host-control.mjs"

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
  scenario:           merge-conflict
  renderer CDP port:  ${INTELLI_GIT_RENDERER_PORT:-9333}
  extension CDP port: ${INTELLI_GIT_EXTENSION_PORT:-9229}
  base dir:           /tmp/ig-debug-<scenario>-<renderer-port>
  compile:            enabled

Options:
  --scenario <name>       Fixture scenario from intelli-git-test
  --renderer-port <port>  Workbench and webview Chromium CDP port
  --extension-port <port> Extension Host Node inspector port
  --base-dir <path>       Short fixture and isolated VS Code profile root
  --code-bin <path>       VS Code executable or command
  --no-compile            Skip npm run compile
  --reuse-fixture         Reuse an existing fixture instead of recreating it
  --break-extension       Pause Extension Host startup until resume-extension
  --ready-timeout <sec>   Startup readiness timeout; default 30
  --list                  List fixture scenarios
  -h, --help              Show this help

Environment:
  INTELLI_GIT_REPO_ROOT
  INTELLI_GIT_RENDERER_PORT
  INTELLI_GIT_EXTENSION_PORT
  INTELLI_GIT_DEBUG_BASE_DIR
  INTELLI_GIT_DEBUG_CODE_BIN
  INTELLI_GIT_DEBUG_COMPILE=0
  INTELLI_GIT_DEBUG_REUSE_FIXTURE=1
  INTELLI_GIT_DEBUG_READY_TIMEOUT
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

resolve_code_bin() {
    local requested="$1"
    local mac_code="/Applications/Visual Studio Code.app/Contents/MacOS/Code"

    if [[ -z "$requested" && -x "$mac_code" ]]; then
        printf '%s\n' "$mac_code"
        return
    fi

    if [[ -z "$requested" ]]; then
        requested="code"
    fi

    if [[ "$requested" == */* ]]; then
        [[ -x "$requested" ]] || die "VS Code executable not found: $requested"
        printf '%s\n' "$requested"
        return
    fi

    command -v "$requested" >/dev/null 2>&1 || die "VS Code command not found: $requested"
    command -v "$requested"
}

validate_port() {
    local label="$1"
    local value="$2"
    [[ "$value" =~ ^[0-9]+$ ]] || die "$label must be an integer: $value"
    (( value >= 1024 && value <= 65535 )) || die "$label must be between 1024 and 65535: $value"
}

validate_profile_path() {
    local user_data_dir="$1"
    local socket_probe="$user_data_dir/1.12-main.sock"
    local byte_count

    byte_count="$(LC_ALL=C printf '%s' "$socket_probe" | wc -c | tr -d ' ')"
    (( byte_count <= 100 )) || die "VS Code profile path is too long for a safe macOS IPC socket ($byte_count bytes): $user_data_dir. Use a shorter --base-dir under /tmp."
}

port_is_listening() {
    local port="$1"
    command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

print_failure_logs() {
    local latest_logs=""
    local file=""

    if [[ -d "$user_data_dir/logs" ]]; then
        latest_logs="$(find "$user_data_dir/logs" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
    fi

    log "Debug host startup evidence"
    if [[ -f "$host_stdio_log" ]]; then
        printf '%s\n' "--- $host_stdio_log"
        tail -n 80 "$host_stdio_log" || true
    fi

    if [[ -n "$latest_logs" ]]; then
        for file in \
            "$latest_logs/main.log" \
            "$latest_logs/window1/renderer.log" \
            "$latest_logs/window1/exthost/exthost.log" \
            "$latest_logs/window1/exthost/boyan01.intelli-git/Intelli Git.log"; do
            if [[ -f "$file" ]]; then
                printf '%s\n' "--- $file"
                tail -n 80 "$file" || true
            fi
        done
    fi
}

scenario="merge-conflict"
renderer_port="${INTELLI_GIT_RENDERER_PORT:-9333}"
extension_port="${INTELLI_GIT_EXTENSION_PORT:-9229}"
base_dir="${INTELLI_GIT_DEBUG_BASE_DIR:-}"
code_bin="${INTELLI_GIT_DEBUG_CODE_BIN:-}"
compile="${INTELLI_GIT_DEBUG_COMPILE:-1}"
reuse_fixture="${INTELLI_GIT_DEBUG_REUSE_FIXTURE:-0}"
ready_timeout="${INTELLI_GIT_DEBUG_READY_TIMEOUT:-30}"
break_extension="0"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --scenario)
            [[ $# -ge 2 ]] || die "--scenario requires a value"
            scenario="$2"
            shift 2
            ;;
        --renderer-port)
            [[ $# -ge 2 ]] || die "--renderer-port requires a value"
            renderer_port="$2"
            shift 2
            ;;
        --extension-port)
            [[ $# -ge 2 ]] || die "--extension-port requires a value"
            extension_port="$2"
            shift 2
            ;;
        --base-dir)
            [[ $# -ge 2 ]] || die "--base-dir requires a value"
            base_dir="$2"
            shift 2
            ;;
        --code-bin)
            [[ $# -ge 2 ]] || die "--code-bin requires a value"
            code_bin="$2"
            shift 2
            ;;
        --no-compile)
            compile="0"
            shift
            ;;
        --reuse-fixture)
            reuse_fixture="1"
            shift
            ;;
        --break-extension)
            break_extension="1"
            shift
            ;;
        --ready-timeout)
            [[ $# -ge 2 ]] || die "--ready-timeout requires a value"
            ready_timeout="$2"
            shift 2
            ;;
        --list)
            require_file "$FIXTURE_LAUNCHER"
            exec bash "$FIXTURE_LAUNCHER" --list
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

[[ "$scenario" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "invalid scenario name: $scenario"
validate_port "renderer port" "$renderer_port"
validate_port "extension port" "$extension_port"
[[ "$renderer_port" != "$extension_port" ]] || die "renderer and extension ports must differ"
[[ "$ready_timeout" =~ ^[0-9]+$ ]] || die "readiness timeout must be an integer: $ready_timeout"
(( ready_timeout > 0 )) || die "readiness timeout must be greater than zero"
[[ "$compile" == "0" || "$compile" == "1" ]] || die "INTELLI_GIT_DEBUG_COMPILE must be 0 or 1"
[[ "$reuse_fixture" == "0" || "$reuse_fixture" == "1" ]] || die "INTELLI_GIT_DEBUG_REUSE_FIXTURE must be 0 or 1"

require_file "$FIXTURE_LAUNCHER"
require_file "$EXTENSION_DEV_PATH/package.json"
require_file "$CONTROLLER"
command -v node >/dev/null 2>&1 || die "Node.js is required"
command -v curl >/dev/null 2>&1 || die "curl is required"

if [[ -z "$base_dir" ]]; then
    base_dir="/tmp/ig-debug-$scenario-$renderer_port"
fi

base_dir_abs="$(abs_from_repo "$base_dir")"
worktree_dir="$base_dir_abs/test-git-checkout"
user_data_dir="$base_dir_abs/vscode-user-data"
extensions_dir="$base_dir_abs/vscode-extensions"
shared_data_dir="$base_dir_abs/vscode-shared-data"
state_file="$base_dir_abs/debug-host.json"
host_stdio_log="$base_dir_abs/debug-host-stdio.log"
code_bin="$(resolve_code_bin "$code_bin")"
validate_profile_path "$user_data_dir"

for port in "$renderer_port" "$extension_port"; do
    if port_is_listening "$port"; then
        lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
        die "debug port is already in use: $port"
    fi
done

if [[ "$compile" == "1" ]]; then
    log "Compiling current extension output"
    (cd "$REPO_ROOT" && npm run compile)
fi

if [[ "$reuse_fixture" == "1" ]]; then
    [[ -e "$worktree_dir/.git" ]] || die "reusable fixture not found: $worktree_dir"
    log "Reusing Intelli Git fixture: $worktree_dir"
else
    log "Creating Intelli Git fixture scenario: $scenario"
    bash "$FIXTURE_LAUNCHER" "$scenario" --base-dir "$base_dir_abs" --no-open
fi

mkdir -p "$user_data_dir" "$extensions_dir" "$shared_data_dir"
: > "$host_stdio_log"

inspect_flag="--inspect-extensions=$extension_port"
if [[ "$break_extension" == "1" ]]; then
    inspect_flag="--inspect-brk-extensions=$extension_port"
fi

cat <<EOF

Debug host configuration:
  scenario:         $scenario
  process:          $code_bin
  base:             $base_dir_abs
  worktree:         $worktree_dir
  user data:        $user_data_dir
  shared data:      $shared_data_dir
  extension:        $EXTENSION_DEV_PATH
  renderer CDP:     http://127.0.0.1:$renderer_port
  extension CDP:    http://127.0.0.1:$extension_port
  startup paused:   $break_extension
EOF

log "Launching command-managed VS Code Extension Development Host"
"$code_bin" \
    --new-window \
    --disable-extensions \
    --disable-telemetry \
    --disable-updates \
    --disable-workspace-trust \
    --skip-welcome \
    --skip-release-notes \
    --skip-add-to-recently-opened \
    --user-data-dir "$user_data_dir" \
    --extensions-dir "$extensions_dir" \
    --shared-data-dir "$shared_data_dir" \
    "$inspect_flag" \
    "--remote-debugging-port=$renderer_port" \
    '--remote-allow-origins=*' \
    "--extensionDevelopmentPath=$EXTENSION_DEV_PATH" \
    "$worktree_dir" \
    > >(tee -a "$host_stdio_log") 2>&1 &
code_pid="$!"

stop_child() {
    if kill -0 "$code_pid" >/dev/null 2>&1; then
        kill "$code_pid" >/dev/null 2>&1 || true
        wait "$code_pid" 2>/dev/null || true
    fi
}

trap 'stop_child; exit 130' INT
trap 'stop_child; exit 143' TERM

renderer_url="http://127.0.0.1:$renderer_port/json/list"
extension_url="http://127.0.0.1:$extension_port/json/list"
deadline=$((SECONDS + ready_timeout))
ready="0"

while (( SECONDS < deadline )); do
    if ! kill -0 "$code_pid" >/dev/null 2>&1; then
        set +e
        wait "$code_pid"
        code_status="$?"
        set -e
        trap - INT TERM
        print_failure_logs
        die "VS Code exited before debug endpoints became ready (exit $code_status)"
    fi

    renderer_json="$(curl --silent --fail --max-time 1 "$renderer_url" 2>/dev/null || true)"
    extension_json="$(curl --silent --fail --max-time 1 "$extension_url" 2>/dev/null || true)"

    if [[ -n "$renderer_json" && -n "$extension_json" ]] && \
        RENDERER_JSON="$renderer_json" EXTENSION_JSON="$extension_json" node -e '
            const renderer = JSON.parse(process.env.RENDERER_JSON);
            const extension = JSON.parse(process.env.EXTENSION_JSON);
            const host = renderer.find((target) => target.type === "page" && target.title.startsWith("[Extension Development Host]"));
            const inspector = extension.find((target) => target.type === "node");
            process.exit(host && inspector ? 0 : 1);
        '; then
        ready="1"
        break
    fi

    sleep 0.25
done

if [[ "$ready" != "1" ]]; then
    print_failure_logs
    stop_child
    trap - INT TERM
    die "debug endpoints did not become ready within $ready_timeout seconds"
fi

STATE_FILE="$state_file" \
SCENARIO="$scenario" \
REPO_ROOT_VALUE="$REPO_ROOT" \
EXTENSION_DEV_PATH_VALUE="$EXTENSION_DEV_PATH" \
EXTENSION_ID_VALUE="boyan01.intelli-git" \
BASE_DIR_VALUE="$base_dir_abs" \
WORKTREE_DIR_VALUE="$worktree_dir" \
USER_DATA_DIR_VALUE="$user_data_dir" \
EXTENSIONS_DIR_VALUE="$extensions_dir" \
SHARED_DATA_DIR_VALUE="$shared_data_dir" \
HOST_STDIO_LOG_VALUE="$host_stdio_log" \
CODE_BIN_VALUE="$code_bin" \
CODE_PID_VALUE="$code_pid" \
RENDERER_PORT_VALUE="$renderer_port" \
EXTENSION_PORT_VALUE="$extension_port" \
BREAK_EXTENSION_VALUE="$break_extension" \
node <<'NODE'
const fs = require('fs');

const state = {
    schemaVersion: 1,
    scenario: process.env.SCENARIO,
    repoRoot: process.env.REPO_ROOT_VALUE,
    extensionDevelopmentPath: process.env.EXTENSION_DEV_PATH_VALUE,
    extensionId: process.env.EXTENSION_ID_VALUE,
    baseDir: process.env.BASE_DIR_VALUE,
    worktreeDir: process.env.WORKTREE_DIR_VALUE,
    userDataDir: process.env.USER_DATA_DIR_VALUE,
    extensionsDir: process.env.EXTENSIONS_DIR_VALUE,
    sharedDataDir: process.env.SHARED_DATA_DIR_VALUE,
    hostStdioLog: process.env.HOST_STDIO_LOG_VALUE,
    codeBin: process.env.CODE_BIN_VALUE,
    codePid: Number(process.env.CODE_PID_VALUE),
    rendererPort: Number(process.env.RENDERER_PORT_VALUE),
    extensionPort: Number(process.env.EXTENSION_PORT_VALUE),
    breakExtension: process.env.BREAK_EXTENSION_VALUE === '1',
    startedAt: new Date().toISOString(),
};

fs.writeFileSync(process.env.STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
NODE

cat <<EOF

DEBUG HOST READY
  state:             $state_file
  controller:        node $CONTROLLER
  status:            node $CONTROLLER status --state $state_file
  logs:              node $CONTROLLER logs --state $state_file
  reload window:     node $CONTROLLER reload-window --state $state_file
  reload webviews:   node $CONTROLLER reload-webviews --state $state_file
  stop:              node $CONTROLLER stop --state $state_file

Keep this terminal session running. Ctrl-C here also stops only this host.
EOF

set +e
wait "$code_pid"
code_status="$?"
set -e
trap - INT TERM
exit "$code_status"
