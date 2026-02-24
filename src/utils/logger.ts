import * as vscode from 'vscode';

let outputChannel: vscode.LogOutputChannel | undefined;

function initLogger(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel('Intelli Git', { log: true });
    context.subscriptions.push(outputChannel);
}

function consoleLog(type: 'info' | 'error' | 'warn' | 'debug', ...args: unknown[]): void {
    const ts = new Date().toISOString();
    console.log(`[Intelli Git] ${ts} [${type.toLowerCase()}]`, ...args);
}

function info(...args: unknown[]): void {
    consoleLog('info', ...args);

    const message = formatMessage(...args);
    outputChannel?.info(message);
}

function error(...args: unknown[]): void {
    consoleLog('error', ...args);

    const message = formatMessage(...args);
    outputChannel?.error(message);
}

function warn(...args: unknown[]): void {
    consoleLog('warn', ...args);

    const message = formatMessage(...args);
    outputChannel?.warn(message);
}

function debug(...args: unknown[]): void {
    consoleLog('debug', ...args);

    const message = formatMessage(...args);
    outputChannel?.debug(message);
}

function showOutputChannel(): void {
    outputChannel?.show();
}

function formatMessage(...args: unknown[]): string {
    return args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
}

export const logger = {
    info,
    error,
    warn,
    debug,
    showOutputChannel,
    initLogger,
}