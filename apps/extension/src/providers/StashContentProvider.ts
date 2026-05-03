import * as vscode from 'vscode';
import { RepositoryManager } from '../services/RepositoryManager';

export class StashContentProvider implements vscode.TextDocumentContentProvider {
    onDidChange?: vscode.Event<vscode.Uri> | undefined;

    constructor(private readonly repositoryManager: RepositoryManager) { }

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        // URI format: intelli-git-stash://load/<stash-ref>/<file-path>

        try {
            const query = JSON.parse(uri.query);
            const ref = query.ref;
            const path = query.path;

            if (!ref || !path) {
                return '';
            }

            return await this.repositoryManager.getActiveService()?.getFileContent(ref, path) || '';
        } catch {
            return '';
        }
    }
}
