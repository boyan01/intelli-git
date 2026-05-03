let changelistMode = 'staged';
const executedCommands: Array<{ command: string; args: unknown[] }> = [];

export class EventEmitter<T> {
    public readonly event = (_listener: (event: T) => unknown) => ({ dispose() { } });

    public fire(_event: T): void { }

    public dispose(): void { }
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
    constructor(public readonly value: string) { }

    public static parse(value: string): MockUri {
        return new MockUri(value);
    }

    public static file(value: string): MockUri {
        return new MockUri(`file://${value}`);
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
