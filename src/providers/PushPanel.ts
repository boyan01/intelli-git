import * as vscode from 'vscode';
import { BaseWebviewProvider, WebviewProviderOptions } from './BaseWebviewProvider';

export class PushPanel extends BaseWebviewProvider {
    public static currentPanel: PushPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposed: boolean = false;

    private constructor(
        panel: vscode.WebviewPanel,
        options: WebviewProviderOptions
    ) {
        super(options);
        this._panel = panel;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this.setupWebview(this._panel.webview, () => this._disposed);
        this._panel.webview.html = this.getHtml(this._panel.webview);
    }

    protected getTitle(): string {
        return 'Push Commits';
    }

    protected getInitialRoute(): string {
        return '/push';
    }

    protected getOnDispose(): () => void {
        return () => this.dispose();
    }

    public static createOrShow(options: WebviewProviderOptions) {
        if (PushPanel.currentPanel) {
            PushPanel.currentPanel._panel.reveal(vscode.ViewColumn.Active);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'intelliGitPushPanel',
            'Push Commits',
            {
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: false
            },
            {
                enableScripts: true,
                localResourceRoots: [options.extensionUri],
                retainContextWhenHidden: true
            }
        );

        PushPanel.currentPanel = new PushPanel(panel, options);
    }

    public dispose() {
        if (this._disposed) return;
        this._disposed = true;
        PushPanel.currentPanel = undefined;
        this._panel.dispose();
        super.dispose();
    }
}
