import * as vscode from 'vscode';
import * as path from 'path';
import type { ChangelistFileSelection } from '@shared/messages';
import { GitService } from '../services/GitService';
import { ChangelistStateService } from '../services/ChangelistStateService';
import { InactiveChangesService } from '../services/InactiveChangesService';
import { CommitViewProvider } from '../providers/CommitViewProvider';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/logger';
import { log } from 'console';

interface ChangelistFileContext {
    webviewSection: 'changelistFile';
    path: string;
    paths?: string[];
    status?: string;
    isStaged?: boolean;
    isInactive?: boolean;
    isConflict?: boolean;
    isUntracked?: boolean;
    hasStaged?: boolean;
    allStaged?: boolean;
    hasInactive?: boolean;
    allInactive?: boolean;
    hasConflict?: boolean;
    hasUntracked?: boolean;
    changelistMode?: 'staged' | 'changes';
    changelistId?: string;
}

interface ChangelistRootContext {
    webviewSection: 'changelistRoot';
    changelistId?: string;
    paths?: string[];
    isActiveChangelist?: boolean;
    canDeleteChangelist?: boolean;
    hasStaged?: boolean;
    allStaged?: boolean;
    hasInactive?: boolean;
    allInactive?: boolean;
    hasConflict?: boolean;
    hasUntracked?: boolean;
    changelistMode?: 'staged' | 'changes';
}

interface ChangelistFolderContext {
    webviewSection: 'changelistFolder';
    path: string;
    paths: string[];
    hasStaged?: boolean;
    allStaged?: boolean;
    hasInactive?: boolean;
    allInactive?: boolean;
    hasConflict?: boolean;
    hasUntracked?: boolean;
    changelistMode?: 'staged' | 'changes';
    changelistId?: string;
}

interface ChangelistHunkContext {
    webviewSection: 'changelistHunk';
    path: string;
    hunkId: string;
    changelistId?: string;
}

type ChangelistTargetContext = ChangelistFileContext | ChangelistFolderContext | ChangelistRootContext;

function getTargetPaths(args?: ChangelistTargetContext): string[] {
    if (!args) {
        return [];
    }

    if (Array.isArray(args.paths) && args.paths.length > 0) {
        return Array.from(new Set(args.paths));
    }

    if ('path' in args && args.path) {
        return [args.path];
    }

    return [];
}

async function showDiffForChangelistFile(gitService: GitService, args: ChangelistFileSelection): Promise<void> {
    if (!args?.path) {
        return;
    }

    if (args.status === '?') {
        const workspaceRoot = gitService.getWorkspaceRoot();
        if (workspaceRoot) {
            const uri = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
            await vscode.commands.executeCommand('vscode.open', uri);
        }
        return;
    }

    if (args.staged) {
        const leftUri = vscode.Uri.parse(`intelli-git-revision://load/${args.path}?${JSON.stringify({ ref: 'HEAD' })}`);
        const rightUri = vscode.Uri.parse(`intelli-git-revision://load/${args.path}?${JSON.stringify({ ref: '' })}`);
        const title = `${path.basename(args.path)} ${i18n.t('(Staged)')}`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
        return;
    }

    const workspaceRoot = gitService.getWorkspaceRoot();
    if (workspaceRoot) {
        const uri = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
        await vscode.commands.executeCommand('git.openChange', uri);
    }
}

/**
 * Register changelist file-related context menu commands.
 */
export function registerChangelistCommands(
    context: vscode.ExtensionContext,
    gitService: GitService,
    inactiveChangesService: InactiveChangesService,
    changelistStateService: ChangelistStateService,
    provider: CommitViewProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.createList', async () => {
            const changelistName = await vscode.window.showInputBox({
                prompt: i18n.t('extension.enterChangelistName'),
                value: i18n.t('Changes')
            });
            if (!changelistName?.trim()) {
                return;
            }
            await changelistStateService.createList(changelistName.trim());
            provider.rpc?.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.renameList', async (args: ChangelistRootContext) => {
            if (!args?.changelistId) {
                return;
            }
            const current = changelistStateService.getState().lists.find(list => list.id === args.changelistId);
            if (!current) {
                return;
            }
            const changelistName = await vscode.window.showInputBox({
                prompt: i18n.t('extension.enterChangelistName'),
                value: current.name
            });
            if (!changelistName?.trim()) {
                return;
            }
            await changelistStateService.renameList(args.changelistId, changelistName.trim());
            provider.rpc?.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.deleteList', async (args: ChangelistRootContext) => {
            if (!args?.changelistId) {
                return;
            }
            const current = changelistStateService.getState().lists.find(list => list.id === args.changelistId);
            if (!current) {
                return;
            }
            if (changelistStateService.getListItemCount(args.changelistId) > 0) {
                const confirmed = await vscode.window.showWarningMessage(
                    i18n.t('extension.changelistNotEmpty', current.name),
                    { modal: true },
                    i18n.t('Delete')
                );
                if (confirmed !== i18n.t('Delete')) {
                    return;
                }
            }
            await changelistStateService.deleteList(args.changelistId);
            provider.rpc?.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.setActiveList', async (args: ChangelistRootContext) => {
            if (!args?.changelistId) {
                return;
            }
            await changelistStateService.setActiveList(args.changelistId);
            provider.rpc?.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.moveToList', async (args: ChangelistFileContext | ChangelistHunkContext) => {
            const state = changelistStateService.getState();

            const currentListId = args?.changelistId;
            const target = await vscode.window.showQuickPick(
                state.lists
                    .filter(list => list.id !== currentListId)
                    .map(list => ({
                        label: list.name,
                        description: list.isActive ? i18n.t('Active') : undefined,
                        id: list.id
                    })),
                {
                    placeHolder: i18n.t('Move to Changelist...')
                }
            );

            if (!target) {
                return;
            }

            if (args?.webviewSection === 'changelistHunk' && args.hunkId) {
                await changelistStateService.moveHunks(args.path, [args.hunkId], target.id);
            } else if (args?.path) {
                await changelistStateService.moveFiles([args.path], target.id);
            }

            provider.rpc?.refresh();
        })
    );

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
            const target = args?.path ? args : provider.getSelectedChangelistFile();
            if (!target) {
                return;
            }
            await showDiffForChangelistFile(gitService, target);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.rollback', async (args: ChangelistTargetContext) => {
            const paths = getTargetPaths(args);
            if (paths.length > 0) {
                const confirm = await vscode.window.showWarningMessage(
                    i18n.t('extension.rollbackFilesConfirm', paths.length),
                    { modal: true },
                    i18n.t('Rollback')
                );
                if (confirm === i18n.t('Rollback')) {
                    try {
                        await gitService.rollbackFiles(paths);
                        provider.rpc?.refresh();
                    } catch (e) {
                        vscode.window.showErrorMessage(i18n.t('extension.rollbackFailed', `${e}`));
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.stash', async (args: ChangelistTargetContext) => {
            const paths = getTargetPaths(args);
            if (paths.length > 0) {
                const message = await vscode.window.showInputBox({
                    placeHolder: i18n.t('extension.stashPlaceholder')
                });
                try {
                    await gitService.stash(message, paths);
                    provider.rpc?.refresh();
                } catch (e) {
                    vscode.window.showErrorMessage(i18n.t('extension.stashFailed', `${e}`));
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.delete', async (args: ChangelistTargetContext) => {
            const paths = getTargetPaths(args);
            if (paths.length > 0) {
                const confirm = await vscode.window.showWarningMessage(
                    i18n.t('extension.deleteFilesConfirm', paths.length),
                    { modal: true },
                    i18n.t('Delete')
                );
                if (confirm === i18n.t('Delete')) {
                    const workspaceRoot = gitService.getWorkspaceRoot();
                    if (workspaceRoot) {
                        try {
                            for (const filePath of paths) {
                                const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
                                try {
                                    await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
                                } catch (error) {
                                    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                                        continue;
                                    }
                                    throw error;
                                }
                            }
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
        vscode.commands.registerCommand('intelli-git.changelist.markInactive', async (args: ChangelistTargetContext) => {
            const paths = getTargetPaths(args);
            if (paths.length > 0) {
                await inactiveChangesService.markInactive(paths);

                // Keep inactive files out of commit index, including mixed staged/unstaged entries.
                const status = await gitService.getStatus();
                const stagedPaths = Array.from(new Set(
                    status
                        .filter(file => paths.includes(file.path) && file.staged)
                        .map(file => file.path)
                ));
                if (stagedPaths.length > 0) {
                    await gitService.unstageFiles(stagedPaths);
                }

                provider.rpc?.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.markActive', async (args: ChangelistTargetContext) => {
            const paths = getTargetPaths(args);
            if (paths.length > 0) {
                await inactiveChangesService.markActive(paths);
                provider.rpc?.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.stage', async (args: ChangelistTargetContext) => {
            const paths = getTargetPaths(args);
            if (paths.length === 0 || args?.allInactive) {
                return;
            }

            try {
                if (paths.length === 1) {
                    await gitService.stageFile(paths[0]);
                } else {
                    await gitService.stageFiles(paths);
                }
                provider.rpc?.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.stageFailed', `${e}`));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.unstage', async (args: ChangelistTargetContext) => {
            const paths = getTargetPaths(args);
            if (paths.length === 0) {
                return;
            }

            try {
                if (paths.length === 1) {
                    await gitService.unstageFile(paths[0]);
                } else {
                    await gitService.unstageFiles(paths);
                }
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
                    vscode.window.showWarningMessage(i18n.t('File status not found for {0}', relativePath));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.hunk.toggleInactive', async (...args) => {
            let uri: vscode.Uri | undefined;
            let targetLine: number | undefined;

            logger.info('ToggleInactive triggered with args:', JSON.stringify(args));

            if (args.length >= 2 && args[0] instanceof vscode.Uri) {
                // From scm/change/title (Quick Diff)
                // args: [uri, changes (LineChange[]), index]
                uri = args[0];
                const changes = args[1];
                const index = args[2];
                if (changes && changes.length > index) {
                    targetLine = changes[index].modifiedStartLineNumber;
                    if (targetLine === 0) {
                        targetLine = 1;
                    }
                }
            }

            if (!uri || targetLine === undefined) {
                logger.warn('Could not determine uri or target line for toggleInactive');
                return;
            }

            const workspaceRoot = gitService.getWorkspaceRoot();
            if (!workspaceRoot) return;

            let filePath = uri.fsPath;
            let isStagedView = false;
            if (uri.scheme === 'intelli-git-revision') {
                isStagedView = true;
                try {
                    const parsed = JSON.parse(uri.query);
                    let rawPath = parsed.path || parsed.fsPath || (typeof parsed === 'string' ? parsed : null);
                    if (!rawPath) rawPath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;
                    if (rawPath) filePath = path.isAbsolute(rawPath) ? rawPath : path.join(workspaceRoot, rawPath);
                } catch { /* ignore */ }
            } else if (uri.scheme === 'git' && uri.authority === 'index') {
                isStagedView = true;
                try {
                    const parsed = JSON.parse(uri.query);
                    if (parsed.path) filePath = path.join(workspaceRoot, parsed.path);
                } catch { /* ignore */ }
            }

            if (!filePath.startsWith(workspaceRoot)) {
                logger.warn('File not in workspace root', { filePath, workspaceRoot });
                return;
            }

            const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
            const status = await gitService.getStatus();
            const matchingFiles = status.filter(f => f.path === relativePath);

            let fileStatus = matchingFiles.find(f => f.staged === isStagedView);
            if (!fileStatus && matchingFiles.length > 0) {
                fileStatus = matchingFiles[0];
            }

            if (fileStatus && fileStatus.hunks) {
                const hunk = fileStatus.hunks.find(h => {
                    const diffOldEnd = h.oldStart + Math.max(0, h.oldLineCount - 1);
                    const diffNewEnd = h.newStart + Math.max(0, h.newLineCount - 1);
                    // allow +/- 1 line discrepancy between VS Code internal differ and git diff
                    const inOldRange = targetLine! >= (h.oldStart - 1) && targetLine! <= (diffOldEnd + 1);
                    const inNewRange = targetLine! >= (h.newStart - 1) && targetLine! <= (diffNewEnd + 1);
                    return inOldRange || inNewRange;
                });

                if (hunk) {
                    const inactiveHunkIds = inactiveChangesService.getInactiveHunkIds(relativePath);
                    const isCurrentlyInactive = inactiveHunkIds.includes(hunk.id);

                    if (isCurrentlyInactive) {
                        await inactiveChangesService.markHunkActive(relativePath, hunk.id);
                        vscode.window.showInformationMessage(i18n.t('Hunk moved to Active'));
                    } else {
                        await inactiveChangesService.markHunkInactive(relativePath, hunk.id);
                        vscode.window.showInformationMessage(i18n.t('Hunk moved to Inactive'));
                    }
                    provider.rpc?.refresh();
                } else {
                    vscode.window.showWarningMessage(i18n.t('No modified hunk found at line {0} in {1}', targetLine, relativePath));
                }
            } else {
                vscode.window.showWarningMessage(i18n.t('File status not found for {0}', relativePath));
            }
        })
    );
}
