import * as vscode from 'vscode';

let outputChannel: vscode.LogOutputChannel | undefined;

const REDACTION_PATTERNS: RegExp[] = [
    /(sk-[A-Za-z0-9_-]{12,})/g,
    /(AIza[0-9A-Za-z_-]{20,})/g,
    /(sk-ant-[A-Za-z0-9_-]{12,})/g,
    /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
    /((?:api[-_ ]?key|x-api-key|x-goog-api-key|authorization)["'\s:=]+)["']?([^"',\s}]{8,})/gi,
];

function initLogger(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel('Intelli Git', { log: true });
    context.subscriptions.push(outputChannel);
}

function consoleLog(type: 'info' | 'error' | 'warn' | 'debug', ...args: unknown[]): void {
    const ts = new Date().toISOString();
    console.log(`[Intelli Git] ${ts} [${type.toLowerCase()}] ${formatMessage(...args)}`);
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
    return args
        .map((arg) => {
            const value = prepareLogValue(arg);
            const message = stringifyValue(value);
            return shouldStartOnNewLine(value) ? `\n${message}` : message;
        })
        .join(' ')
        .replace(/ \n/g, '\n');
}

function stringifyValue(value: unknown): string {
    if (value instanceof Error) {
        return value.stack || value.message;
    }

    if (isFlatLogRecord(value)) {
        return Object.entries(value)
            .map(([key, nestedValue]) => `${key}=${formatFlatLogValue(nestedValue)}`)
            .join(' ');
    }

    if (typeof value === 'object') {
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    }

    return String(value);
}

function shouldStartOnNewLine(value: unknown): boolean {
    return Boolean(value && typeof value === 'object' && !(value instanceof Error) && !isFlatLogRecord(value));
}

function isFlatLogRecord(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || value instanceof Error || Array.isArray(value)) {
        return false;
    }

    return Object.values(value).every((nestedValue) => {
        return (
            nestedValue === null ||
            nestedValue === undefined ||
            typeof nestedValue === 'string' ||
            typeof nestedValue === 'number' ||
            typeof nestedValue === 'boolean' ||
            typeof nestedValue === 'bigint'
        );
    });
}

function formatFlatLogValue(value: unknown): string {
    if (typeof value === 'string') {
        return value && /^[^\s"'=]+$/.test(value) ? value : JSON.stringify(value);
    }

    return String(value);
}

function prepareLogValue(value: unknown): unknown {
    if (value instanceof Error) {
        return value;
    }

    if (typeof value === 'string') {
        return compactWorkspacePaths(redactString(value));
    }

    if (Array.isArray(value)) {
        return value.map(prepareLogValue);
    }

    if (value && typeof value === 'object') {
        const redacted: Record<string, unknown> = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            if (/api[-_ ]?key|authorization|token|secret/i.test(key)) {
                redacted[key] = '[redacted]';
            } else {
                redacted[key] = prepareLogValue(nestedValue);
            }
        }
        return redacted;
    }

    return value;
}

function compactWorkspacePaths(value: string): string {
    const workspaceRoots = getWorkspaceRootPaths();
    if (!workspaceRoots.length) {
        return value;
    }

    return workspaceRoots.reduce(
        (message, workspaceRoot) => {
            const escapedRoot = escapeRegExp(workspaceRoot);
            return message
                .replace(new RegExp(`${escapedRoot}/`, 'g'), '')
                .replace(new RegExp(`${escapedRoot}(?=$|[\\s"'\\)\\]\\},])`, 'g'), '.');
        },
        value.replace(/\\/g, '/')
    );
}

function getWorkspaceRootPaths(): string[] {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const roots = workspaceFolders
        .map((folder) => folder.uri.fsPath)
        .filter(Boolean)
        .map((root) => root.replace(/\\/g, '/').replace(/\/+$/, ''));

    return Array.from(new Set(roots)).sort((a, b) => b.length - a.length);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactString(value: string): string {
    return REDACTION_PATTERNS.reduce((message, pattern) => {
        if (pattern.source.includes('Bearer')) {
            return message.replace(pattern, '$1[redacted]');
        }
        if (pattern.source.includes('api')) {
            return message.replace(pattern, '$1[redacted]');
        }
        return message.replace(pattern, '[redacted]');
    }, value);
}

export const logger = {
    info,
    error,
    warn,
    debug,
    showOutputChannel,
    initLogger,
};
