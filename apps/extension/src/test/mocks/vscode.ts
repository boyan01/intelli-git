let changelistMode = 'staged';
const executedCommands: Array<{ command: string; args: unknown[] }> = [];
const warningMessages: Array<{ message: string; args: unknown[] }> = [];
const informationMessages: Array<{ message: string; args: unknown[] }> = [];
const errorMessages: Array<{ message: string; args: unknown[] }> = [];
let workspaceFoldersValue: Array<{ uri: MockUri; name: string; index: number }> | undefined;
let warningMessageResponse: unknown;

export class EventEmitter<T> {
    private listeners = new Set<(event: T) => unknown>();

    public readonly event = (listener: (event: T) => unknown) => {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            }
        };
    };

    public fire(event: T): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }

    public dispose(): void {
        this.listeners.clear();
    }
}

export const ConfigurationTarget = {
    Workspace: 2
} as const;

export const workspace = {
    get workspaceFolders() {
        return workspaceFoldersValue;
    },
    onDidChangeWorkspaceFolders(listener: () => unknown) {
        return workspaceFolderEmitter.event(listener);
    },
    getConfiguration(section?: string) {
        return {
            get<T>(key: string, defaultValue: T): T {
                if (section === 'intelli-git' && key === 'changelist.mode') {
                    return changelistMode as T;
                }
                return defaultValue;
            },
            async update(key: string, value: unknown): Promise<void> {
                if (section === 'intelli-git' && key === 'changelist.mode') {
                    changelistMode = String(value);
                }
            }
        };
    },
    createFileSystemWatcher() {
        return {
            onDidChange() {
                return { dispose() { } };
            },
            onDidCreate() {
                return { dispose() { } };
            },
            onDidDelete() {
                return { dispose() { } };
            },
            dispose() { }
        };
    }
};

const workspaceFolderEmitter = new EventEmitter<void>();

class MockUri {
    public readonly path: string;
    public readonly query: string;
    public readonly fsPath: string;

    constructor(public readonly value: string, parts?: { path?: string; query?: string; fsPath?: string }) {
        const [withoutQuery, query = ''] = value.split('?');
        this.path = parts?.path ?? withoutQuery.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, '');
        this.query = parts?.query ?? query;
        this.fsPath = parts?.fsPath ?? this.path;
    }

    public static parse(value: string): MockUri {
        return new MockUri(value);
    }

    public static file(value: string): MockUri {
        return new MockUri(`file://${value}`, {
            path: value,
            fsPath: value
        });
    }

    public with(parts: { query?: string }): MockUri {
        const base = this.value.split('?')[0];
        const query = parts.query ?? this.query;
        return new MockUri(query ? `${base}?${query}` : base, {
            path: this.path,
            query
        });
    }

    public toString(): string {
        return this.value;
    }
}

export const Uri = MockUri;

export class RelativePattern {
    constructor(
        public readonly base: string,
        public readonly pattern: string
    ) { }
}

export const commands = {
    async executeCommand(command: string, ...args: unknown[]): Promise<void> {
        executedCommands.push({ command, args });
    }
};

export const window = {
    async showWarningMessage(message: string, ...args: unknown[]): Promise<unknown> {
        warningMessages.push({ message, args });
        return warningMessageResponse;
    },
    async showInformationMessage(message: string, ...args: unknown[]): Promise<unknown> {
        informationMessages.push({ message, args });
        return undefined;
    },
    async showErrorMessage(message: string, ...args: unknown[]): Promise<unknown> {
        errorMessages.push({ message, args });
        return undefined;
    }
};

export const DiagnosticSeverity = {
    Error: 0
} as const;

export const languages = {
    getDiagnostics() {
        return [];
    }
};

export const l10n = {
    t(message: string, ...args: Array<string | number | boolean>): string {
        return args.reduce<string>(
            (result, value, index) => result.replace(`{${index}}`, String(value)),
            message
        );
    }
};

export function __setChangelistMode(mode: string): void {
    changelistMode = mode;
}

export function __getChangelistMode(): string {
    return changelistMode;
}

export function __getExecutedCommands(): Array<{ command: string; args: unknown[] }> {
    return executedCommands;
}

export function __resetExecutedCommands(): void {
    executedCommands.length = 0;
}

export function __setWarningMessageResponse(value: unknown): void {
    warningMessageResponse = value;
}

export function __getWarningMessages(): Array<{ message: string; args: unknown[] }> {
    return warningMessages;
}

export function __resetWindowMessages(): void {
    warningMessages.length = 0;
    informationMessages.length = 0;
    errorMessages.length = 0;
    warningMessageResponse = undefined;
}

export function __setWorkspaceFolders(paths: string[] | undefined): void {
    workspaceFoldersValue = paths?.map((folderPath, index) => ({
        uri: MockUri.file(folderPath),
        name: folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath,
        index
    }));
    workspaceFolderEmitter.fire();
}
