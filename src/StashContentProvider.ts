
import * as vscode from 'vscode';
import { GitService } from './services/GitService';

export class StashContentProvider implements vscode.TextDocumentContentProvider {
    private gitService: GitService;

    // Trigger an event to update the content
    onDidChange?: vscode.Event<vscode.Uri> | undefined;

    constructor(gitService: GitService) {
        this.gitService = gitService;
    }

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        // URI format: idea-stash://load/<stash-ref>/<file-path>
        // Example: idea-stash://load/stash@{0}/src/main.ts

        // We can extract params from path or query.
        // Let's use path convention: /<stash-ref>/<file-path>
        // But Uri.path starts with /, so we need to be careful.

        // Let's simplify and assume we put the full ref and path in the query string or encoded in path.
        // Or simpler: put the ref as authority? No, authority is host.
        // Let's use JSON query param.

        try {
            const query = JSON.parse(uri.query);
            const ref = query.ref;
            const path = query.path;

            if (!ref || !path) {
                return '';
            }

            return await this.gitService.getFileContent(ref, path);
        } catch (e) {
            return '';
        }
    }
}
