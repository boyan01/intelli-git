import * as path from 'path';
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
            const filePath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;

            if (ref === undefined || !filePath) {
                return '';
            }

            if (ref === 'WORKTREE') {
                const workspaceRoot = this.gitService.getWorkspaceRoot();
                if (!workspaceRoot) {
                    return '';
                }

                try {
                    const uri = vscode.Uri.file(path.join(workspaceRoot, filePath));
                    const content = await vscode.workspace.fs.readFile(uri);
                    return Buffer.from(content).toString('utf8');
                } catch {
                    return '';
                }
            }

            return await this.gitService.getFileContent(ref, filePath);
        } catch (e) {
            console.error('RevisionContentProvider error:', e);
            return '';
        }
    }
}
