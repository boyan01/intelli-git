import * as vscode from 'vscode';
import * as path from 'path';
import { CommitViewProvider, GitLogViewProvider, StashContentProvider, RevisionContentProvider } from './providers';
import { RepositoryManager, type RepositoryScope } from './services/RepositoryManager';
import { createGitWatcher } from './services/GitRepositoryWatcher';
import { BranchStatusBar, GitLogStatusBar } from './ui';
import { registerStashCommands, registerGlobalNavigationCommands, registerWorktreeCommands, registerBranchCommands, registerLogCommands, registerLogFileCommands, registerChangelistCommands, registerAiCommands, registerEditorGitCommands } from './commands';
import { logger } from './utils/logger';
import { ChangeBlockEditorController } from './editor/ChangeBlockEditorController';

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
        repo
    };
}

function showRepositoryQuickPick(repositoryManager: RepositoryManager, onRepositoryChanged: () => void): void {
    const repositories = repositoryManager.getRepositories().filter(repo => repo.kind !== 'worktree');
    if (repositories.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No repositories available'));
        return;
    }

    const activeRepoPath = repositoryManager.getActiveRepoPath();
    const openInNewWindowButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('multiple-windows'),
        tooltip: vscode.l10n.t('Open in New Window')
    };
    const items = repositories.map(repo => createRepositoryQuickPickItem(repo, activeRepoPath, openInNewWindowButton));
    const activeItem = items.find(item => item.repo.path === activeRepoPath);
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
            if (selected && selected.repo.path !== activeRepoPath && repositoryManager.setActiveRepository(selected.repo.path)) {
                onRepositoryChanged();
            }
            quickPick.hide();
        }),
        quickPick.onDidTriggerItemButton(event => {
            void vscode.commands.executeCommand(
                'vscode.openFolder',
                vscode.Uri.file(event.item.repo.path),
                { forceNewWindow: true }
            );
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

async function addRepositoryFromDialog(repositoryManager: RepositoryManager, onRepositoryChanged: () => void): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: vscode.l10n.t('Add Repository')
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

async function scanWorkspaceRepositories(repositoryManager: RepositoryManager, onRepositoryChanged: () => void): Promise<void> {
    const candidates = await repositoryManager.discoverWorkspaceRepositories();
    if (candidates.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No Git repositories found in this workspace.'));
        return;
    }

    const selected = await vscode.window.showQuickPick(
        candidates.map(repo => ({
            label: repo.name,
            description: getRepositoryRefLabel(repo),
            detail: repo.path,
            repo
        })),
        {
            canPickMany: true,
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: vscode.l10n.t('Select repositories to add')
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
        const isWorkspaceBacked = workspaceRoots.some(root => isSameOrDescendantPath(root, repo.workspaceRoot));
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
        repositoryManager.onDidFallbackActiveRepo(event => {
            if (event.nextRepoPath) {
                void vscode.window.showWarningMessage(vscode.l10n.t(
                    'The previously active repository is no longer available. Intelli Git switched to {0}.',
                    path.basename(event.nextRepoPath)
                ));
                return;
            }

            void vscode.window.showWarningMessage(vscode.l10n.t(
                'The previously active repository is no longer available. Select a repository to continue.'
            ));
        })
    );
    await repositoryManager.initialize();

    if (!repositoryManager.getActiveService()) {
        logger.info('Intelli Git: No git repository found.');
    }

    // Initialize providers
    const providerOptions = {
        extensionUri: context.extensionUri,
        context,
        repositoryManager
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

        const workspaceRoots = folders.map(folder => folder.uri.fsPath);
        const additionalRoots = getAdditionalGitWatcherRoots(repositoryManager.getRepositories(), workspaceRoots);
        const watcher = await createGitWatcher(context, workspaceRoots, additionalRoots);
        if (generation !== gitWatcherGeneration) {
            watcher.dispose();
            return;
        }

        gitWatcherDisposables.push(
            watcher.onChange(() => {
                repositoryManager.initialize().catch(e => logger.error('Failed to rescan repositories after git watcher change', e));
                triggerRefresh();
            }),
            watcher
        );
    };

    const updateRepositoryContext = () => {
        const repositories = repositoryManager.getRepositories().filter(repo => repo.kind !== 'worktree');
        void vscode.commands.executeCommand('setContext', 'intelli-git.hasActiveRepository', Boolean(repositoryManager.getActiveService()));
        void vscode.commands.executeCommand('setContext', 'intelli-git.hasMultipleRepositories', repositories.length > 1);
    };

    const updateRemoteProviderContext = async () => {
        const gitService = repositoryManager.getActiveService();
        const remoteLink = gitService ? await gitService.branchRemote.getRemoteLinkInfo() : undefined;
        await vscode.commands.executeCommand('setContext', 'intelli-git.gitRemoteProvider', remoteLink?.provider || '');
        await vscode.commands.executeCommand('setContext', 'intelli-git.remoteLink.commit', Boolean(remoteLink?.capabilities.commit));
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

    const triggerRefresh = () => {
        provider.rpc?.refresh();
        gitLogProvider.rpc?.refresh();
        branchStatusBar?.update();
        gitLogStatusBar?.update();
        changeBlockEditorController?.refresh();
        void updateRemoteProviderContext();
        void updateWorktreesContext();
    };

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
            subscriptions: repoBoundDisposables
        } as Pick<vscode.ExtensionContext, 'subscriptions'> as vscode.ExtensionContext;

        const activeScope = repositoryManager.getActiveScope();
        branchStatusBar = new BranchStatusBar(gitService, activeScope);
        gitLogStatusBar = new GitLogStatusBar(gitService, activeScope);
        changeBlockEditorController = new ChangeBlockEditorController(gitService, inactiveChangesService, changelistStateService, provider);

        registerStashCommands(repoContext, gitService, provider);
        registerWorktreeCommands(repoContext, gitService, repositoryManager, provider);
        registerBranchCommands(repoContext, gitService, gitLogProvider);
        registerLogCommands(repoContext, gitService);
        registerLogFileCommands(repoContext, gitService);
        registerChangelistCommands(repoContext, gitService, inactiveChangesService, changelistStateService, provider);
        registerEditorGitCommands(repoContext, gitService, gitLogProvider);

        repoBoundDisposables.push(
            branchStatusBar,
            gitLogStatusBar,
            changeBlockEditorController,
            gitService.onDidChange(triggerRefresh)
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
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(CommitViewProvider.viewType, provider)
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(GitLogViewProvider.viewType, gitLogProvider)
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
            triggerRefresh();
            void resetGitWatcher();
        }
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
            triggerRefresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.repository.scanWorkspace', async () => {
            await scanWorkspaceRepositories(repositoryManager, updateRepositoryContext);
            triggerRefresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.repository.removeFromWorkspace', async (args?: { repoPath?: string }) => {
            if (!args?.repoPath) {
                return;
            }
            await repositoryManager.removeRepository(args.repoPath);
            updateRepositoryContext();
            triggerRefresh();
        })
    );

    // Git watcher: uses VS Code Git extension API, falls back to FileSystemWatcher.
    void resetGitWatcher();

    context.subscriptions.push(
        repositoryManager.onDidChangeActiveRepo(() => {
            bindActiveRepository();
            triggerRefresh();
        }),
        repositoryManager.onDidChangeRepositories(() => {
            updateRepositoryContext();
            void resetGitWatcher();
            triggerRefresh();
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void repositoryManager.initialize()
                .then(() => {
                    bindActiveRepository();
                    triggerRefresh();
                    void resetGitWatcher();
                })
                .catch(e => logger.error('Failed to refresh repositories after workspace folder change', e));
        })
    );

    // Watch for diagnostic changes to update file error status in changelist
    context.subscriptions.push(
        vscode.languages.onDidChangeDiagnostics(() => {
            triggerRefresh();
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('intelli-git.changelist.mode')) {
                updateChangelistModeContext();
                triggerRefresh();
            }
        })
    );
}

export function deactivate() { }
