import * as vscode from 'vscode';
import * as path from 'path';
import {
    CommitViewProvider,
    ConflictResolverPanel,
    GitLogViewProvider,
    openConflictFile,
    StashContentProvider,
    RevisionContentProvider,
} from './providers';
import { RepositoryManager, type RepositoryScope } from './services/RepositoryManager';
import { createGitWatcher } from './services/GitRepositoryWatcher';
import { BackgroundFetchService } from './services/BackgroundFetchService';
import { ParentRepositoryScmIntegrationService } from './services/ParentRepositoryScmIntegrationService';
import { BranchStatusBar, GitLogStatusBar } from './ui';
import {
    registerStashCommands,
    registerGlobalNavigationCommands,
    registerWorktreeCommands,
    registerBranchCommands,
    registerLogCommands,
    registerLogFileCommands,
    registerChangelistCommands,
    registerAiCommands,
    registerEditorGitCommands,
} from './commands';
import { logger } from './utils/logger';
import { ChangeBlockEditorController } from './editor/ChangeBlockEditorController';
import type { ConflictResolverContextAction, RefreshScope } from '@shared/messages';
import type { MergeEditorContext } from '@shared/webviewContext';

interface RepositoryQuickPickItem extends vscode.QuickPickItem {
    repo: RepositoryScope;
}

function getRepositoryKindLabel(repo: RepositoryScope): string {
    if (repo.kind === 'worktree') {
        return vscode.l10n.t('Worktree');
    }

    if (repo.kind === 'submodule' || repo.isSubmodule) {
        return vscode.l10n.t('Submodule');
    }

    return vscode.l10n.t('Workspace');
}

function getRepositoryRefLabel(repo: RepositoryScope): string | undefined {
    if (repo.branch) {
        return repo.branch;
    }

    if (repo.isDetached && repo.head) {
        return vscode.l10n.t('Detached at {0}', repo.head.substring(0, 7));
    }

    return undefined;
}

function createRepositoryQuickPickItem(
    repo: RepositoryScope,
    activeRepoPath: string | undefined,
    openInNewWindowButton: vscode.QuickInputButton
): RepositoryQuickPickItem {
    const descriptionParts = [];
    if (repo.path === activeRepoPath) {
        descriptionParts.push(vscode.l10n.t('Current'));
    }
    descriptionParts.push(getRepositoryKindLabel(repo));
    const refLabel = getRepositoryRefLabel(repo);
    if (refLabel) {
        descriptionParts.push(refLabel);
    }

    return {
        label: repo.name,
        description: descriptionParts.join(' · '),
        detail: repo.path,
        buttons: [openInNewWindowButton],
        repo,
    };
}

function showRepositoryQuickPick(repositoryManager: RepositoryManager, onRepositoryChanged: () => void): void {
    const repositories = repositoryManager.getRepositories().filter((repo) => repo.kind !== 'worktree');
    if (repositories.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No repositories available'));
        return;
    }

    const activeRepoPath = repositoryManager.getActiveRepoPath();
    const openInNewWindowButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('multiple-windows'),
        tooltip: vscode.l10n.t('Open in New Window'),
    };
    const items = repositories.map((repo) =>
        createRepositoryQuickPickItem(repo, activeRepoPath, openInNewWindowButton)
    );
    const activeItem = items.find((item) => item.repo.path === activeRepoPath);
    const quickPick = vscode.window.createQuickPick<RepositoryQuickPickItem>();
    const disposables: vscode.Disposable[] = [];

    quickPick.placeholder = vscode.l10n.t('Switch Repository...');
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.items = items;
    if (activeItem) {
        quickPick.activeItems = [activeItem];
    }

    disposables.push(
        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0] || quickPick.activeItems[0];
            if (
                selected &&
                selected.repo.path !== activeRepoPath &&
                repositoryManager.setActiveRepository(selected.repo.path)
            ) {
                onRepositoryChanged();
            }
            quickPick.hide();
        }),
        quickPick.onDidTriggerItemButton((event) => {
            void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(event.item.repo.path), {
                forceNewWindow: true,
            });
            quickPick.hide();
        }),
        quickPick.onDidHide(() => {
            for (const disposable of disposables) {
                disposable.dispose();
            }
            quickPick.dispose();
        })
    );

    quickPick.show();
}

async function addRepositoryFromDialog(
    repositoryManager: RepositoryManager,
    onRepositoryChanged: () => void
): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: vscode.l10n.t('Add Repository'),
    });

    const folder = selected?.[0]?.fsPath;
    if (!folder) {
        return;
    }

    const repository = await repositoryManager.addRepository(folder);
    if (!repository) {
        void vscode.window.showWarningMessage(vscode.l10n.t('Selected folder is not a Git repository.'));
        return;
    }

    onRepositoryChanged();
}

async function scanWorkspaceRepositories(
    repositoryManager: RepositoryManager,
    onRepositoryChanged: () => void
): Promise<void> {
    const candidates = await repositoryManager.discoverWorkspaceRepositories();
    if (candidates.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No Git repositories found in this workspace.'));
        return;
    }

    const selected = await vscode.window.showQuickPick(
        candidates.map((repo) => ({
            label: repo.name,
            description: getRepositoryRefLabel(repo),
            detail: repo.path,
            repo,
        })),
        {
            canPickMany: true,
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: vscode.l10n.t('Select repositories to add'),
        }
    );

    if (!selected || selected.length === 0) {
        return;
    }

    for (const item of selected) {
        await repositoryManager.addRepository(item.repo.path);
    }
    onRepositoryChanged();
}

function isSameOrDescendantPath(parentPath: string, candidatePath: string): boolean {
    const relativePath = path.relative(parentPath, candidatePath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function getAdditionalGitWatcherRoots(repositories: RepositoryScope[], workspaceRoots: string[]): string[] {
    const roots = new Set<string>();

    for (const repo of repositories) {
        const isWorkspaceBacked = workspaceRoots.some((root) => isSameOrDescendantPath(root, repo.workspaceRoot));
        if (repo.kind !== 'worktree' && isWorkspaceBacked) {
            continue;
        }

        roots.add(repo.workspaceRoot);
        if (repo.gitDir) {
            roots.add(repo.gitDir);
        }
    }

    return Array.from(roots);
}

export async function activate(context: vscode.ExtensionContext) {
    logger.initLogger(context);
    logger.info('Intelli Git is now active!');

    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        logger.info('Intelli Git: No workspace opened.');
    }

    // Initialize RepositoryManager
    const repositoryManager = new RepositoryManager(context);
    context.subscriptions.push(
        repositoryManager,
        repositoryManager.onDidFallbackActiveRepo((event) => {
            if (event.nextRepoPath) {
                void vscode.window.showWarningMessage(
                    vscode.l10n.t(
                        'The previously active repository is no longer available. Intelli Git switched to {0}.',
                        path.basename(event.nextRepoPath)
                    )
                );
                return;
            }

            void vscode.window.showWarningMessage(
                vscode.l10n.t(
                    'The previously active repository is no longer available. Select a repository to continue.'
                )
            );
        })
    );
    await repositoryManager.initialize();
    const parentRepositoryScmIntegration = new ParentRepositoryScmIntegrationService(repositoryManager);
    context.subscriptions.push(parentRepositoryScmIntegration);
    parentRepositoryScmIntegration.scheduleCheck();

    if (!repositoryManager.getActiveService()) {
        logger.info('Intelli Git: No git repository found.');
    }

    // Initialize providers
    const providerOptions = {
        extensionUri: context.extensionUri,
        context,
        repositoryManager,
    };
    const provider = new CommitViewProvider(providerOptions);
    const gitLogProvider = new GitLogViewProvider(providerOptions);
    const stashContentProvider = new StashContentProvider(repositoryManager);
    const revisionContentProvider = new RevisionContentProvider(repositoryManager);

    let branchStatusBar: BranchStatusBar | undefined;
    let gitLogStatusBar: GitLogStatusBar | undefined;
    let changeBlockEditorController: ChangeBlockEditorController | undefined;
    let repoBoundDisposables: vscode.Disposable[] = [];
    let gitWatcherDisposables: vscode.Disposable[] = [];
    let gitWatcherGeneration = 0;
    const gitStateRefreshScopes: RefreshScope[] = ['commit', 'branch', 'push', 'stash', 'gitLog'];
    const repositoryRefreshScopes: RefreshScope[] = ['commit', 'branch', 'worktrees', 'push', 'stash', 'gitLog'];

    const disposeRepoBoundDisposables = () => {
        for (const disposable of repoBoundDisposables.splice(0)) {
            disposable.dispose();
        }
        branchStatusBar = undefined;
        gitLogStatusBar = undefined;
        changeBlockEditorController = undefined;
    };

    context.subscriptions.push({ dispose: disposeRepoBoundDisposables });

    const disposeGitWatcher = () => {
        for (const disposable of gitWatcherDisposables.splice(0)) {
            disposable.dispose();
        }
    };

    context.subscriptions.push({ dispose: disposeGitWatcher });

    const resetGitWatcher = async () => {
        const generation = ++gitWatcherGeneration;
        disposeGitWatcher();

        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return;
        }

        const workspaceRoots = folders.map((folder) => folder.uri.fsPath);
        const additionalRoots = getAdditionalGitWatcherRoots(repositoryManager.getRepositories(), workspaceRoots);
        const watcher = await createGitWatcher(context, workspaceRoots, additionalRoots);
        if (generation !== gitWatcherGeneration) {
            watcher.dispose();
            return;
        }

        gitWatcherDisposables.push(
            watcher.onChange((change) => {
                const activeService = repositoryManager.getActiveService();
                for (const repository of repositoryManager.getRepositories()) {
                    const service = repositoryManager.getService(repository.repoPath);
                    if (service !== activeService) {
                        service?.invalidateStatusCache();
                    }
                }

                if (change.kind === 'repositories') {
                    void repositoryManager
                        .initialize()
                        .then(() => requestRefresh('repository-watcher', repositoryRefreshScopes, true))
                        .catch((e) => logger.error('Failed to rescan repositories after git watcher change', e));
                    return;
                }
                if (!activeService) {
                    requestRefresh('git-watcher', gitStateRefreshScopes);
                    return;
                }
                void activeService
                    .refreshStatusCache()
                    .then(({ commitChanged, branchChanged }) => {
                        const scopes: RefreshScope[] = ['stash'];
                        if (commitChanged) {
                            scopes.push('commit');
                        }
                        if (branchChanged) {
                            scopes.push('branch', 'push', 'gitLog');
                        }
                        if (scopes.length === 1) {
                            logger.debug('[refresh] skipped unchanged git watcher state');
                        }
                        requestRefresh('git-watcher', scopes);
                    })
                    .catch((error) => {
                        activeService.invalidateStatusCache();
                        logger.warn('Failed to pre-refresh Git status after watcher change', error);
                        requestRefresh('git-watcher-fallback', gitStateRefreshScopes);
                    });
            }),
            watcher
        );
    };

    const updateRepositoryContext = () => {
        const repositories = repositoryManager.getRepositories().filter((repo) => repo.kind !== 'worktree');
        void vscode.commands.executeCommand(
            'setContext',
            'intelli-git.hasActiveRepository',
            Boolean(repositoryManager.getActiveService())
        );
        void vscode.commands.executeCommand(
            'setContext',
            'intelli-git.hasMultipleRepositories',
            repositories.length > 1
        );
    };

    const updateRemoteProviderContext = async () => {
        const gitService = repositoryManager.getActiveService();
        const remoteLink = gitService ? await gitService.branchRemote.getRemoteLinkInfo() : undefined;
        await vscode.commands.executeCommand('setContext', 'intelli-git.gitRemoteProvider', remoteLink?.provider || '');
        await vscode.commands.executeCommand(
            'setContext',
            'intelli-git.remoteLink.commit',
            Boolean(remoteLink?.capabilities.commit)
        );
    };

    const updateChangelistModeContext = () => {
        const mode = repositoryManager.getActiveService()?.changelistStateService?.getState().mode || 'staged';
        void vscode.commands.executeCommand('setContext', 'intelli-git.changelistMode', mode);
    };

    const updateWorktreesContext = async () => {
        const gitService = repositoryManager.getActiveService();
        if (!gitService) {
            void vscode.commands.executeCommand('setContext', 'intelli-git.hasMultipleWorktrees', false);
            return;
        }
        try {
            const worktrees = await gitService.branchRemote.getWorktrees(repositoryManager.getActiveRepoPath());
            void vscode.commands.executeCommand('setContext', 'intelli-git.hasMultipleWorktrees', worktrees.length > 1);
        } catch {
            void vscode.commands.executeCommand('setContext', 'intelli-git.hasMultipleWorktrees', false);
        }
    };

    const requestRefresh = (
        reason: string,
        scopes: RefreshScope[] = gitStateRefreshScopes,
        refreshRepositoryContext = false
    ) => {
        logger.debug('[refresh] requested', {
            reason,
            scopes: scopes.join(','),
            commitViewVisible: provider.isVisible(),
            gitLogVisible: gitLogProvider.isVisible(),
        });
        const localChangesScopes = scopes.filter((scope) => scope !== 'gitLog');
        if (localChangesScopes.length > 0) {
            provider.requestRefresh({ scopes: localChangesScopes, reason });
        }
        if (scopes.includes('gitLog')) {
            gitLogProvider.requestRefresh({ scopes: ['gitLog'], reason });
        }
        if (scopes.includes('branch')) {
            void branchStatusBar?.update();
        }
        if (scopes.includes('commit')) {
            changeBlockEditorController?.refresh();
        }
        if (refreshRepositoryContext) {
            void updateRemoteProviderContext();
            void updateWorktreesContext();
        }
    };

    const backgroundFetchService = new BackgroundFetchService(repositoryManager, () => {
        requestRefresh('background-fetch', ['branch', 'push', 'gitLog']);
    });
    context.subscriptions.push(backgroundFetchService);

    const bindActiveRepository = () => {
        disposeRepoBoundDisposables();

        const gitService = repositoryManager.getActiveService();
        const inactiveChangesService = gitService?.inactiveChangesService;
        const changelistStateService = gitService?.changelistStateService;
        if (!gitService || !inactiveChangesService || !changelistStateService) {
            updateRepositoryContext();
            void updateRemoteProviderContext();
            updateChangelistModeContext();
            void updateWorktreesContext();
            return;
        }

        const repoContext = {
            subscriptions: repoBoundDisposables,
        } as Pick<vscode.ExtensionContext, 'subscriptions'> as vscode.ExtensionContext;

        const activeScope = repositoryManager.getActiveScope();
        branchStatusBar = new BranchStatusBar(gitService, activeScope);
        gitLogStatusBar = new GitLogStatusBar(gitService, activeScope);
        changeBlockEditorController = new ChangeBlockEditorController(
            gitService,
            inactiveChangesService,
            changelistStateService,
            provider
        );

        registerStashCommands(repoContext, gitService, provider);
        registerWorktreeCommands(repoContext, gitService, repositoryManager, provider);
        registerBranchCommands(repoContext, gitService, gitLogProvider);
        registerLogCommands(repoContext, gitService);
        registerLogFileCommands(repoContext, gitService);
        registerChangelistCommands(
            repoContext,
            gitService,
            inactiveChangesService,
            changelistStateService,
            provider,
            (repoPath) => (repoPath ? repositoryManager.getService(repoPath) : repositoryManager.getActiveService())
        );
        registerEditorGitCommands(repoContext, gitService, gitLogProvider);

        repoBoundDisposables.push(
            branchStatusBar,
            gitLogStatusBar,
            changeBlockEditorController,
            gitService.onWillRunGitMutation(() =>
                backgroundFetchService.cancelActiveFetch('interactive-git-operation')
            ),
            gitService.onDidChange((kind) =>
                requestRefresh(
                    kind === 'remote' ? 'git-remote' : 'git-mutation',
                    kind === 'remote' ? ['branch', 'push', 'gitLog'] : gitStateRefreshScopes
                )
            )
        );

        updateRepositoryContext();
        void updateRemoteProviderContext();
        updateChangelistModeContext();
        void updateWorktreesContext();
    };

    // Register content providers
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('intelli-git-stash', stashContentProvider)
    );
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('intelli-git-revision', revisionContentProvider)
    );

    // Register webview providers
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(CommitViewProvider.viewType, provider));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(GitLogViewProvider.viewType, gitLogProvider));
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'intelli-git.openConflictResolver',
            (file?: { path?: string; repoPath?: string }) => {
                if (!file?.path) {
                    return;
                }

                void openConflictFile(
                    {
                        extensionUri: context.extensionUri,
                        context,
                        repositoryManager,
                    },
                    { path: file.path, repoPath: file.repoPath }
                );
            }
        )
    );
    const conflictResolverContextCommands: ReadonlyArray<[string, ConflictResolverContextAction]> = [
        ['intelli-git.merge.acceptLeft', 'acceptLeft'],
        ['intelli-git.merge.cancelLeft', 'cancelLeft'],
        ['intelli-git.merge.acceptRight', 'acceptRight'],
        ['intelli-git.merge.cancelRight', 'cancelRight'],
        ['intelli-git.merge.markReviewed', 'markReviewed'],
    ];
    context.subscriptions.push(
        ...conflictResolverContextCommands.map(([command, action]) =>
            vscode.commands.registerCommand(command, (args?: MergeEditorContext) => {
                if (!args?.path || !args.changeGroupId) {
                    return;
                }
                ConflictResolverPanel.dispatchContextAction({
                    path: args.path,
                    repoPath: args.repoPath,
                    groupId: args.changeGroupId,
                    action,
                });
            })
        )
    );

    registerAiCommands(context, provider);
    registerGlobalNavigationCommands(context, {
        gitLogProvider,
        commitViewProvider: provider,
        getBranchStatusBar: () => branchStatusBar,
        hasActiveRepository: () => Boolean(repositoryManager.getActiveService()),
        onRefresh: async () => {
            await repositoryManager.initialize();
            bindActiveRepository();
            requestRefresh('manual', repositoryRefreshScopes, true);
            void resetGitWatcher();
        },
    });
    bindActiveRepository();

    // Register Author Context Menu Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.copyAuthorEmail', async (args) => {
            if (args && args.email) {
                await vscode.env.clipboard.writeText(args.email);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.sendAuthorEmail', (args) => {
            if (args && args.email) {
                vscode.env.openExternal(vscode.Uri.parse(`mailto:${args.email}`));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.repository.switch', () => {
            showRepositoryQuickPick(repositoryManager, updateRepositoryContext);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.repository.add', async () => {
            await addRepositoryFromDialog(repositoryManager, updateRepositoryContext);
            requestRefresh('repository-added', repositoryRefreshScopes, true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.repository.scanWorkspace', async () => {
            await scanWorkspaceRepositories(repositoryManager, updateRepositoryContext);
            requestRefresh('repository-scan', repositoryRefreshScopes, true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'intelli-git.repository.removeFromWorkspace',
            async (args?: { repoPath?: string }) => {
                if (!args?.repoPath) {
                    return;
                }
                await repositoryManager.removeRepository(args.repoPath);
                updateRepositoryContext();
                requestRefresh('repository-removed', repositoryRefreshScopes, true);
            }
        )
    );

    // Git watcher: uses VS Code Git extension API, falls back to FileSystemWatcher.
    void resetGitWatcher();

    context.subscriptions.push(
        repositoryManager.onDidChangeActiveRepo(() => {
            bindActiveRepository();
            requestRefresh('active-repository', repositoryRefreshScopes, true);
        }),
        repositoryManager.onDidChangeRepositories(() => {
            updateRepositoryContext();
            void backgroundFetchService.refreshRepositories();
            void resetGitWatcher();
            requestRefresh('repositories-changed', repositoryRefreshScopes, true);
        })
    );

    // Watch for diagnostic changes to update file error status in changelist
    context.subscriptions.push(
        vscode.languages.onDidChangeDiagnostics((event) => {
            const gitService = repositoryManager.getActiveService();
            const repoPath = repositoryManager.getActiveRepoPath();
            if (!gitService || !repoPath || !provider.isVisible()) {
                return;
            }

            const workspaceRoot = gitService.getWorkspaceRoot();
            const files = event.uris.flatMap((uri) => {
                if (uri.scheme !== 'file') {
                    return [];
                }
                const relativePath = path.relative(workspaceRoot, uri.fsPath);
                if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                    return [];
                }
                const error = vscode.languages
                    .getDiagnostics(uri)
                    .some((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error);
                return [{ path: relativePath.replace(/\\/g, '/'), error }];
            });
            if (files.length > 0) {
                provider.sendFileDiagnosticsChange({ repoPath, files });
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('intelli-git.changelist.mode')) {
                updateChangelistModeContext();
                repositoryManager.getActiveService()?.invalidateStatusCache();
                requestRefresh('changelist-mode', ['commit']);
            }
        })
    );
}

export function deactivate() {}
