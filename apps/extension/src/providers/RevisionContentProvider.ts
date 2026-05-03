import * as path from 'path';
import * as vscode from 'vscode';
import { RepositoryManager } from '../services/RepositoryManager';

export class RevisionContentProvider implements vscode.TextDocumentContentProvider {
    onDidChange?: vscode.Event<vscode.Uri> | undefined;

    constructor(private readonly repositoryManager: RepositoryManager) { }

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        // URI format: intelli-git-revision://load/<file-path>?{"ref":"<commit-hash>"}

        try {
            const query = JSON.parse(uri.query);
            const ref = query.ref;
            const filePath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;

            if (ref === undefined || !filePath) {
                return '';
            }

            const gitService = this.repositoryManager.getActiveService();
            if (!gitService) {
                return '';
            }

            if (ref === 'WORKTREE') {
                const workspaceRoot = gitService.getWorkspaceRoot();
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

            return await gitService.getFileContent(ref, filePath);
        } catch (e) {
            console.error('RevisionContentProvider error:', e);
            return '';
        }
    }
}
