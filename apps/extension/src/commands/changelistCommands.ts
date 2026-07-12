import * as vscode from 'vscode';
import * as path from 'path';
import type { ChangelistFileSelection, FileStatus, GitHunk } from '@shared/messages';
import { GitService } from '../services/GitService';
import { ChangelistStateService } from '../services/ChangelistStateService';
import { InactiveChangesService } from '../services/InactiveChangesService';
import { CommitViewProvider } from '../providers/CommitViewProvider';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/logger';
import { EditorHunkResolver, findBestHunkMatch, type EditorHunkMatchTarget } from '../editor/EditorHunkResolver';
import { createRevisionContentUri } from '../utils/repositoryContentUri';
import { ChangelistOperations, createDefaultRefreshDecorations } from '../operations/ChangelistOperations';
import { copyPatchToClipboard, savePatchToFile } from '../utils/patchExport';

interface ChangelistFileContext {
    webviewSection: 'changelistFile';
    repoPath?: string;
    path: string;
    paths?: string[];
    hunkIds?: string[];
    status?: string;
    isStaged?: boolean;
    isInactive?: boolean;
    isConflict?: boolean;
    resolvedCandidate?: boolean;
    isUntracked?: boolean;
    hasStaged?: boolean;
    allStaged?: boolean;
    hasInactive?: boolean;
    allInactive?: boolean;
    hasConflict?: boolean;
    hasUntracked?: boolean;
    hasResolvedCandidate?: boolean;
    changelistMode?: 'staged' | 'changes';
    changelistId?: string;
}

interface ChangelistRootContext {
    webviewSection: 'changelistRoot';
    repoPath?: string;
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
    hasResolvedCandidate?: boolean;
    changelistMode?: 'staged' | 'changes';
}

interface ChangelistFolderContext {
    webviewSection: 'changelistFolder';
    repoPath?: string;
    path: string;
    paths: string[];
    hasStaged?: boolean;
    allStaged?: boolean;
    hasInactive?: boolean;
    allInactive?: boolean;
    hasConflict?: boolean;
    hasUntracked?: boolean;
    hasResolvedCandidate?: boolean;
    changelistMode?: 'staged' | 'changes';
    changelistId?: string;
}

interface ChangelistRepositoryContext {
    webviewSection: 'changelistRepository';
    repoPath?: string;
    paths?: string[];
    hasConflict?: boolean;
    hasStaged?: boolean;
    allStaged?: boolean;
    hasInactive?: boolean;
    allInactive?: boolean;
    hasUntracked?: boolean;
    hasResolvedCandidate?: boolean;
    changelistMode?: 'staged' | 'changes';
    changelistId?: string;
}

interface ChangelistHunkContext {
    webviewSection: 'changelistHunk';
    path: string;
    hunkId: string;
    changelistId?: string;
}

type ChangelistTargetContext = ChangelistFileContext | ChangelistFolderContext | ChangelistRootContext | ChangelistRepositoryContext;

interface LineChangeLike {
    originalStartLineNumber: number;
    originalEndLineNumber: number;
    modifiedStartLineNumber: number;
    modifiedEndLineNumber: number;
}

interface HunkMatch {
    fileStatus: FileStatus;
    hunk: GitHunk;
}

interface EditorHunkCommandArgs {
    path: string;
    hunkId: string;
}

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

function toWorktreeHunkId(hunkId: string): string {
    return hunkId.replace(':index:', ':worktree:');
}

async function hideEditorHover(): Promise<void> {
    try {
        await vscode.commands.executeCommand('editor.action.hideHover');
    } catch {
        // The command is best-effort. Older VS Code builds or non-editor invocations may not expose it.
    }
}

async function resolveEditorChangeBlockTarget(resolver: EditorHunkResolver): Promise<EditorHunkMatchTarget | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;

    logger.info('Editor change block command triggered', {
        scheme: editor.document.uri.scheme,
        query: editor.document.uri.query,
        fsPath: editor.document.uri.fsPath
    });

    return resolver.resolveCurrentTarget(editor);
}

async function resolveEditorChangeBlockTargetFromArgs(
    gitService: GitService,
    args: EditorHunkCommandArgs | undefined
): Promise<EditorHunkMatchTarget | undefined> {
    if (!args?.path || !args.hunkId) {
        return undefined;
    }

    const status = await gitService.getStatus();
    const matchingFiles = status.filter(file => file.path === args.path);
    for (const fileStatus of matchingFiles) {
        const hunk = fileStatus.hunks?.find(hunk => hunk.id === args.hunkId);
        if (hunk) {
            return {
                path: args.path,
                fileStatus,
                hunk,
                side: fileStatus.staged ? 'original' : 'modified',
                inactive: Boolean(fileStatus.inactive || fileStatus.inactiveHunkIds?.includes(hunk.id) || fileStatus.inactiveHunkIds?.includes(toWorktreeHunkId(hunk.id))),
                isDefaultChangelist: true,
                isActiveChangelist: true,
                mode: 'staged',
                matchingFiles,
                targetLine: hunk.newStart
            };
        }
    }

    return undefined;
}

async function setChangeBlockInactive(
    gitService: GitService,
    inactiveChangesService: InactiveChangesService,
    provider: CommitViewProvider,
    relativePath: string,
    matchingFiles: FileStatus[],
    hunkMatch: HunkMatch | undefined,
    targetLine: number,
    inactive: boolean
): Promise<void> {
    const fileStatus = hunkMatch?.fileStatus;
    const hunk = hunkMatch?.hunk;

    if (!fileStatus || !hunk) {
        vscode.window.showWarningMessage(i18n.t('No modified change block found at line {0} in {1}', targetLine, relativePath));
        logger.warn('Change block matching failed', { line: targetLine, relativePath, hunkCount: matchingFiles.flatMap(file => file.hunks || []).length });
        return;
    }

    logger.info('ToggleInactive matched change block', {
        relativePath,
        staged: fileStatus.staged,
        hunkId: hunk.id,
        targetLine,
        action: inactive ? 'inactive' : 'active'
    });

    const inactiveHunkIds = inactiveChangesService.getInactiveHunkIds(relativePath);
    const inactiveHunkId = fileStatus.staged ? toWorktreeHunkId(hunk.id) : hunk.id;
    const isCurrentlyInactive = inactiveHunkIds.includes(hunk.id) || inactiveHunkIds.includes(inactiveHunkId);

    if (!inactive) {
        const currentHunks = matchingFiles.flatMap(file => file.hunks || []);
        await inactiveChangesService.markMatchingHunkActive(relativePath, hunk.id, currentHunks);
        if (inactiveHunkId !== hunk.id) {
            await inactiveChangesService.markMatchingHunkActive(relativePath, inactiveHunkId, currentHunks);
        }
        provider.requestRefresh({ scopes: ['commit'], reason: 'inactive-change-updated' });
        await vscode.commands.executeCommand('intelli-git.refreshChangeBlockDecorations');
        return;
    }

    if (isCurrentlyInactive) {
        provider.requestRefresh({ scopes: ['commit'], reason: 'inactive-change-unchanged' });
        await vscode.commands.executeCommand('intelli-git.refreshChangeBlockDecorations');
        return;
    }

    if (fileStatus.staged) {
        try {
            const patch = gitService.buildPatchFromHunks([hunk]);
            await gitService.applyPatch(patch, true, true);
        } catch (e) {
            logger.error(`Failed to unstage change block for ${relativePath}:`, e);
            vscode.window.showErrorMessage(i18n.t('extension.unstageFailed', `${e}`));
            return;
        }
    }

    await inactiveChangesService.markHunkInactive(relativePath, inactiveHunkId);
    provider.requestRefresh({ scopes: ['commit'], reason: 'inactive-change-updated' });
    await vscode.commands.executeCommand('intelli-git.refreshChangeBlockDecorations');
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
        const leftUri = createRevisionContentUri(gitService, args.path, { ref: 'HEAD', preferStaged: true });
        const rightUri = createRevisionContentUri(gitService, args.path, { ref: '' });
        const title = `${path.basename(args.path)} ${i18n.t('(Staged)')}`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
        return;
    }

    if (args.status === 'D') {
        const leftUri = createRevisionContentUri(gitService, args.path, { ref: 'HEAD', preferStaged: false });
        const rightUri = createRevisionContentUri(gitService, args.path, { ref: 'WORKTREE', preferStaged: false });
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, path.basename(args.path));
        return;
    }

    const workspaceRoot = gitService.getWorkspaceRoot();
    if (workspaceRoot) {
        const uri = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
        await vscode.commands.executeCommand('git.openChange', uri);
    }
}

function decorateStatusForInactive(status: FileStatus[], inactiveChangesService: InactiveChangesService): FileStatus[] {
    return status.map(file => {
        const isFileInactive = inactiveChangesService.isInactive(file.path);
        const inactiveHunkIds = inactiveChangesService.getInactiveHunkIds(file.path);
        const inactiveHunkIdSet = new Set(inactiveHunkIds);
        const hasStagedInactive = file.staged && (
            isFileInactive ||
            file.hunks?.some(hunk =>
                inactiveHunkIdSet.has(hunk.id) ||
                inactiveHunkIdSet.has(hunk.id.replace(':index:', ':worktree:')) ||
                inactiveHunkIdSet.has(hunk.id.replace(':worktree:', ':index:'))
            )
        );

        return {
            ...file,
            inactive: isFileInactive,
            inactiveHunkIds,
            hasStagedInactive
        };
    });
}

function getChangelistPatchBaseName(args: ChangelistTargetContext, changelistStateService: ChangelistStateService): string {
    const stagedModeNames: Record<string, string> = {
        'staged-changes': 'staged-changes',
        'untracked-changes': 'untracked-changes',
        'changes': 'changes'
    };
    const listName = args.changelistMode === 'staged' && args.changelistId
        ? stagedModeNames[args.changelistId] || 'changes'
        : changelistStateService.getState().lists.find(list => list.id === args.changelistId)?.name || 'changes';

    if (args.webviewSection === 'changelistFile' && args.path) {
        return `${path.basename(args.path)}-${listName}`;
    }

    return listName;
}

async function getChangelistPatch(
    gitService: GitService,
    inactiveChangesService: InactiveChangesService,
    changelistStateService: ChangelistStateService,
    args?: ChangelistTargetContext
): Promise<{ patch: string; defaultBaseName: string }> {
    if (!args?.changelistId || args.changelistId === 'inactive-changes') {
        return { patch: '', defaultBaseName: 'changes' };
    }

    const paths = getTargetPaths(args);
    if (args.changelistMode === 'staged') {
        const defaultBaseName = getChangelistPatchBaseName(args, changelistStateService);
        if (args.changelistId === 'staged-changes') {
            return {
                patch: await gitService.getStagedDiffForFiles(paths),
                defaultBaseName
            };
        }

        if (args.changelistId === 'changes' || args.changelistId === 'untracked-changes') {
            return {
                patch: await gitService.getUnstagedDiffForFiles(paths),
                defaultBaseName
            };
        }

        return { patch: '', defaultBaseName };
    }

    if (args.changelistMode !== 'changes') {
        return { patch: '', defaultBaseName: 'changes' };
    }

    const status = await gitService.getStatus();
    inactiveChangesService.syncWithStatus(status);
    changelistStateService.syncWithStatus(status);

    const decoratedStatus = decorateStatusForInactive(status, inactiveChangesService);
    const plan = changelistStateService.buildCommitPlan(
        decoratedStatus,
        paths.length > 0 ? paths : undefined,
        args.changelistId
    );

    return {
        patch: await gitService.getDiffForChangelistPlan(plan, decoratedStatus),
        defaultBaseName: getChangelistPatchBaseName(args, changelistStateService)
    };
}

/**
 * Register changelist file-related context menu commands.
 */
export function registerChangelistCommands(
    context: vscode.ExtensionContext,
    gitService: GitService,
    inactiveChangesService: InactiveChangesService,
    changelistStateService: ChangelistStateService,
    provider: CommitViewProvider,
    resolveGitService: (repoPath?: string) => GitService | undefined = () => gitService
): void {
    const editorHunkResolver = new EditorHunkResolver(gitService, inactiveChangesService, changelistStateService);
    const changelistOperations = new ChangelistOperations({
        gitService,
        inactiveChangesService,
        changelistStateService,
        refreshCommitView: () => provider.requestRefresh({ scopes: ['commit'], reason: 'changelist-operation' }),
        refreshDecorations: createDefaultRefreshDecorations(),
        setModeContext: async mode => {
            await vscode.commands.executeCommand('setContext', 'intelli-git.changelistMode', mode);
        }
    });

    for (const [command, mode] of [
        ['intelli-git.changelistMode.staged', 'staged'],
        ['intelli-git.changelistMode.staged.current', 'staged'],
        ['intelli-git.changelistMode.changes', 'changes'],
        ['intelli-git.changelistMode.changes.current', 'changes']
    ] as const) {
        context.subscriptions.push(
            vscode.commands.registerCommand(command, async () => {
                await changelistOperations.setMode(mode);
            })
        );
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.createList', async () => {
            const changelistName = await vscode.window.showInputBox({
                prompt: i18n.t('extension.enterChangelistName'),
                value: i18n.t('Changes')
            });
            if (!changelistName?.trim()) {
                return;
            }
            await changelistOperations.createList(changelistName.trim());
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
            await changelistOperations.renameList(args.changelistId, changelistName.trim());
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
            await changelistOperations.deleteList(args.changelistId);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.setActiveList', async (args: ChangelistRootContext) => {
            if (!args?.changelistId) {
                return;
            }
            await changelistOperations.setActiveList(args.changelistId);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.moveToList', async (args: ChangelistFileContext | ChangelistHunkContext) => {
            await hideEditorHover();
            const state = changelistStateService.getState();
            let editorTarget: EditorHunkMatchTarget | undefined;
            let currentListId = args?.changelistId;

            if (!args) {
                editorTarget = await resolveEditorChangeBlockTarget(editorHunkResolver);
                if (!editorTarget) {
                    vscode.window.showWarningMessage(i18n.t('No modified change block found at line {0} in {1}', 0, ''));
                    return;
                }

                currentListId = editorTarget.changelist?.id;
            }

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

            const hunksByPath: Record<string, string[]> = {};
            const paths: string[] = [];
            let activateInactive = false;
            if (args?.webviewSection === 'changelistHunk' && args.hunkId) {
                hunksByPath[args.path] = [args.hunkId];
                activateInactive = state.mode === 'changes' && target.id !== 'inactive-changes';
            } else if (args?.webviewSection === 'changelistFile' && args.hunkIds && args.hunkIds.length > 0) {
                hunksByPath[args.path] = args.hunkIds;
                activateInactive = args.changelistMode === 'changes' && args.changelistId === 'inactive-changes' && target.id !== 'inactive-changes';
            } else if (editorTarget?.fileStatus.status === '?') {
                paths.push(editorTarget.path);
                activateInactive = editorTarget.inactive && state.mode === 'changes' && target.id !== 'inactive-changes';
            } else if (editorTarget) {
                hunksByPath[editorTarget.path] = [editorTarget.hunk.id];
                activateInactive = editorTarget.inactive && state.mode === 'changes' && target.id !== 'inactive-changes';
            } else if (args?.path) {
                paths.push(args.path);
                activateInactive = args.webviewSection === 'changelistFile' && args.changelistMode === 'changes' && args.changelistId === 'inactive-changes' && target.id !== 'inactive-changes';
            }

            await changelistOperations.moveChangesToChangelist({
                targetListId: target.id,
                paths,
                hunksByPath,
                activateInactive
            });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.openFile', async (args: ChangelistFileContext) => {
            if (args?.path) {
                if (args.status === 'D') {
                    await showDiffForChangelistFile(gitService, args);
                    return;
                }

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
        vscode.commands.registerCommand('intelli-git.changelist.createPatch.copy', async (args: ChangelistTargetContext) => {
            const { patch } = await getChangelistPatch(gitService, inactiveChangesService, changelistStateService, args);
            await copyPatchToClipboard(patch);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.createPatch.save', async (args: ChangelistTargetContext) => {
            const { patch, defaultBaseName } = await getChangelistPatch(gitService, inactiveChangesService, changelistStateService, args);
            await savePatchToFile(patch, {
                workspaceRoot: gitService.getWorkspaceRoot(),
                defaultBaseName
            });
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
                        provider.requestRefresh({ scopes: ['commit'], reason: 'changelist-operation' });
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
                    provider.requestRefresh({ scopes: ['commit'], reason: 'changelist-operation' });
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
                            provider.requestRefresh({ scopes: ['commit'], reason: 'changelist-operation' });
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
                await changelistOperations.markFilesInactive(paths);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.markActive', async (args: ChangelistTargetContext) => {
            const paths = getTargetPaths(args);
            if (paths.length > 0) {
                await changelistOperations.markFilesActive(paths);
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
                provider.requestRefresh({ scopes: ['commit'], reason: 'changelist-operation' });
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
                provider.requestRefresh({ scopes: ['commit'], reason: 'changelist-operation' });
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
                await (resolveGitService(args.repoPath) || gitService).resolveConflict(args.path, 'ours');
                provider.requestRefresh({ scopes: ['commit'], reason: 'changelist-operation' });
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
                await (resolveGitService(args.repoPath) || gitService).resolveConflict(args.path, 'theirs');
                provider.requestRefresh({ scopes: ['commit'], reason: 'changelist-operation' });
            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.resolveConflictFailed', `${e}`));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.markResolved', async (args: ChangelistTargetContext) => {
            const requestedPaths = getTargetPaths(args);
            const hasResolvedCandidate = Boolean(args && 'resolvedCandidate' in args && args.resolvedCandidate) ||
                Boolean(args?.hasResolvedCandidate);
            if (requestedPaths.length === 0 || !args?.hasConflict || !hasResolvedCandidate) {
                return;
            }

            try {
                const service = resolveGitService(args.repoPath) || gitService;
                const requestedPathSet = new Set(requestedPaths);
                const resolvedPaths = (await service.getStatus())
                    .filter(file => requestedPathSet.has(file.path))
                    .filter(file => (file.status === 'C' || file.status === 'U') && file.resolvedCandidate)
                    .map(file => file.path);
                if (resolvedPaths.length === 0) {
                    return;
                }

                if (resolvedPaths.length === 1) {
                    await service.stageFile(resolvedPaths[0]);
                } else {
                    await service.stageFiles(resolvedPaths);
                }
                provider.requestRefresh({ scopes: ['commit'], reason: 'changelist-operation' });
            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.stageFailed', `${e}`));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.moveHunkToInactive', async (args?: EditorHunkCommandArgs) => {
            await hideEditorHover();
            editorHunkResolver.invalidate();
            const target = await resolveEditorChangeBlockTargetFromArgs(gitService, args) || await resolveEditorChangeBlockTarget(editorHunkResolver);
            if (!target) return;
            await setChangeBlockInactive(
                gitService,
                inactiveChangesService,
                provider,
                target.path,
                target.matchingFiles,
                { fileStatus: target.fileStatus, hunk: target.hunk },
                target.targetLine,
                true
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.moveHunkToActive', async (args?: EditorHunkCommandArgs) => {
            await hideEditorHover();
            editorHunkResolver.invalidate();
            const target = await resolveEditorChangeBlockTargetFromArgs(gitService, args) || await resolveEditorChangeBlockTarget(editorHunkResolver);
            if (!target) return;
            await setChangeBlockInactive(
                gitService,
                inactiveChangesService,
                provider,
                target.path,
                target.matchingFiles,
                { fileStatus: target.fileStatus, hunk: target.hunk },
                target.targetLine,
                false
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.hunk.toggleInactive', async (...args) => {
            let uri: vscode.Uri | undefined;
            let targetLine: number | undefined;
            let lineChange: LineChangeLike | undefined;

            logger.info('ToggleInactive triggered with args:', JSON.stringify(args));

            if (args.length >= 2 && args[0] instanceof vscode.Uri) {
                // From scm/change/title (Quick Diff)
                // args: [uri, changes (LineChange[]), index]
                uri = args[0];
                const changes = args[1];
                const index = args[2];
                if (changes && changes.length > index) {
                    lineChange = changes[index];
                    targetLine = lineChange?.modifiedStartLineNumber;
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
            if (uri.scheme === 'intelli-git-revision') {
                try {
                    const parsed = JSON.parse(uri.query);
                    let rawPath = parsed.path || parsed.fsPath || (typeof parsed === 'string' ? parsed : null);
                    if (!rawPath) rawPath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;
                    if (rawPath) filePath = path.isAbsolute(rawPath) ? rawPath : path.join(workspaceRoot, rawPath);
                } catch { /* ignore */ }
            } else if (uri.scheme === 'git' && uri.authority === 'index') {
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
            const hunkMatch = findBestHunkMatch(matchingFiles, lineChange, targetLine);
            const inactiveHunkIds = inactiveChangesService.getInactiveHunkIds(relativePath);
            const hunk = hunkMatch?.hunk;
            const inactiveHunkId = hunkMatch?.fileStatus.staged && hunk ? toWorktreeHunkId(hunk.id) : hunk?.id;
            const shouldMoveInactive = hunk ? !(inactiveHunkIds.includes(hunk.id) || (inactiveHunkId ? inactiveHunkIds.includes(inactiveHunkId) : false)) : true;

            await setChangeBlockInactive(
                gitService,
                inactiveChangesService,
                provider,
                relativePath,
                matchingFiles,
                hunkMatch,
                targetLine,
                shouldMoveInactive
            );
        })
    );
}
