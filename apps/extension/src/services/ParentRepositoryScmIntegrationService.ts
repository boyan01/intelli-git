import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { RepositoryManager, RepositoryScope } from './RepositoryManager';
import { logger } from '../utils/logger';

interface VSCodeGitExtension {
    getAPI(version: 1): VSCodeGitAPI;
}

interface VSCodeGitAPI {
    repositories: VSCodeGitRepository[];
    onDidOpenRepository: vscode.Event<VSCodeGitRepository>;
}

interface VSCodeGitRepository {
    rootUri?: vscode.Uri;
}

interface ParentRepositoryScmIntegrationOptions {
    getVSCodeGitRoots?: () => Promise<string[] | undefined>;
    showWarningMessage?: (message: string, ...items: string[]) => Thenable<string | undefined>;
    executeCommand?: (command: string, ...args: unknown[]) => Thenable<unknown>;
    debounceMs?: number;
}

function normalizeExistingPath(filePath: string): string {
    try {
        return path.normalize(fs.realpathSync(filePath));
    } catch {
        return path.normalize(filePath);
    }
}

export function findMissingParentGitRoots(scopes: RepositoryScope[], vsCodeGitRoots: string[]): string[] {
    const openRoots = new Set(vsCodeGitRoots.map(normalizeExistingPath));
    const missingRoots = new Set<string>();

    for (const scope of scopes) {
        const workspaceRoot = normalizeExistingPath(scope.workspaceRoot);
        const gitRoot = normalizeExistingPath(scope.gitRoot);
        if (workspaceRoot === gitRoot || openRoots.has(gitRoot)) {
            continue;
        }
        missingRoots.add(gitRoot);
    }

    return Array.from(missingRoots).sort((a, b) => a.localeCompare(b));
}

export class ParentRepositoryScmIntegrationService implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly promptedRoots = new Set<string>();
    private readonly pendingRoots = new Set<string>();
    private readonly getVSCodeGitRoots: () => Promise<string[] | undefined>;
    private readonly showWarningMessage: (message: string, ...items: string[]) => Thenable<string | undefined>;
    private readonly executeCommand: (command: string, ...args: unknown[]) => Thenable<unknown>;
    private checkTimer: NodeJS.Timeout | undefined;
    private disposed = false;

    constructor(
        private readonly repositoryManager: RepositoryManager,
        options: ParentRepositoryScmIntegrationOptions = {}
    ) {
        this.getVSCodeGitRoots = options.getVSCodeGitRoots ?? (() => this.readVSCodeGitRoots());
        this.showWarningMessage = options.showWarningMessage ?? vscode.window.showWarningMessage;
        this.executeCommand = options.executeCommand ?? vscode.commands.executeCommand;
        const debounceMs = options.debounceMs ?? 250;

        this.disposables.push(
            this.repositoryManager.onDidChangeRepositories(() => this.scheduleCheck(debounceMs)),
            this.repositoryManager.onDidChangeActiveRepo(() => this.scheduleCheck(debounceMs))
        );
    }

    public scheduleCheck(delayMs = 250): void {
        if (this.disposed) {
            return;
        }

        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
        }
        this.checkTimer = setTimeout(() => {
            this.checkTimer = undefined;
            void this.checkNow();
        }, delayMs);
    }

    public async checkNow(): Promise<void> {
        if (this.disposed) {
            return;
        }

        const vsCodeGitRoots = await this.getVSCodeGitRoots();
        if (!vsCodeGitRoots) {
            return;
        }

        const missingRoots = findMissingParentGitRoots(this.repositoryManager.getRepositories(), vsCodeGitRoots)
            .filter(root => !this.promptedRoots.has(root) && !this.pendingRoots.has(root));
        if (missingRoots.length === 0) {
            return;
        }

        for (const root of missingRoots) {
            this.pendingRoots.add(root);
        }

        const openAction = vscode.l10n.t('Open Parent Repository');
        const settingsAction = vscode.l10n.t('Open Git Setting');
        const message = missingRoots.length === 1
            ? vscode.l10n.t('Intelli Git detected a Git repository in a parent folder, but VS Code Git has not opened it. Open it to enable Source Control decorations.')
            : vscode.l10n.t('Intelli Git detected Git repositories in parent folders, but VS Code Git has not opened them. Open them to enable Source Control decorations.');

        try {
            const selected = await this.showWarningMessage(message, openAction, settingsAction);
            if (selected === openAction) {
                await this.executeCommand('git.openRepositoriesInParentFolders');
            } else if (selected === settingsAction) {
                await this.executeCommand('workbench.action.openSettings', 'git.openRepositoryInParentFolders');
            }
        } catch (error) {
            logger.warn('Failed to align VS Code Git parent repositories', error);
        } finally {
            for (const root of missingRoots) {
                this.pendingRoots.delete(root);
                this.promptedRoots.add(root);
            }
        }
    }

    private async readVSCodeGitRoots(): Promise<string[] | undefined> {
        const gitExtension = vscode.extensions.getExtension<VSCodeGitExtension>('vscode.git');
        if (!gitExtension) {
            return undefined;
        }

        try {
            const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
            const api = git.getAPI(1);
            return api.repositories
                .map(repository => repository.rootUri?.fsPath)
                .filter((root): root is string => Boolean(root));
        } catch (error) {
            logger.debug('Failed to read VS Code Git repositories', error);
            return undefined;
        }
    }

    public dispose(): void {
        this.disposed = true;
        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
            this.checkTimer = undefined;
        }
        for (const disposable of this.disposables.splice(0)) {
            disposable.dispose();
        }
        this.promptedRoots.clear();
        this.pendingRoots.clear();
    }
}
