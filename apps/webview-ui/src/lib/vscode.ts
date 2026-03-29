interface TypedVSCodeApi {
    postMessage(message: unknown): void;
    getState<T>(): T | undefined;
    setState<T>(state: T): void;
}

/**
 * Typed VS Code API instance.
 * acquireVsCodeApi can only be called once per webview.
 */
export const vscode = acquireVsCodeApi() as TypedVSCodeApi;
