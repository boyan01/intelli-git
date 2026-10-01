let changelistMode = 'staged';
let confirmProtectedBranchPush = true;
const executedCommands: Array<{ command: string; args: unknown[] }> = [];
const warningMessages: Array<{ message: string; args: unknown[] }> = [];
const informationMessages: Array<{ message: string; args: unknown[] }> = [];
const errorMessages: Array<{ message: string; args: unknown[] }> = [];
const openedExternalUris: MockUri[] = [];
const createdTerminals: Array<{ options: unknown; sentText: string[]; shown: boolean }> = [];
let languageModels: unknown[] = [];
let language = 'en';
let workspaceFoldersValue: Array<{ uri: MockUri; name: string; index: number }> | undefined;
let warningMessageResponse: unknown;
let informationMessageResponse: unknown;
let inputBoxResponse: unknown;
let quickPickResponse: unknown;
const inputBoxCalls: unknown[] = [];
const quickPickCalls: Array<{ items: unknown; options: unknown }> = [];
let backgroundFetchConfig = {
    enabled: false,
    onStartup: true,
    intervalMinutes: 15,
};

export class EventEmitter<T> {
    private listeners = new Set<(event: T) => unknown>();

    public readonly event = (listener: (event: T) => unknown) => {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            },
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
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
} as const;

export const ProgressLocation = {
    Notification: 15,
} as const;

export const workspace = {
    get workspaceFolders() {
        return workspaceFoldersValue;
    },
    onDidChangeWorkspaceFolders(listener: () => unknown) {
        return workspaceFolderEmitter.event(listener);
    },
    onDidChangeConfiguration(listener: (event: { affectsConfiguration(section: string): boolean }) => unknown) {
        return configurationEmitter.event(listener);
    },
    getConfiguration(section?: string) {
        return {
            get<T>(key: string, defaultValue: T): T {
                if (section === 'intelli-git' && key === 'changelist.mode') {
                    return changelistMode as T;
                }
                if (section === 'intelli-git.push' && key === 'confirmProtectedBranch') {
                    return confirmProtectedBranchPush as T;
                }
                if (section === 'intelli-git.backgroundFetch' && key in backgroundFetchConfig) {
                    return backgroundFetchConfig[key as keyof typeof backgroundFetchConfig] as T;
                }
                return defaultValue;
            },
            async update(key: string, value: unknown): Promise<void> {
                if (section === 'intelli-git' && key === 'changelist.mode') {
                    changelistMode = String(value);
                }
                if (section === 'intelli-git.push' && key === 'confirmProtectedBranch') {
                    confirmProtectedBranchPush = Boolean(value);
                }
            },
        };
    },
    createFileSystemWatcher() {
        return {
            onDidChange() {
                return { dispose() {} };
            },
            onDidCreate() {
                return { dispose() {} };
            },
            onDidDelete() {
                return { dispose() {} };
            },
            dispose() {},
        };
    },
};

const workspaceFolderEmitter = new EventEmitter<void>();
const configurationEmitter = new EventEmitter<{ affectsConfiguration(section: string): boolean }>();

class MockUri {
    public readonly path: string;
    public readonly query: string;
    public readonly fsPath: string;

    constructor(
        public readonly value: string,
        parts?: { path?: string; query?: string; fsPath?: string }
    ) {
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
            fsPath: value,
        });
    }

    public with(parts: { query?: string }): MockUri {
        const base = this.value.split('?')[0];
        const query = parts.query ?? this.query;
        return new MockUri(query ? `${base}?${query}` : base, {
            path: this.path,
            query,
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
    ) {}
}

export const commands = {
    async executeCommand(command: string, ...args: unknown[]): Promise<void> {
        executedCommands.push({ command, args });
    },
};

export const window = {
    state: { focused: true },
    onDidChangeWindowState(listener: (event: { focused: boolean }) => unknown) {
        return windowStateEmitter.event(listener);
    },
    async showWarningMessage(message: string, ...args: unknown[]): Promise<unknown> {
        warningMessages.push({ message, args });
        return warningMessageResponse;
    },
    async showInformationMessage(message: string, ...args: unknown[]): Promise<unknown> {
        informationMessages.push({ message, args });
        return informationMessageResponse;
    },
    async showErrorMessage(message: string, ...args: unknown[]): Promise<unknown> {
        errorMessages.push({ message, args });
        return undefined;
    },
    async showInputBox(options: unknown): Promise<unknown> {
        inputBoxCalls.push(options);
        return inputBoxResponse;
    },
    async showQuickPick(items: unknown, options: unknown): Promise<unknown> {
        quickPickCalls.push({ items, options });
        return quickPickResponse;
    },
    async withProgress<T>(
        _options: unknown,
        task: (
            progress: { report(value: unknown): void },
            token: {
                isCancellationRequested: boolean;
                onCancellationRequested(listener: () => unknown): { dispose(): void };
            }
        ) => Promise<T>
    ): Promise<T> {
        return task(
            { report() {} },
            {
                isCancellationRequested: false,
                onCancellationRequested() {
                    return { dispose() {} };
                },
            }
        );
    },
    createTerminal(options: unknown) {
        const terminal = {
            options,
            sentText: [] as string[],
            shown: false,
        };
        createdTerminals.push(terminal);
        return {
            show() {
                terminal.shown = true;
            },
            sendText(text: string) {
                terminal.sentText.push(text);
            },
            dispose() {},
        };
    },
};

const windowStateEmitter = new EventEmitter<{ focused: boolean }>();

export const env = {
    get language() {
        return language;
    },
    async openExternal(uri: MockUri): Promise<boolean> {
        openedExternalUris.push(uri);
        return true;
    },
    clipboard: {
        async writeText(_value: string): Promise<void> {},
    },
};

export const DiagnosticSeverity = {
    Error: 0,
} as const;

export const languages = {
    getDiagnostics() {
        return [];
    },
};

export const LanguageModelChatMessageRole = {
    User: 1,
    Assistant: 2,
} as const;

export class LanguageModelTextPart {
    constructor(public readonly value: string) {}
}

export const LanguageModelChatMessage = {
    User(content: string) {
        return {
            role: LanguageModelChatMessageRole.User,
            content,
        };
    },
};

export class CancellationTokenSource {
    public readonly token = {
        isCancellationRequested: false,
    };

    dispose(): void {}
}

export const lm = {
    async selectChatModels(): Promise<unknown[]> {
        return languageModels;
    },
};

export const l10n = {
    t(message: string, ...args: Array<string | number | boolean>): string {
        return args.reduce<string>((result, value, index) => result.replace(`{${index}}`, String(value)), message);
    },
};

export function __setChangelistMode(mode: string): void {
    changelistMode = mode;
}

export function __getChangelistMode(): string {
    return changelistMode;
}

export function __setConfirmProtectedBranchPush(value: boolean): void {
    confirmProtectedBranchPush = value;
}

export function __setBackgroundFetchConfig(config: Partial<typeof backgroundFetchConfig>): void {
    backgroundFetchConfig = { ...backgroundFetchConfig, ...config };
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

export function __setInformationMessageResponse(value: unknown): void {
    informationMessageResponse = value;
}

export function __setInputBoxResponse(value: unknown): void {
    inputBoxResponse = value;
}

export function __setQuickPickResponse(value: unknown): void {
    quickPickResponse = value;
}

export function __getQuickPickCalls(): Array<{ items: unknown; options: unknown }> {
    return quickPickCalls;
}

export function __getWarningMessages(): Array<{ message: string; args: unknown[] }> {
    return warningMessages;
}

export function __resetWindowMessages(): void {
    warningMessages.length = 0;
    informationMessages.length = 0;
    errorMessages.length = 0;
    inputBoxCalls.length = 0;
    quickPickCalls.length = 0;
    warningMessageResponse = undefined;
    informationMessageResponse = undefined;
    inputBoxResponse = undefined;
    quickPickResponse = undefined;
}

export function __setLanguageModels(models: unknown[]): void {
    languageModels = models;
}

export function __resetLanguageModels(): void {
    languageModels = [];
}

export function __setLanguage(value: string): void {
    language = value;
}

export function __setWorkspaceFolders(paths: string[] | undefined): void {
    workspaceFoldersValue = paths?.map((folderPath, index) => ({
        uri: MockUri.file(folderPath),
        name: folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath,
        index,
    }));
    workspaceFolderEmitter.fire();
}

export function __getOpenedExternalUris(): MockUri[] {
    return openedExternalUris;
}

export function __resetOpenedExternalUris(): void {
    openedExternalUris.length = 0;
}

export function __getCreatedTerminals(): Array<{ options: unknown; sentText: string[]; shown: boolean }> {
    return createdTerminals;
}

export function __resetCreatedTerminals(): void {
    createdTerminals.length = 0;
}
