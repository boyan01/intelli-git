/**
 * Shared VS Code API instance.
 * acquireVsCodeApi can only be called once per webview.
 */
export const vscode = acquireVsCodeApi();
