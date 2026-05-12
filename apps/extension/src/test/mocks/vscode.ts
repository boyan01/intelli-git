let changelistMode = 'staged';
const executedCommands: Array<{ command: string; args: unknown[] }> = [];

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
    }
};

class MockUri {
    public readonly path: string;
    public readonly query: string;

    constructor(public readonly value: string, parts?: { path?: string; query?: string }) {
        const [withoutQuery, query = ''] = value.split('?');
        this.path = parts?.path ?? withoutQuery.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, '');
        this.query = parts?.query ?? query;
    }

    public static parse(value: string): MockUri {
        return new MockUri(value);
    }

    public static file(value: string): MockUri {
        return new MockUri(`file://${value}`);
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

export const commands = {
    async executeCommand(command: string, ...args: unknown[]): Promise<void> {
        executedCommands.push({ command, args });
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
