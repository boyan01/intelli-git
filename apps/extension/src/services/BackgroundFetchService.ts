import * as vscode from 'vscode';
import type { RepositoryManager, RepositoryScope } from './RepositoryManager';
import { logger } from '../utils/logger';

const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 24 * 60;
const STARTUP_DELAY_MS = 5000;
const ORIGIN_REMOTE = 'origin';

interface BackgroundFetchConfig {
    enabled: boolean;
    onStartup: boolean;
    intervalMinutes: number;
}

export class BackgroundFetchService implements vscode.Disposable {
    private timer: NodeJS.Timeout | undefined;
    private startupTimer: NodeJS.Timeout | undefined;
    private disposed = false;
    private running = false;
    private readonly lastFetchAt = new Map<string, number>();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly repositoryManager: RepositoryManager) {
        this.disposables.push(
            vscode.window.onDidChangeWindowState(event => {
                if (event.focused) {
                    void this.fetchDueRepositories('windowFocus');
                }
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('intelli-git.backgroundFetch')) {
                    this.configureSchedule();
                }
            })
        );

        this.configureSchedule();
    }

    public refreshRepositories(): void {
        void this.fetchDueRepositories('repositoriesChanged');
    }

    public dispose(): void {
        this.disposed = true;
        this.clearTimers();
        for (const disposable of this.disposables.splice(0)) {
            disposable.dispose();
        }
    }

    private configureSchedule(): void {
        this.clearTimers();

        const config = this.getConfig();
        if (!config.enabled || this.disposed) {
            return;
        }

        if (config.onStartup) {
            this.startupTimer = setTimeout(() => {
                this.startupTimer = undefined;
                void this.fetchDueRepositories('startup');
            }, STARTUP_DELAY_MS);
            this.startupTimer.unref?.();
        }

        this.timer = setInterval(() => {
            void this.fetchDueRepositories('interval');
        }, config.intervalMinutes * 60 * 1000);
        this.timer.unref?.();
    }

    private clearTimers(): void {
        if (this.startupTimer) {
            clearTimeout(this.startupTimer);
            this.startupTimer = undefined;
        }
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    private getConfig(): BackgroundFetchConfig {
        const config = vscode.workspace.getConfiguration('intelli-git.backgroundFetch');
        const intervalMinutes = config.get<number>('intervalMinutes', DEFAULT_INTERVAL_MINUTES);
        return {
            enabled: config.get<boolean>('enabled', true),
            onStartup: config.get<boolean>('onStartup', true),
            intervalMinutes: Math.min(
                MAX_INTERVAL_MINUTES,
                Math.max(MIN_INTERVAL_MINUTES, Math.floor(Number.isFinite(intervalMinutes) ? intervalMinutes : DEFAULT_INTERVAL_MINUTES))
            )
        };
    }

    private async fetchDueRepositories(reason: string): Promise<void> {
        if (this.disposed || this.running) {
            return;
        }

        const config = this.getConfig();
        if (!config.enabled) {
            return;
        }
        if (reason === 'interval' && vscode.window.state?.focused === false) {
            return;
        }

        this.running = true;
        const now = Date.now();
        const intervalMs = config.intervalMinutes * 60 * 1000;

        try {
            for (const repo of this.getUniqueRepositories()) {
                const lastFetchAt = this.lastFetchAt.get(repo.key) || 0;
                if (now - lastFetchAt < intervalMs) {
                    continue;
                }

                await this.fetchRepository(repo.scope, reason);
                this.lastFetchAt.set(repo.key, Date.now());
            }
        } finally {
            this.running = false;
        }
    }

    private getUniqueRepositories(): Array<{ key: string; scope: RepositoryScope }> {
        const repositories: Array<{ key: string; scope: RepositoryScope }> = [];
        const seenKeys = new Set<string>();

        for (const scope of this.repositoryManager.getRepositories()) {
            const key = scope.mainWorktreePath || scope.gitRoot;
            if (seenKeys.has(key)) {
                continue;
            }
            seenKeys.add(key);
            repositories.push({ key, scope });
        }

        return repositories;
    }

    private async fetchRepository(scope: RepositoryScope, reason: string): Promise<void> {
        const gitService = this.repositoryManager.getService(scope.repoPath);
        if (!gitService) {
            return;
        }

        try {
            const changed = await gitService.branchRemote.fetchRemoteTracking(ORIGIN_REMOTE);
            logger.debug('Background fetch completed', { repoPath: scope.repoPath, remote: ORIGIN_REMOTE, reason, changed });
        } catch (error) {
            logger.warn('Background fetch failed', { repoPath: scope.repoPath, remote: ORIGIN_REMOTE, reason, error: formatError(error) });
        }
    }
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
