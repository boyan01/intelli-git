import * as vscode from 'vscode';

export interface WebviewHtmlOptions {
    webview: vscode.Webview;
    extensionUri: vscode.Uri;
    title: string;
    initialRoute?: string;
    initialState?: unknown;
    /** Relax the CSP for Monaco. Only the conflict resolver panel should enable this. */
    monacoEditor?: boolean;
}

export function generateNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function getWebviewHtml(options: WebviewHtmlOptions): string {
    const { webview, extensionUri, title, initialRoute, initialState, monacoEditor = false } = options;
    const nonce = generateNonce();

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'index.css'));
    const iconStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'intelli-git-icons.css'));

    const language = vscode.env.language;
    const initialStateJson = JSON.stringify(initialState ?? null).replace(/</g, '\\u003c');
    const routeScript = `
        <script nonce="${nonce}">
            window.initialRoute = '${initialRoute || ''}';
            window.vscodeLanguage = '${language}';
            window.initialState = ${initialStateJson};
        </script>`;

    // Monaco replaces visible rows with HTML that contains inline layout attributes and
    // runs its worker from a blob URL. Only the Monaco webview gets those relaxations;
    // every script stays nonce-restricted in both policies.
    const monacoPolicy = monacoEditor
        ? ` style-src-attr 'unsafe-inline'; worker-src ${webview.cspSource} blob:;`
        : '';
    const csp =
        `default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; ` +
        `img-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; ` +
        `connect-src ${webview.cspSource};${monacoPolicy}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <link href="${iconStyleUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>${title}</title>
</head>
<body data-vscode-context='{"preventDefaultContextMenuItems": true}'>
    <div id="root"></div>
    ${routeScript}
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
