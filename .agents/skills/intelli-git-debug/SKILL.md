---
name: intelli-git-debug
description: Launch, control, inspect, reload, and stop a real Intelli Git VS Code Extension Development Host entirely from commands, with an isolated fixture, Extension Host Node inspector, renderer/webview CDP, owned process state, and direct log access. Use when Codex must reproduce or verify extension-host or webview behavior without clicking the source VS Code Run Extension UI or relying on Debug Console, especially for Monaco, focus, layout, CSP, rendering, lifecycle, and interaction bugs.
---

# Intelli Git Debug

Use the bundled launcher and controller. Do not click the source VS Code **Run Extension** button. Do not read the source window's Debug Console.

The launcher recreates the useful behavior behind the checked-in `extensionHost` launch configuration:

- `--extensionDevelopmentPath` loads the current Intelli Git extension;
- `--inspect-extensions` exposes the Node Extension Host;
- `--remote-debugging-port` exposes the Development Host workbench and webviews;
- isolated short user-data, extension, and shared-data directories provide deterministic state and logs while avoiding the macOS IPC path limit;
- a state file owns the exact process, ports, fixture, profile, and logs.

This is functional parity, not byte-for-byte launch-adapter parity. VS Code's JavaScript debug adapter also injects `--debugId` and normally `--inspect-brk-extensions` through an internal `launchVSCodeRequest`. A standalone command must use the public inspector endpoints directly.

## Start the Host

Run from the repository root in an attached terminal session:

```bash
bash .agents/skills/intelli-git-debug/scripts/launch-debug-host.sh merge-conflict
```

Wait for `DEBUG HOST READY`. The launcher compiles by default, delegates fixture construction to `$intelli-git-test`, creates the Dev Host window directly, and verifies both inspectors before reporting success.

Useful options:

- `--no-compile`: use only after confirming an existing watcher has produced current output.
- `--reuse-fixture`: keep the current Git scenario while restarting the host.
- `--renderer-port <port>` and `--extension-port <port>`: isolate parallel runs.
- `--base-dir <path>`: override the default `/tmp/ig-debug-<scenario>-<port>` root.
- `--break-extension`: use `--inspect-brk-extensions`; run `resume-extension` after attaching.
- `--list`: list supported Git fixtures.

Never start or stop an existing `npm run watch:extension` process unless this task created and owns its exact terminal session. The launcher owns only the Code process it starts.

## Use the State File

The ready output prints a state path, for example:

```bash
STATE=/tmp/ig-debug-merge-conflict-9333/debug-host.json
CONTROL=.agents/skills/intelli-git-debug/scripts/debug-host-control.mjs
```

Pass that file to every controller command:

```bash
node "$CONTROL" status --state "$STATE"
```

`status` must show:

- `running: true`;
- `owned: true`;
- a renderer target titled `[Extension Development Host] ...`;
- a Node Extension Host target.

If startup fails, use the evidence printed by the launcher. It automatically tails isolated process, main, renderer, Extension Host, and Intelli Git logs instead of waiting for a UI surface.

## Read Logs and Inspect the Extension Host

Read the isolated log files directly:

```bash
node "$CONTROL" logs --state "$STATE" --lines 120
```

Evaluate through the Extension Host inspector:

```bash
node "$CONTROL" extension-eval --state "$STATE" \
  '({ pid: process.pid, execArgv: process.execArgv, cwd: process.cwd() })'
```

Inspector expressions run in the Extension Host utility-process context. `process`, `console`, and standard globals are available, but global `require` and the `vscode` module are not. Use Intelli Git's isolated log file or a source breakpoint when extension-scoped API access is required.

For startup breakpoints:

```bash
bash .agents/skills/intelli-git-debug/scripts/launch-debug-host.sh \
  merge-conflict \
  --break-extension

node "$CONTROL" resume-extension --state "$STATE"
```

Use inspector expressions for targeted runtime evidence. Use the generated `Intelli Git.log`, `exthost.log`, and `renderer.log` for durable logs. Do not substitute speculation when the inspector or isolated logs are available.

## Inspect the Real Webview

Open Intelli Git surfaces through renderer CDP. For example, use the workbench target to select the Commit activity and then the conflicted file. Enumerate rendered Intelli Git contexts before choosing one:

```bash
node "$CONTROL" workbench-eval --state "$STATE" \
  'document.querySelector(`a[aria-label="Commit"]`)?.click()'

node "$CONTROL" webview-targets --state "$STATE"
```

Open the standard merge-conflict resolver deterministically:

```bash
node "$CONTROL" webview-eval --state "$STATE" --contains 'Conflicting Changes' \
  '(() => { const item = [...document.querySelectorAll(`[role="treeitem"]`)].find((element) => element.textContent?.includes("Conflicting Changes")); item?.click(); return { found: Boolean(item), expanded: item?.getAttribute("aria-expanded") }; })()'

node "$CONTROL" webview-eval --state "$STATE" --contains 'Conflicting Changes' \
  '(() => { const item = [...document.querySelectorAll(`[role="treeitem"]`)].find((element) => element.getAttribute("aria-level") === "2" && element.textContent?.trim() === "src"); item?.click(); return { found: Boolean(item), expanded: item?.getAttribute("aria-expanded") }; })()'

node "$CONTROL" webview-eval --state "$STATE" --contains 'Conflicting Changes' \
  '(() => { const item = [...document.querySelectorAll(`[role="treeitem"]`)].find((element) => element.textContent?.trim() === "conflict.txt"); item?.click(); return { found: Boolean(item), selected: item?.getAttribute("aria-selected") }; })()'
```

Then enumerate targets again and select the context whose URL contains `#/conflict-resolver` or whose title is `Merge: conflict.txt`.

Select a context by visible text or route and evaluate real DOM state:

```bash
node "$CONTROL" webview-eval \
  --state "$STATE" \
  --contains 'Conflict Resolver' \
  '(() => {
    const element = document.querySelector("<selector>");
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      styleAttribute: element.getAttribute("style"),
      cssText: element.style.cssText,
      display: style.display,
      visibility: style.visibility,
      top: style.top,
      height: style.height,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  })()'
```

VS Code often exposes an outer webview frame plus a rendered inner frame. The controller selects rendered contexts by actual visible text; do not assume the first iframe is interactive.

For Monaco issues, inspect both the target node and its positioned parent before interaction, after focus, and after blur. Check CSP errors and CSSOM state before changing Monaco layout code.

## Reload Without UI Automation

After rebuilding extension code, reload the complete Development Host:

```bash
node "$CONTROL" reload-window --state "$STATE"
```

The command is successful only after a new Extension Host inspector target appears and the Development Host workbench is ready again.
It also reports `webviewsBefore`, `webviewsAfter`, and `missingWebviews`. A window reload can legitimately discard an editor-area conflict resolver; reopen every missing debugging surface before continuing DOM assertions.

After rebuilding only webview code, reload active webviews:

```bash
node "$CONTROL" reload-webviews --state "$STATE"
```

When an Intelli Git webview is active, the controller verifies that its rendered frame or `performance.timeOrigin` changed. If none is active, it reports that the command ran but reload verification was unavailable.

Run another workbench command by its exact English title when needed:

```bash
node "$CONTROL" workbench-command \
  --state "$STATE" \
  'Developer: Show Running Extensions'
```

These operations use the Dev Host's renderer CDP. They do not click the source VS Code UI and do not depend on macOS application selection.

## Verify and Clean Up

Use the same fixture, viewport, selectors, and action sequence before and after a change:

1. Reproduce the failure in the command-managed host.
2. Capture Extension Host, webview DOM, computed-style, and log evidence as applicable.
3. Apply the smallest relevant change.
4. Compile or wait for the owned watcher.
5. Reload the correct runtime layer through the controller.
6. Repeat focus/blur or paint-sensitive interactions multiple times.
7. Run focused tests, then broader repository checks in proportion to risk.

Stop only the state-owned process:

```bash
node "$CONTROL" stop --state "$STATE"
```

The controller validates the PID command line against both the isolated user-data path and extension development path before sending `SIGTERM`. `Ctrl-C` in the attached launcher session is also safe. Never use `pkill`, `killall`, or bundle-wide VS Code termination.
