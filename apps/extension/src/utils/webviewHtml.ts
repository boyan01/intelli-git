import * as vscode from 'vscode';

export interface WebviewHtmlOptions {
    webview: vscode.Webview;
    extensionUri: vscode.Uri;
    title: string;
    initialRoute?: string;
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
    const { webview, extensionUri, title, initialRoute } = options;
    const nonce = generateNonce();

    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'index.css')
    );
    const iconStyleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'intelli-git-icons.css')
    );

    const language = vscode.env.language;
    const routeScript = `
        <script nonce="${nonce}">
            window.initialRoute = '${initialRoute || ''}';
            window.vscodeLanguage = '${language}';
        </script>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
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
