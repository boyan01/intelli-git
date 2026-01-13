import { vscode } from './vscode';

type StoredState = Record<string, unknown>;

let stateCache: StoredState | null = null;

export function getStoredState(): StoredState {
    if (stateCache === null) {
        stateCache = vscode.getState<StoredState>() ?? {};
    }
    return stateCache;
}

export function updateStoredState(key: string, value: unknown): void {
    const state = getStoredState();
    state[key] = value;
    stateCache = state;
    vscode.setState(state);
}

export function getCachedValue<T>(key: string, defaultValue: T): T {
    const stored = getStoredState()[key];
    if (stored === undefined || stored === null) {
        return defaultValue;
    }
    return stored as T;
}
