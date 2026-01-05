import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function initLogger(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel('Intelli Git');
    context.subscriptions.push(outputChannel);
}

export function log(...args: unknown[]): void {
    const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');

    const timestamp = new Date().toISOString().substring(11, 23);
    const formatted = `[${timestamp}] ${message}`;

    if (outputChannel) {
        outputChannel.appendLine(formatted);
    }
    console.log(formatted);
}

export function showOutputChannel(): void {
    outputChannel?.show();
}
