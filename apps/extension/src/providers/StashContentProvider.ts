import * as vscode from 'vscode';
import { GitService } from '../services/GitService';

export class StashContentProvider implements vscode.TextDocumentContentProvider {
    private gitService: GitService;

    onDidChange?: vscode.Event<vscode.Uri> | undefined;

    constructor(gitService: GitService) {
        this.gitService = gitService;
    }

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        // URI format: intelli-git-stash://load/<stash-ref>/<file-path>

        try {
            const query = JSON.parse(uri.query);
            const ref = query.ref;
            const path = query.path;

            if (!ref || !path) {
                return '';
            }

            return await this.gitService.getFileContent(ref, path);
        } catch {
            return '';
        }
    }
}
