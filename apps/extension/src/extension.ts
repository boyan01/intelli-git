import * as vscode from 'vscode';
import { CommitViewProvider, GitLogViewProvider, StashContentProvider, RevisionContentProvider } from './providers';
import { RepositoryManager } from './services/RepositoryManager';
import { createGitWatcher } from './services/GitRepositoryWatcher';
import { BranchStatusBar, GitLogStatusBar } from './ui';
import { registerStashCommands, registerGlobalNavigationCommands, registerNavigationCommands, registerBranchCommands, registerLogCommands, registerLogFileCommands, registerChangelistCommands, registerAiCommands, registerEditorGitCommands } from './commands';
import { logger } from './utils/logger';
import { ChangeBlockEditorController } from './editor/ChangeBlockEditorController';

export async function activate(context: vscode.ExtensionContext) {
    logger.initLogger(context);
    logger.info('Intelli Git is now active!');

    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        logger.info('Intelli Git: No workspace opened.');
    }

    // Initialize RepositoryManager
    const repositoryManager = new RepositoryManager(context);
    context.subscriptions.push(repositoryManager);
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

        const watcher = await createGitWatcher(context, folders.map(folder => folder.uri.fsPath));
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
        const repositories = repositoryManager.getRepositories();
        void vscode.commands.executeCommand('setContext', 'intelli-git.hasMultipleRepositories', repositories.length > 1);
    };

    const updateRemoteProviderContext = async () => {
        const gitService = repositoryManager.getActiveService();
        const provider = gitService ? await gitService.branchRemote.getRemoteProvider() : undefined;
        await vscode.commands.executeCommand('setContext', 'intelli-git.gitRemoteProvider', provider || '');
    };

    const updateChangelistModeContext = () => {
        const mode = repositoryManager.getActiveService()?.changelistStateService?.getState().mode || 'staged';
        void vscode.commands.executeCommand('setContext', 'intelli-git.changelistMode', mode);
    };

    const triggerRefresh = () => {
        provider.rpc?.refresh();
        gitLogProvider.rpc?.refresh();
        branchStatusBar?.update();
        gitLogStatusBar?.update();
        changeBlockEditorController?.refresh();
        void updateRemoteProviderContext();
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
            return;
        }

        const repoContext = {
            subscriptions: repoBoundDisposables
        } as Pick<vscode.ExtensionContext, 'subscriptions'> as vscode.ExtensionContext;

        branchStatusBar = new BranchStatusBar(gitService);
        gitLogStatusBar = new GitLogStatusBar(gitService);
        changeBlockEditorController = new ChangeBlockEditorController(gitService, inactiveChangesService, changelistStateService, provider);

        registerStashCommands(repoContext, gitService, provider);
        registerNavigationCommands(repoContext, branchStatusBar, provider);
        registerBranchCommands(repoContext, gitService, provider);
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

    registerAiCommands(context);
    registerGlobalNavigationCommands(context, gitLogProvider);
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
        vscode.commands.registerCommand('intelli-git.repository.switch', async () => {
            const repositories = repositoryManager.getRepositories();
            if (repositories.length === 0) {
                void vscode.window.showInformationMessage(vscode.l10n.t('No repositories available'));
                return;
            }

            const activeRepoPath = repositoryManager.getActiveRepoPath();
            const selected = await vscode.window.showQuickPick(
                repositories.map(repo => {
                    const descriptionParts = [];
                    if (repo.path === activeRepoPath) {
                        descriptionParts.push(vscode.l10n.t('Current'));
                    }
                    if (repo.isSubmodule) {
                        descriptionParts.push(vscode.l10n.t('Submodule'));
                    }

                    return {
                        label: repo.name,
                        description: descriptionParts.join(' · '),
                        detail: repo.path,
                        repoPath: repo.path
                    };
                }),
                {
                    placeHolder: vscode.l10n.t('Switch Repository...')
                }
            );

            if (!selected || selected.repoPath === activeRepoPath) {
                return;
            }

            if (repositoryManager.setActiveRepository(selected.repoPath)) {
                updateRepositoryContext();
            }
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
            triggerRefresh();
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            branchStatusBar?.update();
            gitLogStatusBar?.update();
            void resetGitWatcher();
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
