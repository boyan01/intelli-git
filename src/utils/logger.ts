import * as vscode from 'vscode';

let outputChannel: vscode.LogOutputChannel | undefined;

export function initLogger(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel('Intelli Git', { log: true });
    context.subscriptions.push(outputChannel);
}

export function log(...args: unknown[]): void {
    const message = formatMessage(...args);
    outputChannel?.info(message);
}

export function logError(...args: unknown[]): void {
    const message = formatMessage(...args);
    outputChannel?.error(message);
}

export function logWarn(...args: unknown[]): void {
    const message = formatMessage(...args);
    outputChannel?.warn(message);
}

export function logDebug(...args: unknown[]): void {
    const message = formatMessage(...args);
    outputChannel?.debug(message);
}

export function showOutputChannel(): void {
    outputChannel?.show();
}

function formatMessage(...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] ` + args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
}
