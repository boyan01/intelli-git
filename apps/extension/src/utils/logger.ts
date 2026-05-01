import * as vscode from 'vscode';

let outputChannel: vscode.LogOutputChannel | undefined;

const REDACTION_PATTERNS: RegExp[] = [
    /(sk-[A-Za-z0-9_-]{12,})/g,
    /(AIza[0-9A-Za-z_-]{20,})/g,
    /(sk-ant-[A-Za-z0-9_-]{12,})/g,
    /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
    /((?:api[-_ ]?key|x-api-key|x-goog-api-key|authorization)["'\s:=]+)["']?([^"',\s}]{8,})/gi
];

function initLogger(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel('Intelli Git', { log: true });
    context.subscriptions.push(outputChannel);
}

function consoleLog(type: 'info' | 'error' | 'warn' | 'debug', ...args: unknown[]): void {
    const ts = new Date().toISOString();
    console.log(`[Intelli Git] ${ts} [${type.toLowerCase()}]`, ...args.map(redactValue));
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
    return args.map(arg => stringifyValue(redactValue(arg))).join(' ');
}

function stringifyValue(value: unknown): string {
    if (value instanceof Error) {
        return value.stack || value.message;
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

function redactValue(value: unknown): unknown {
    if (value instanceof Error) {
        return value;
    }

    if (typeof value === 'string') {
        return redactString(value);
    }

    if (Array.isArray(value)) {
        return value.map(redactValue);
    }

    if (value && typeof value === 'object') {
        const redacted: Record<string, unknown> = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            if (/api[-_ ]?key|authorization|token|secret/i.test(key)) {
                redacted[key] = '[redacted]';
            } else {
                redacted[key] = redactValue(nestedValue);
            }
        }
        return redacted;
    }

    return value;
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
}
