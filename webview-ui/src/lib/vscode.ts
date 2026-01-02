interface TypedVSCodeApi {
    postMessage(message: any): void;
    getState<T>(): T | undefined;
    setState<T>(state: T): T;
}

/**
 * Typed VS Code API instance.
 * acquireVsCodeApi can only be called once per webview.
 */
export const vscode = acquireVsCodeApi() as TypedVSCodeApi;
