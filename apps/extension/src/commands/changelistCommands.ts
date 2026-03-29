import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from '../services/GitService';
import { InactiveChangesService } from '../services/InactiveChangesService';
import { CommitViewProvider } from '../providers/CommitViewProvider';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/logger';

interface ChangelistFileContext {
    webviewSection: 'changelistFile';
    path: string;
    status?: string;
    isStaged?: boolean;
    isInactive?: boolean;
    isConflict?: boolean;
}

/**
 * Register changelist file-related context menu commands.
 */
export function registerChangelistCommands(
    context: vscode.ExtensionContext,
    gitService: GitService,
    inactiveChangesService: InactiveChangesService,
    provider: CommitViewProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.openFile', async (args: ChangelistFileContext) => {
            if (args?.path) {
                const workspaceRoot = gitService.getWorkspaceRoot();
                if (workspaceRoot) {
                    const uri = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
                    await vscode.commands.executeCommand('vscode.open', uri);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.showDiff', async (args: ChangelistFileContext) => {
            if (args?.path) {
                if (args.status === '?') {
                    // Unversioned file: just open the source file
                    const workspaceRoot = gitService.getWorkspaceRoot();
                    if (workspaceRoot) {
                        const uri = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
                        await vscode.commands.executeCommand('vscode.open', uri);
                    }
                    return;
                }

                if (args.isStaged) {
                    const leftUri = vscode.Uri.parse(`intelli-git-revision://load/${args.path}?${JSON.stringify({ ref: 'HEAD' })}`);
                    const rightUri = vscode.Uri.parse(`intelli-git-revision://load/${args.path}?${JSON.stringify({ ref: '' })}`);
                    const title = `${path.basename(args.path)} ${i18n.t('(Staged)')}`;
                    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
                } else {
                    const workspaceRoot = gitService.getWorkspaceRoot();
                    if (workspaceRoot) {
                        const uri = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
                        await vscode.commands.executeCommand('git.openChange', uri);
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.rollback', async (args: ChangelistFileContext) => {
            if (args?.path) {
                const confirm = await vscode.window.showWarningMessage(
                    i18n.t('extension.rollbackFilesConfirm', 1),
                    { modal: true },
                    i18n.t('Rollback')
                );
                if (confirm === i18n.t('Rollback')) {
                    try {
                        await gitService.rollbackFiles([args.path]);
                        provider.rpc?.refresh();
                    } catch (e) {
                        vscode.window.showErrorMessage(i18n.t('extension.rollbackFailed', `${e}`));
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.stash', async (args: ChangelistFileContext) => {
            if (args?.path) {
                const message = await vscode.window.showInputBox({
                    placeHolder: i18n.t('extension.stashPlaceholder')
                });
                try {
                    await gitService.stash(message, [args.path]);
                    provider.rpc?.refresh();
                } catch (e) {
                    vscode.window.showErrorMessage(i18n.t('extension.stashFailed', `${e}`));
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.delete', async (args: ChangelistFileContext) => {
            if (args?.path) {
                const confirm = await vscode.window.showWarningMessage(
                    i18n.t('extension.deleteFilesConfirm', 1),
                    { modal: true },
                    i18n.t('Delete')
                );
                if (confirm === i18n.t('Delete')) {
                    const workspaceRoot = gitService.getWorkspaceRoot();
                    if (workspaceRoot) {
                        try {
                            const uri = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
                            await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
                            provider.rpc?.refresh();
                        } catch (e) {
                            vscode.window.showErrorMessage(i18n.t('extension.deleteFailed', `${e}`));
                        }
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.markInactive', async (args: ChangelistFileContext) => {
            if (args?.path) {
                await inactiveChangesService.markInactive([args.path]);

                // Keep inactive files out of commit index.
                const status = await gitService.getStatus();
                const target = status.find(file => file.path === args.path);
                if (target?.staged) {
                    await gitService.unstageFile(args.path);
                }

                provider.rpc?.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.markActive', async (args: ChangelistFileContext) => {
            if (args?.path) {
                await inactiveChangesService.markActive([args.path]);
                provider.rpc?.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.stage', async (args: ChangelistFileContext) => {
            if (!args?.path || args.isInactive) {
                return;
            }

            try {
                await gitService.stageFile(args.path);
                provider.rpc?.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.stageFailed', `${e}`));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.unstage', async (args: ChangelistFileContext) => {
            if (!args?.path) {
                return;
            }

            try {
                await gitService.unstageFile(args.path);
                provider.rpc?.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.unstageFailed', `${e}`));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.acceptCurrent', async (args: ChangelistFileContext) => {
            if (!args?.path || !args.isConflict) {
                return;
            }

            try {
                await gitService.resolveConflict(args.path, 'ours');
                provider.rpc?.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.resolveConflictFailed', `${e}`));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.acceptIncoming', async (args: ChangelistFileContext) => {
            if (!args?.path || !args.isConflict) {
                return;
            }

            try {
                await gitService.resolveConflict(args.path, 'theirs');
                provider.rpc?.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.resolveConflictFailed', `${e}`));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.moveHunkToInactive', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const line = editor.selection.active.line + 1;
            const docUri = editor.document.uri;
            const workspaceRoot = gitService.getWorkspaceRoot();

            logger.info('MoveHunkToInactive triggered', {
                scheme: docUri.scheme,
                query: docUri.query,
                fsPath: docUri.fsPath
            });

            let filePath = docUri.fsPath;
            let isStagedView = false;

            if (docUri.scheme === 'git' || docUri.scheme === 'intelli-git-revision' || docUri.scheme === 'git-revision') {
                try {
                    const parsed = JSON.parse(docUri.query);
                    let rawPath = parsed.path || parsed.fsPath || (typeof parsed === 'string' ? parsed : null);

                    // Specific handling for our custom revision scheme: path is in uri.path
                    if (!rawPath && docUri.scheme === 'intelli-git-revision') {
                        rawPath = docUri.path.startsWith('/') ? docUri.path.substring(1) : docUri.path;
                    }

                    if (rawPath) {
                        filePath = path.isAbsolute(rawPath) ? rawPath : path.join(workspaceRoot || '', rawPath);
                    }

                    // For our revision scheme, it's typically a staged diff
                    if (docUri.scheme === 'intelli-git-revision') {
                        isStagedView = true;
                    } else if (docUri.scheme === 'git' && docUri.authority === 'index') {
                        isStagedView = true;
                    }
                } catch (e) {
                    logger.warn('Failed to parse URI query', e);
                }
            } else if (docUri.scheme === 'file') {
                isStagedView = false;
            }

            if (!workspaceRoot || !filePath.startsWith(workspaceRoot)) {
                logger.warn('File not in workspace root', { filePath, workspaceRoot });
                return;
            }

            const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
            const status = await gitService.getStatus();
            const matchingFiles = status.filter(f => f.path === relativePath);

            // Prefer the status matching the current view's stagedness
            let fileStatus = matchingFiles.find(f => f.staged === isStagedView);
            if (!fileStatus && matchingFiles.length > 0) {
                fileStatus = matchingFiles[0];
            }

            if (fileStatus && fileStatus.hunks) {
                // Dual-side matching: check both old and new line ranges
                const hunk = fileStatus.hunks.find(h => {
                    const inOldRange = line >= h.oldStart && line <= (h.oldStart + Math.max(0, h.oldLineCount - 1));
                    const inNewRange = line >= h.newStart && line <= (h.newStart + Math.max(0, h.newLineCount - 1));
                    return inOldRange || inNewRange;
                });

                if (hunk) {
                    await inactiveChangesService.markHunkInactive(relativePath, hunk.id);

                    // If moving a staged hunk to inactive, we should also unstage it from the index
                    if (fileStatus.staged) {
                        try {
                            const patch = gitService.buildPatchFromHunks([hunk]);
                            await gitService.applyPatch(patch, true, true);
                        } catch (e) {
                            logger.error(`Failed to unstage hunk for ${relativePath}:`, e);
                        }
                    }

                    provider.rpc?.refresh();
                    vscode.window.showInformationMessage(i18n.t('Hunk {0} moved to Inactive', hunk.lineRange));
                } else {
                    vscode.window.showWarningMessage(i18n.t('No modified hunk found at line {0} in {1}', line, relativePath));
                    logger.warn('Hunk matching failed', { line, relativePath, hunkCount: fileStatus.hunks.length });
                }
            } else {
                logger.warn('File status or hunks not found for command', { relativePath });
                vscode.window.showWarningMessage(i18n.t('File status not found for {0}', relativePath));
            }
        })
    );
}
