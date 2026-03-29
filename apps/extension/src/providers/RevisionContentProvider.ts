import * as vscode from 'vscode';
import { GitService } from '../services/GitService';

export class RevisionContentProvider implements vscode.TextDocumentContentProvider {
    private gitService: GitService;

    onDidChange?: vscode.Event<vscode.Uri> | undefined;

    constructor(gitService: GitService) {
        this.gitService = gitService;
    }

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        // URI format: intelli-git-revision://load/<file-path>?{"ref":"<commit-hash>"}

        try {
            const query = JSON.parse(uri.query);
            const ref = query.ref;
            const path = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;

            if (!ref || !path) {
                return '';
            }

            return await this.gitService.getFileContent(ref, path);
        } catch (e) {
            console.error('RevisionContentProvider error:', e);
            return '';
        }
    }
}
