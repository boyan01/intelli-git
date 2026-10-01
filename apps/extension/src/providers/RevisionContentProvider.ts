import * as path from 'path';
import * as vscode from 'vscode';
import { RepositoryManager } from '../services/RepositoryManager';
import {
    getContentPathFromUri,
    parseRepositoryContentQuery,
    type RevisionContentQuery,
} from '../utils/repositoryContentUri';

export class RevisionContentProvider implements vscode.TextDocumentContentProvider {
    onDidChange?: vscode.Event<vscode.Uri> | undefined;

    constructor(private readonly repositoryManager: RepositoryManager) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        // URI format: intelli-git-revision://load/<file-path>?{"ref":"<commit-hash>","repoPath":"<repo-identity>"}

        try {
            const query = parseRepositoryContentQuery<RevisionContentQuery>(uri);
            const ref = query.ref;
            const filePath = getContentPathFromUri(uri);

            if (ref === undefined || !filePath) {
                return '';
            }

            const gitService = query.repoPath
                ? this.repositoryManager.getService(query.repoPath)
                : this.repositoryManager.getActiveService();
            if (!gitService) {
                return '';
            }

            const pathKind = query.pathKind || 'repo';
            const repoPath = pathKind === 'workspace' ? gitService.toRepoPath(filePath) : filePath;

            if (ref === 'WORKTREE') {
                const workspaceRoot = gitService.getWorkspaceRoot();
                if (!workspaceRoot) {
                    return '';
                }

                const workspacePath = pathKind === 'repo' ? gitService.toWorkspacePath(filePath) : filePath;
                if (!workspacePath) {
                    return '';
                }

                try {
                    const uri = vscode.Uri.file(path.join(workspaceRoot, workspacePath));
                    const content = await vscode.workspace.fs.readFile(uri);
                    return Buffer.from(content).toString('utf8');
                } catch {
                    return '';
                }
            }

            return await gitService.getFileContent(ref, repoPath);
        } catch (e) {
            console.error('RevisionContentProvider error:', e);
            return '';
        }
    }
}
