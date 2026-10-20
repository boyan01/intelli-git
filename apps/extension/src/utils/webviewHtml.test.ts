import { beforeAll, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { getWebviewHtml } from './webviewHtml';

function renderHtml(monacoEditor?: boolean): string {
    return getWebviewHtml({
        webview: {
            cspSource: 'https://webview.test',
            asWebviewUri: (value) => value,
        } as vscode.Webview,
        extensionUri: vscode.Uri.parse('file:///extension'),
        title: 'Test',
        monacoEditor,
    });
}

describe('webview HTML', () => {
    beforeAll(() => {
        const uri = vscode.Uri as unknown as {
            joinPath(base: vscode.Uri, ...segments: string[]): vscode.Uri;
        };
        uri.joinPath = (base, ...segments) => vscode.Uri.parse(`${base.toString()}/${segments.join('/')}`);
    });

    it('restricts styles and scripts to the webview source and nonce by default', () => {
        const html = renderHtml();

        expect(html).toContain('style-src https://webview.test;');
        expect(html).not.toContain('unsafe-inline');
        expect(html).not.toContain('worker-src');
        expect(html).not.toContain('blob:');
        expect(html).not.toContain('editor.css');
        expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]{32}' https:\/\/webview\.test;/);
    });

    it('allows Monaco row layout styles and workers only when requested, without allowing inline scripts', () => {
        const html = renderHtml(true);

        expect(html).toContain("style-src-attr 'unsafe-inline';");
        expect(html).toContain('worker-src https://webview.test blob:;');
        expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]{32}' https:\/\/webview\.test;/);
        expect(html).not.toContain("script-src 'unsafe-inline'");
    });
});
