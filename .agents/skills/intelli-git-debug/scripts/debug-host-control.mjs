#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 10_000;

function printUsage() {
    console.log(`Usage:
  debug-host-control.mjs status --state <debug-host.json>
  debug-host-control.mjs logs --state <debug-host.json> [--lines <count>]
  debug-host-control.mjs stop --state <debug-host.json>
  debug-host-control.mjs reload-window --state <debug-host.json>
  debug-host-control.mjs reload-webviews --state <debug-host.json>
  debug-host-control.mjs workbench-command --state <debug-host.json> <command title>
  debug-host-control.mjs workbench-eval --state <debug-host.json> <expression>
  debug-host-control.mjs extension-eval --state <debug-host.json> <expression>
  debug-host-control.mjs resume-extension --state <debug-host.json>
  debug-host-control.mjs webview-targets --state <debug-host.json>
  debug-host-control.mjs webview-eval --state <debug-host.json> [--contains <text>] <expression>

Options:
  --state <path>     State file printed by launch-debug-host.sh
  --contains <text>  Match a rendered webview by URL or visible text
  --lines <count>    Log lines per file; default 80
  --timeout <ms>     Operation timeout; default ${DEFAULT_TIMEOUT_MS}
  --                 Stop option parsing before an expression
`);
}

function fail(message) {
    throw new Error(message);
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseArguments(argv) {
    const command = argv.shift();
    const options = {
        state: process.env.INTELLI_GIT_DEBUG_STATE || '',
        contains: '',
        lines: 80,
        timeout: DEFAULT_TIMEOUT_MS,
    };
    const positionals = [];
    let parseOptions = true;

    while (argv.length > 0) {
        const value = argv.shift();
        if (parseOptions && value === '--') {
            parseOptions = false;
            continue;
        }
        if (parseOptions && value === '--state') {
            options.state = argv.shift() || fail('--state requires a value');
            continue;
        }
        if (parseOptions && value === '--contains') {
            options.contains = argv.shift() || fail('--contains requires a value');
            continue;
        }
        if (parseOptions && value === '--lines') {
            options.lines = Number(argv.shift() || fail('--lines requires a value'));
            continue;
        }
        if (parseOptions && value === '--timeout') {
            options.timeout = Number(argv.shift() || fail('--timeout requires a value'));
            continue;
        }
        if (parseOptions && value.startsWith('--')) {
            fail(`unknown option: ${value}`);
        }
        positionals.push(value);
    }

    if (!Number.isInteger(options.lines) || options.lines <= 0) {
        fail('--lines must be a positive integer');
    }
    if (!Number.isInteger(options.timeout) || options.timeout <= 0) {
        fail('--timeout must be a positive integer');
    }

    return { command, options, positionals };
}

function loadState(statePath) {
    if (!statePath) {
        fail('--state is required');
    }
    const absolutePath = path.resolve(statePath);
    const state = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    const required = [
        'extensionDevelopmentPath',
        'extensionId',
        'userDataDir',
        'hostStdioLog',
        'codePid',
        'rendererPort',
        'extensionPort',
    ];
    for (const key of required) {
        if (state[key] === undefined || state[key] === null || state[key] === '') {
            fail(`state is missing required field: ${key}`);
        }
    }
    return { ...state, statePath: absolutePath };
}

function processIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function processCommand(pid) {
    try {
        return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
    } catch {
        return '';
    }
}

async function fetchTargets(port, required = true) {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
            signal: AbortSignal.timeout(1_500),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        if (required) {
            fail(`debug endpoint is unavailable on port ${port}: ${error.message}`);
        }
        return [];
    }
}

async function waitUntil(callback, timeoutMs, intervalMs = 150) {
    const deadline = Date.now() + timeoutMs;
    let lastValue;
    while (Date.now() < deadline) {
        lastValue = await callback();
        if (lastValue) {
            return lastValue;
        }
        await delay(intervalMs);
    }
    return undefined;
}

class CdpClient {
    constructor(webSocketUrl) {
        if (typeof WebSocket !== 'function') {
            fail('Node.js with global WebSocket support is required for CDP commands. Use the bundled Codex Node runtime from load_workspace_dependencies.');
        }
        this.webSocketUrl = webSocketUrl;
        this.socket = undefined;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
    }

    async connect() {
        this.socket = new WebSocket(this.webSocketUrl);
        this.socket.addEventListener('message', (event) => this.handleMessage(event.data));
        this.socket.addEventListener('close', () => this.rejectPending('CDP connection closed'));
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`CDP connection timed out: ${this.webSocketUrl}`)), 5_000);
            this.socket.addEventListener('open', () => {
                clearTimeout(timer);
                resolve();
            }, { once: true });
            this.socket.addEventListener('error', (event) => {
                clearTimeout(timer);
                reject(new Error(event.message || `CDP connection failed: ${this.webSocketUrl}`));
            }, { once: true });
        });
    }

    on(method, listener) {
        const listeners = this.listeners.get(method) || [];
        listeners.push(listener);
        this.listeners.set(method, listeners);
    }

    handleMessage(rawMessage) {
        const message = JSON.parse(rawMessage);
        if (message.id !== undefined) {
            const pending = this.pending.get(message.id);
            if (!pending) {
                return;
            }
            this.pending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.error) {
                pending.reject(new Error(message.error.message));
            } else {
                pending.resolve(message.result);
            }
            return;
        }

        for (const listener of this.listeners.get(message.method) || []) {
            listener(message.params);
        }
    }

    rejectPending(message) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(message));
        }
        this.pending.clear();
    }

    send(method, params = {}) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            fail('CDP connection is not open');
        }
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP request timed out: ${method}`));
            }, 5_000);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    close() {
        this.socket?.close();
    }
}

function remoteObjectValue(remoteObject) {
    if (Object.prototype.hasOwnProperty.call(remoteObject, 'value')) {
        return remoteObject.value;
    }
    return remoteObject.unserializableValue ?? remoteObject.description;
}

async function evaluate(client, expression, contextId) {
    const result = await client.send('Runtime.evaluate', {
        expression,
        contextId,
        awaitPromise: true,
        returnByValue: true,
    });
    if (result.exceptionDetails) {
        const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
        fail(`evaluation failed: ${detail}`);
    }
    return remoteObjectValue(result.result);
}

async function inspectTargetContexts(target) {
    const client = new CdpClient(target.webSocketDebuggerUrl);
    const contexts = [];
    client.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
    await client.connect();
    await client.send('Runtime.enable');
    await delay(150);

    const inspected = [];
    for (const context of contexts.filter((item) => item.auxData?.isDefault)) {
        try {
            const value = await evaluate(client, `({
                name: window.name,
                url: location.href,
                title: document.title,
                text: document.body?.innerText?.slice(0, 500) || '',
                timeOrigin: performance.timeOrigin,
            })`, context.id);
            inspected.push({
                targetId: target.id,
                targetUrl: target.url,
                contextId: context.id,
                frameId: context.auxData.frameId,
                ...value,
            });
        } catch {
            // A context can disappear while a webview reloads.
        }
    }

    return { client, contexts: inspected };
}

async function renderedWebviews(state) {
    const targets = await fetchTargets(state.rendererPort);
    const webviewTargets = targets.filter((target) =>
        target.type === 'iframe' && target.url.includes(`extensionId=${state.extensionId}`));
    const rendered = [];

    for (const target of webviewTargets) {
        const inspected = await inspectTargetContexts(target);
        rendered.push(...inspected.contexts.filter((context) => context.text));
        inspected.client.close();
    }

    return rendered;
}

async function evaluateWebview(state, contains, expression) {
    const targets = await fetchTargets(state.rendererPort);
    const webviewTargets = targets.filter((target) =>
        target.type === 'iframe' && target.url.includes(`extensionId=${state.extensionId}`));

    for (const target of webviewTargets) {
        const inspected = await inspectTargetContexts(target);
        const context = inspected.contexts.find((item) =>
            item.text && (!contains || item.text.includes(contains) || item.url.includes(contains)));
        if (!context) {
            inspected.client.close();
            continue;
        }
        const value = await evaluate(inspected.client, expression, context.contextId);
        inspected.client.close();
        return { targetId: context.targetId, frameId: context.frameId, url: context.url, value };
    }

    fail(contains
        ? `no rendered Intelli Git webview matched: ${contains}`
        : 'no rendered Intelli Git webview is active');
}

async function runWorkbenchCommand(state, commandTitle) {
    const targets = await fetchTargets(state.rendererPort);
    const pageTarget = targets.find((target) =>
        target.type === 'page' && target.title.startsWith('[Extension Development Host]'));
    if (!pageTarget) {
        fail('Extension Development Host workbench target not found');
    }

    const client = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');

    const dispatchKey = (type, key, code, windowsVirtualKeyCode, modifiers = 0, nativeVirtualKeyCode = windowsVirtualKeyCode) =>
        client.send('Input.dispatchKeyEvent', {
            type,
            key,
            code,
            modifiers,
            windowsVirtualKeyCode,
            nativeVirtualKeyCode,
        });

    await dispatchKey('keyDown', 'Escape', 'Escape', 27);
    await dispatchKey('keyUp', 'Escape', 'Escape', 27);

    const modifiers = process.platform === 'darwin' ? 12 : 10;
    const nativeP = process.platform === 'darwin' ? 35 : 80;
    await dispatchKey('keyDown', 'P', 'KeyP', 80, modifiers, nativeP);
    await dispatchKey('keyUp', 'P', 'KeyP', 80, modifiers, nativeP);
    await delay(150);
    await client.send('Input.insertText', { text: commandTitle });

    const escapedTitle = JSON.stringify(commandTitle);
    const rows = await waitUntil(async () => {
        const values = await evaluate(client, `Array.from(document.querySelectorAll('.quick-input-list .monaco-list-row'))
            .map((row) => ({ label: row.innerText.split('\\n')[0], text: row.innerText }))`);
        return values.some((row) => row.label === commandTitle) ? values : undefined;
    }, 3_000, 100);

    if (!rows) {
        client.close();
        fail(`workbench command not found: ${commandTitle}`);
    }

    const clicked = await evaluate(client, `(() => {
        const row = Array.from(document.querySelectorAll('.quick-input-list .monaco-list-row'))
            .find((item) => item.innerText.split('\\n')[0] === ${escapedTitle});
        if (!row) return false;
        row.click();
        return true;
    })()`);
    client.close();
    if (!clicked) {
        fail(`failed to execute workbench command: ${commandTitle}`);
    }
    return { command: commandTitle, candidates: rows.map((row) => row.label) };
}

async function workbenchEvaluate(state, expression) {
    const targets = await fetchTargets(state.rendererPort);
    const target = targets.find((item) =>
        item.type === 'page' && item.title.startsWith('[Extension Development Host]'));
    if (!target) {
        fail('Extension Development Host workbench target not found');
    }
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');
    const value = await evaluate(client, expression);
    client.close();
    return { targetId: target.id, value };
}

function findLatestLogDirectory(userDataDir) {
    const logsRoot = path.join(userDataDir, 'logs');
    if (!fs.existsSync(logsRoot)) {
        return '';
    }
    return fs.readdirSync(logsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(logsRoot, entry.name))
        .sort()
        .at(-1) || '';
}

function walkFiles(directory) {
    if (!directory || !fs.existsSync(directory)) {
        return [];
    }
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFiles(entryPath));
        } else if (entry.isFile()) {
            files.push(entryPath);
        }
    }
    return files;
}

function relevantLogFiles(state) {
    const latest = findLatestLogDirectory(state.userDataDir);
    const names = new Set(['main.log', 'renderer.log', 'exthost.log', 'Intelli Git.log']);
    const files = walkFiles(latest).filter((file) => names.has(path.basename(file)));
    if (fs.existsSync(state.hostStdioLog)) {
        files.unshift(state.hostStdioLog);
    }
    return files;
}

function tailFile(file, lineCount) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - lineCount - 1)).join('\n');
}

async function status(state) {
    const rendererTargets = await fetchTargets(state.rendererPort, false);
    const extensionTargets = await fetchTargets(state.extensionPort, false);
    const command = processCommand(state.codePid);
    const owned = command.includes(state.userDataDir) && command.includes(state.extensionDevelopmentPath);
    return {
        state: state.statePath,
        pid: state.codePid,
        running: processIsAlive(state.codePid),
        owned,
        renderer: rendererTargets.find((target) => target.type === 'page') || null,
        extension: extensionTargets.find((target) => target.type === 'node') || null,
        latestLogs: findLatestLogDirectory(state.userDataDir),
    };
}

async function stop(state, timeoutMs) {
    if (!processIsAlive(state.codePid)) {
        return { stopped: true, alreadyStopped: true, pid: state.codePid };
    }
    const command = processCommand(state.codePid);
    if (!command.includes(state.userDataDir) || !command.includes(state.extensionDevelopmentPath)) {
        fail(`refusing to stop PID ${state.codePid}: process ownership does not match the state file`);
    }
    process.kill(state.codePid, 'SIGTERM');
    const stopped = await waitUntil(() => !processIsAlive(state.codePid), timeoutMs, 100);
    if (!stopped) {
        fail(`PID ${state.codePid} did not stop after SIGTERM within ${timeoutMs}ms`);
    }
    return { stopped: true, alreadyStopped: false, pid: state.codePid };
}

async function extensionEvaluate(state, expression) {
    const targets = await fetchTargets(state.extensionPort);
    const target = targets.find((item) => item.type === 'node');
    if (!target) {
        fail('Extension Host inspector target not found');
    }
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');
    const value = await evaluate(client, expression);
    client.close();
    return { targetId: target.id, value };
}

async function resumeExtension(state) {
    const targets = await fetchTargets(state.extensionPort);
    const target = targets.find((item) => item.type === 'node');
    if (!target) {
        fail('Extension Host inspector target not found');
    }
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.runIfWaitingForDebugger');
    client.close();
    return { targetId: target.id, resumed: true };
}

async function reloadWindow(state, timeoutMs) {
    const beforeWebviews = await renderedWebviews(state);
    const beforeTargets = await fetchTargets(state.extensionPort, false);
    const beforeId = beforeTargets.find((target) => target.type === 'node')?.id;
    const command = await runWorkbenchCommand(state, 'Developer: Reload Window');
    const after = await waitUntil(async () => {
        const rendererTargets = await fetchTargets(state.rendererPort, false);
        const extensionTargets = await fetchTargets(state.extensionPort, false);
        const renderer = rendererTargets.find((target) =>
            target.type === 'page' && target.title.startsWith('[Extension Development Host]'));
        const extension = extensionTargets.find((target) => target.type === 'node');
        if (!renderer || !extension || (beforeId && extension.id === beforeId)) {
            return undefined;
        }
        return { renderer, extension };
    }, timeoutMs, 200);
    if (!after) {
        fail(`window reload did not produce a ready Extension Host within ${timeoutMs}ms`);
    }

    let afterWebviews = [];
    if (beforeWebviews.length > 0) {
        const restoreTimeout = Math.min(3_000, Math.max(1_000, Math.floor(timeoutMs / 2)));
        afterWebviews = await waitUntil(async () => {
            const contexts = await renderedWebviews(state);
            return contexts.length > 0 ? contexts : undefined;
        }, restoreTimeout, 250) || [];
    }

    const identity = (context) => context.title || context.url.split('#')[1] || context.text.split('\n')[0];
    const afterIdentities = new Set(afterWebviews.map(identity));
    const missingWebviews = beforeWebviews.map(identity).filter((value) => !afterIdentities.has(value));
    return {
        ...command,
        beforeExtensionTargetId: beforeId || null,
        afterExtensionTargetId: after.extension.id,
        title: after.renderer.title,
        webviewsBefore: beforeWebviews.map((context) => ({ title: context.title, url: context.url })),
        webviewsAfter: afterWebviews.map((context) => ({ title: context.title, url: context.url })),
        missingWebviews,
        note: missingWebviews.length > 0
            ? 'The runtime reloaded successfully, but some editor webviews must be reopened before continuing DOM verification.'
            : undefined,
    };
}

function webviewSignature(context) {
    return `${context.targetId}:${context.frameId}:${context.timeOrigin}`;
}

async function reloadWebviews(state, timeoutMs) {
    const before = await renderedWebviews(state);
    const beforeSignatures = new Set(before.map(webviewSignature));
    const command = await runWorkbenchCommand(state, 'Developer: Reload Webviews');
    const after = await waitUntil(async () => {
        const contexts = await renderedWebviews(state);
        if (before.length === 0) {
            return contexts;
        }
        return contexts.some((context) => !beforeSignatures.has(webviewSignature(context)))
            ? contexts
            : undefined;
    }, timeoutMs, 250);

    return {
        ...command,
        verified: before.length > 0 && Boolean(after),
        before: before.map((context) => ({
            targetId: context.targetId,
            frameId: context.frameId,
            timeOrigin: context.timeOrigin,
            text: context.text.slice(0, 100),
        })),
        after: (after || []).map((context) => ({
            targetId: context.targetId,
            frameId: context.frameId,
            timeOrigin: context.timeOrigin,
            text: context.text.slice(0, 100),
        })),
        note: before.length === 0 ? 'Command executed, but no active rendered Intelli Git webview was available for reload verification.' : undefined,
    };
}

async function main() {
    const { command, options, positionals } = parseArguments(process.argv.slice(2));
    if (!command || command === '-h' || command === '--help') {
        printUsage();
        return;
    }
    const state = loadState(options.state);
    let result;

    switch (command) {
        case 'status':
            result = await status(state);
            break;
        case 'logs': {
            const files = relevantLogFiles(state);
            for (const file of files) {
                console.log(`--- ${file}`);
                console.log(tailFile(file, options.lines));
            }
            return;
        }
        case 'stop':
            result = await stop(state, options.timeout);
            break;
        case 'reload-window':
            result = await reloadWindow(state, options.timeout);
            break;
        case 'reload-webviews':
            result = await reloadWebviews(state, options.timeout);
            break;
        case 'workbench-command':
            if (positionals.length === 0) fail('workbench-command requires a command title');
            result = await runWorkbenchCommand(state, positionals.join(' '));
            break;
        case 'workbench-eval':
            if (positionals.length === 0) fail('workbench-eval requires an expression');
            result = await workbenchEvaluate(state, positionals.join(' '));
            break;
        case 'extension-eval':
            if (positionals.length === 0) fail('extension-eval requires an expression');
            result = await extensionEvaluate(state, positionals.join(' '));
            break;
        case 'resume-extension':
            result = await resumeExtension(state);
            break;
        case 'webview-targets':
            result = await renderedWebviews(state);
            break;
        case 'webview-eval':
            if (positionals.length === 0) fail('webview-eval requires an expression');
            result = await evaluateWebview(state, options.contains, positionals.join(' '));
            break;
        default:
            fail(`unknown command: ${command}`);
    }

    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
});
