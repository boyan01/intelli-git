let changelistMode = 'staged';

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

export function __setChangelistMode(mode: string): void {
    changelistMode = mode;
}
