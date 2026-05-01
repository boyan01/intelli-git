type ConfigurationValues = Record<string, unknown>;

class MemoryMemento {
    private readonly values = new Map<string, unknown>();

    get<T>(key: string, defaultValue?: T): T | undefined {
        return this.values.has(key) ? this.values.get(key) as T : defaultValue;
    }

    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.values.delete(key);
            return;
        }
        this.values.set(key, value);
    }
}

const configurationValues: ConfigurationValues = {
    'intelli-git.changelist.mode': 'staged'
};

export const ConfigurationTarget = {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
};

export const workspace = {
    getConfiguration(section?: string) {
        return {
            get<T>(key: string, defaultValue?: T): T | undefined {
                const fullKey = section ? `${section}.${key}` : key;
                return Object.prototype.hasOwnProperty.call(configurationValues, fullKey)
                    ? configurationValues[fullKey] as T
                    : defaultValue;
            },
            async update(key: string, value: unknown): Promise<void> {
                const fullKey = section ? `${section}.${key}` : key;
                configurationValues[fullKey] = value;
            }
        };
    }
};

export function createExtensionContext() {
    return {
        workspaceState: new MemoryMemento(),
        globalState: new MemoryMemento(),
        subscriptions: []
    };
}

export function resetVscodeMock() {
    configurationValues['intelli-git.changelist.mode'] = 'staged';
}
