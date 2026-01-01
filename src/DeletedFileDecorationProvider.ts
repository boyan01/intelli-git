import * as vscode from 'vscode';

export class DeletedFileDecorationProvider implements vscode.FileDecorationProvider {
    private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
        if (uri.scheme === 'idea-stash' && uri.authority === 'deleted') {
            return {
                color: new vscode.ThemeColor('gitDecoration.deletedResourceForeground'),
                badge: 'D',
                tooltip: 'Deleted file (showing HEAD version)'
            };
        }
        return undefined;
    }
}
