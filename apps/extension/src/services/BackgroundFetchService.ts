import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { constants as osConstants, setPriority } from 'node:os';
import type { RepositoryManager, RepositoryScope } from './RepositoryManager';
import { logger } from '../utils/logger';

const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 24 * 60;
const STARTUP_DELAY_MS = 5000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const ORIGIN_REMOTE = 'origin';

interface BackgroundFetchConfig {
    enabled: boolean;
    onStartup: boolean;
    intervalMinutes: number;
}

export class BackgroundFetchService implements vscode.Disposable {
    private timer: NodeJS.Timeout | undefined;
    private startupTimer: NodeJS.Timeout | undefined;
    private activeFetchController: AbortController | undefined;
    private disposed = false;
    private running = false;
    private readonly lastFetchAt = new Map<string, number>();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly repositoryManager: RepositoryManager,
        private readonly onRemoteRefsChanged: (scope: RepositoryScope) => void = () => { }
    ) {
        this.disposables.push(
            vscode.window.onDidChangeWindowState(event => {
                if (event.focused) {
                    void this.fetchDueRepositories('windowFocus');
                }
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('intelli-git.backgroundFetch')) {
                    this.cancelActiveFetch('configuration-changed');
                    this.configureSchedule();
                }
            })
        );

        this.configureSchedule();
    }

    public refreshRepositories(): Promise<void> {
        return this.fetchDueRepositories('repositoriesChanged');
    }

    public cancelActiveFetch(reason: string): void {
        if (!this.activeFetchController || this.activeFetchController.signal.aborted) {
            return;
        }
        logger.debug('Background fetch cancelled', { reason });
        this.activeFetchController.abort();
    }

    public dispose(): void {
        this.disposed = true;
        this.cancelActiveFetch('disposed');
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
            enabled: config.get<boolean>('enabled', false),
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
        const controller = new AbortController();
        this.activeFetchController = controller;
        const now = Date.now();
        const intervalMs = config.intervalMinutes * 60 * 1000;

        try {
            for (const repo of this.getUniqueRepositories()) {
                if (controller.signal.aborted) {
                    break;
                }

                const lastFetchAt = this.lastFetchAt.get(repo.key) || 0;
                if (now - lastFetchAt < intervalMs) {
                    continue;
                }

                const completed = await this.fetchRepository(repo.scope, reason, controller.signal);
                if (completed) {
                    this.lastFetchAt.set(repo.key, Date.now());
                }
            }
        } finally {
            if (this.activeFetchController === controller) {
                this.activeFetchController = undefined;
            }
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

    private async fetchRepository(scope: RepositoryScope, reason: string, parentSignal: AbortSignal): Promise<boolean> {
        const startedAt = Date.now();
        const controller = new AbortController();
        let timedOut = false;
        const cancel = () => controller.abort();
        parentSignal.addEventListener('abort', cancel, { once: true });
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, FETCH_TIMEOUT_MS);
        timeout.unref?.();

        try {
            const remotes = (await this.runGit(scope.gitRoot, ['remote'], controller.signal))
                .split(/\r?\n/)
                .map(remote => remote.trim())
                .filter(Boolean);
            if (!remotes.includes(ORIGIN_REMOTE)) {
                logger.debug('Background fetch skipped missing remote', {
                    repoPath: scope.repoPath,
                    remote: ORIGIN_REMOTE,
                    reason
                });
                return true;
            }

            const remoteRefPrefix = `refs/remotes/${ORIGIN_REMOTE}/`;
            const refsArgs = ['for-each-ref', '--format=%(refname):%(objectname)', remoteRefPrefix];
            const before = await this.runGit(scope.gitRoot, refsArgs, controller.signal);
            await this.runGit(
                scope.gitRoot,
                ['fetch', '--no-tags', '--quiet', ORIGIN_REMOTE],
                controller.signal,
                true
            );
            const after = await this.runGit(scope.gitRoot, refsArgs, controller.signal);
            const changed = before !== after;
            if (changed) {
                this.onRemoteRefsChanged(scope);
            }
            logger.debug('Background fetch completed', {
                repoPath: scope.repoPath,
                remote: ORIGIN_REMOTE,
                reason,
                changed,
                fetchMs: Date.now() - startedAt
            });
            return true;
        } catch (error) {
            if (controller.signal.aborted) {
                const details = {
                    repoPath: scope.repoPath,
                    remote: ORIGIN_REMOTE,
                    reason,
                    fetchMs: Date.now() - startedAt
                };
                if (timedOut) {
                    logger.warn('Background fetch timed out', details);
                } else {
                    logger.debug('Background fetch stopped', details);
                }
                return false;
            }
            logger.warn('Background fetch failed', {
                repoPath: scope.repoPath,
                remote: ORIGIN_REMOTE,
                reason,
                fetchMs: Date.now() - startedAt,
                error: formatError(error)
            });
            return false;
        } finally {
            clearTimeout(timeout);
            parentSignal.removeEventListener('abort', cancel);
        }
    }

    private runGit(cwd: string, args: string[], signal: AbortSignal, lowPriority = false): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn('git', args, {
                cwd,
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
                signal,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            if (lowPriority && child.pid) {
                try {
                    setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
                } catch {
                    // Process priority is best-effort across supported platforms.
                }
            }

            let stdout = '';
            let stderr = '';
            const appendOutput = (current: string, chunk: Buffer): string => {
                if (Buffer.byteLength(current) >= MAX_COMMAND_OUTPUT_BYTES) {
                    return current;
                }
                return `${current}${chunk.toString('utf8')}`;
            };
            child.stdout.on('data', chunk => {
                stdout = appendOutput(stdout, chunk);
            });
            child.stderr.on('data', chunk => {
                stderr = appendOutput(stderr, chunk);
            });

            let settled = false;
            const finish = (callback: () => void) => {
                if (settled) return;
                settled = true;
                callback();
            };
            child.once('error', error => finish(() => reject(error)));
            child.once('close', code => finish(() => {
                if (code === 0) {
                    resolve(stdout);
                    return;
                }
                reject(new Error(stderr.trim() || `git ${args[0]} exited with code ${code}`));
            }));
        });
    }
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
