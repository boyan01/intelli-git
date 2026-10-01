import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { getWebviewHtml } from './webviewHtml';

describe('webview HTML', () => {
    it('allows Monaco row layout styles without allowing inline scripts', () => {
        const uri = vscode.Uri as unknown as {
            joinPath(base: vscode.Uri, ...segments: string[]): vscode.Uri;
        };
        uri.joinPath = (base, ...segments) => vscode.Uri.parse(`${base.toString()}/${segments.join('/')}`);

        const html = getWebviewHtml({
            webview: {
                cspSource: 'https://webview.test',
                asWebviewUri: (value) => value,
            } as vscode.Webview,
            extensionUri: vscode.Uri.parse('file:///extension'),
            title: 'Test',
        });

        expect(html).toContain("style-src https://webview.test; style-src-attr 'unsafe-inline';");
        expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]{32}' https:\/\/webview\.test;/);
        expect(html).not.toContain("script-src 'unsafe-inline'");
    });
});
