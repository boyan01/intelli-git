import * as path from 'path';
import * as vscode from 'vscode';
import { GitLogViewProvider } from '../providers/GitLogViewProvider';
import { GitService } from '../services/GitService';

interface ActiveEditorFile {
    path: string;
    line: number;
}

function getActiveEditorFile(gitService: GitService): ActiveEditorFile | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
        vscode.window.showInformationMessage(
            vscode.l10n.t('Open a file inside the active repository to use Intelli Git history.')
        );
        return null;
    }

    const workspaceRoot = gitService.getWorkspaceRoot();
    const relativePath = path.relative(workspaceRoot, editor.document.uri.fsPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        vscode.window.showInformationMessage(
            vscode.l10n.t('Open a file inside the active repository to use Intelli Git history.')
        );
        return null;
    }

    return {
        path: relativePath.replace(/\\/g, '/'),
        line: editor.selection.active.line + 1,
    };
}

export function registerEditorGitCommands(
    context: vscode.ExtensionContext,
    gitService: GitService,
    gitLogProvider: GitLogViewProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.openLogAtCurrentBlame', async () => {
            const file = getActiveEditorFile(gitService);
            if (!file) return;

            try {
                const hash = await gitService.getBlameCommitForLine(file.path, file.line);
                if (!hash) {
                    vscode.window.showInformationMessage(
                        vscode.l10n.t('No committed change found for the current line.')
                    );
                    return;
                }

                await gitLogProvider.revealLog({ hash });
            } catch (error: any) {
                vscode.window.showErrorMessage(
                    vscode.l10n.t('Failed to open blame commit in Git Log: {0}', error.message)
                );
            }
        }),
        vscode.commands.registerCommand('intelli-git.showFileHistory', async () => {
            const file = getActiveEditorFile(gitService);
            if (!file) return;

            try {
                await gitLogProvider.revealLog({ path: file.path });
            } catch (error: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to open file history: {0}', error.message));
            }
        })
    );
}
