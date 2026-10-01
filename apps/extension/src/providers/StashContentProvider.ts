import * as vscode from 'vscode';
import { RepositoryManager } from '../services/RepositoryManager';
import { parseRepositoryContentQuery, type StashContentQuery } from '../utils/repositoryContentUri';

export class StashContentProvider implements vscode.TextDocumentContentProvider {
    onDidChange?: vscode.Event<vscode.Uri> | undefined;

    constructor(private readonly repositoryManager: RepositoryManager) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        // URI format: intelli-git-stash://load/<stash-ref>/<file-path>?{"repoPath":"<repo-identity>"}

        try {
            const query = parseRepositoryContentQuery<StashContentQuery>(uri);
            const ref = query.ref;
            const path = query.path;

            if (!ref || !path) {
                return '';
            }

            const gitService = query.repoPath
                ? this.repositoryManager.getService(query.repoPath)
                : this.repositoryManager.getActiveService();
            return (await gitService?.getFileContent(ref, path)) || '';
        } catch {
            return '';
        }
    }
}
