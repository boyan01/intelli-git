import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RpcPeer } from '@shared/rpc';
import {
    AI_COPILOT_MODEL_UNAVAILABLE_CODE,
    AI_PROVIDER_SETUP_REQUIRED_CODE
} from '@shared/messages';
import type {
    WebviewMethods,
    ExtensionMethods,
    FileStatus,
    ChangelistFileSelection,
    ChangelistState,
    GitLogRevealRequest,
    FileReferenceInput,
    RepositoryCommitViewState,
    RepositoryFileReference,
    PushTarget,
    PushResult,
    AiProviderStatus,
    AiProviderTestResult,
    AiProviderId,
    CommitMessageGenerationMode,
    CommitMessageGenerationRequest,
    CommitMessageGenerationResult,
    ConflictResolverOpenRequest,
    PushFailedResult,
    PushFailureCode,
    PushRequest,
    PublishReviewBranchResult,
    CommitDetails,
    ConflictFileContent,
    PublishReviewBranchRequest
} from '@shared/messages';
import { GitService } from '../services/GitService';
import { RepositoryManager } from '../services/RepositoryManager';
import { ChangelistStateService } from '../services/ChangelistStateService';
import { InactiveChangesService } from '../services/InactiveChangesService';
import { AnthropicService } from '../services/AnthropicService';
import { GoogleAiService } from '../services/GoogleAiService';
import { OpenAiService } from '../services/CustomOpenAiService';
import { i18n } from '../utils/i18n';
import {
    AiProvider,
    DEFAULT_COMMIT_MESSAGE_PROMPT,
    DEFAULT_COPILOT_MODEL,
    DEFAULT_CUSTOM_OPENAI_API_URL,
    DEFAULT_CUSTOM_OPENAI_MODEL,
    DEFAULT_GOOGLE_API_URL,
    DEFAULT_GOOGLE_MODEL,
    DEFAULT_PULL_REQUEST_BODY_PROMPT,
    DEFAULT_PULL_REQUEST_TITLE_PROMPT
} from '../services/ai';
import { logger } from '../utils/logger';
import { getAiApiKey } from '../utils/aiSecrets';
import { createRevisionContentUri, createStashContentUri } from '../utils/repositoryContentUri';
import { ChangelistOperations, createDefaultRefreshDecorations } from '../operations/ChangelistOperations';
import { GitReadRpcHandler } from './GitReadRpcHandler';
import { ChangelistRpcHandler } from './ChangelistRpcHandler';
import { handleCheckoutWorktreeConflict } from '../ui/checkoutWorktreeConflict';
import { isProtectedPushTarget } from '../utils/pushProtection';

function normalizeExistingPath(filePath: string): string {
    try {
        return path.normalize(fs.realpathSync(filePath));
    } catch {
        return path.normalize(filePath);
    }
}

function isRepositoryFileReference(value: FileReferenceInput): value is RepositoryFileReference {
    return typeof value === 'object' && value !== null && typeof value.path === 'string';
}

function createRpcError(message: string, code: string, data?: unknown): Error {
    const error = new Error(message) as Error & { code?: string; data?: unknown };
    error.code = code;
    error.data = data;
    return error;
}

function isRpcCancellation(error: unknown): boolean {
    return error instanceof Error && (error as Error & { code?: unknown }).code === 'cancelled';
}

function countDiffFiles(diff: string): number {
    return diff.match(/^diff --git /gm)?.length || 0;
}

function countDiffHunks(diff: string): number {
    return diff.match(/^@@ /gm)?.length || 0;
}

function truncateValue(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.substring(0, maxLength - 3)}...` : value;
}

function cleanAiText(value: string): string {
    return value
        .trim()
        .replace(/^```(?:markdown|md|text)?\s*/i, '')
        .replace(/```$/i, '')
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim();
}

function slugifyBranchSegment(value: string): string {
    const slug = value
        .toLowerCase()
        .replace(/['"]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-')
        .substring(0, 56)
        .replace(/-+$/g, '');

    return slug || 'update';
}

function getBranchPrefixFromTitle(title: string): string {
    const normalized = title.trim().toLowerCase();
    if (normalized.startsWith('fix') || normalized.startsWith('resolve')) {
        return 'fix';
    }
    if (normalized.startsWith('docs') || normalized.startsWith('document')) {
        return 'docs';
    }
    if (normalized.startsWith('test') || normalized.startsWith('add test')) {
        return 'test';
    }
    if (normalized.startsWith('refactor')) {
        return 'refactor';
    }
    return 'feat';
}

function createBranchNameFromTitle(title: string): string {
    const cleanedTitle = title.replace(/^(feat|fix|docs|test|refactor|chore)(\(.+\))?:\s*/i, '');
    return `${getBranchPrefixFromTitle(title)}/${slugifyBranchSegment(cleanedTitle)}`;
}

function renderPromptTemplate(template: string, variables: Record<string, string | number>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
        const value = variables[key];
        return value === undefined ? match : String(value);
    });
}

const MARKETPLACE_EXTENSION_URL = 'https://marketplace.visualstudio.com/items?itemName=boyan01.intelli-git';
const DEV_BUILD_INSTRUCTIONS_URL = 'https://github.com/boyan01/intelli-git#package';

interface PublishReviewBranchInternalRequest {
    remote: string;
    baseBranch: string;
    branchName: string;
    resetBaseBranch: boolean;
    noVerify?: boolean;
}

interface ReviewBranchOptions {
    resetBaseBranch: boolean;
    generateAiNotes: boolean;
}

const DEFAULT_REVIEW_BRANCH_OPTIONS: ReviewBranchOptions = {
    resetBaseBranch: true,
    generateAiNotes: false
};
const REVIEW_BRANCH_OPTIONS_STORAGE_KEY = 'ideaCommitPanel.reviewBranchOptions.v1';

function createRepoScopedStorageKey(baseKey: string, repoPath?: string): string {
    if (!repoPath) {
        return baseKey;
    }
    return `${baseKey}.${repoPath.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

function isExtensionSourceRoot(candidate: string | undefined): candidate is string {
    if (!candidate) {
        return false;
    }

    try {
        const rootPackageJson = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8')) as { name?: string };
        const extensionPackageJson = JSON.parse(fs.readFileSync(path.join(candidate, 'apps/extension/package.json'), 'utf8')) as { name?: string };

        return rootPackageJson.name === 'idea-commit-pannel-monorepo'
            && extensionPackageJson.name === 'intelli-git';
    } catch {
        return false;
    }
}

function createCommitMessageGenerationPrompt(
    basePrompt: string,
    mode: CommitMessageGenerationMode,
    amend: boolean | undefined
): string {
    const scope = amend ? 'the current amend selection' : 'the selected changes';
    const modeInstruction = (() => {
        switch (mode) {
            case 'subject':
                return `Generate only the commit subject line for ${scope}. Keep it concise. Do not include a body, markdown, bullets, or code fences.`;
            case 'body':
                return `Generate only the commit message body for ${scope}. Do not include a subject line, markdown code fences, or trailers.`;
            case 'rewrite':
                return 'Rewrite only the provided selected commit message text. Preserve its intent and scope, improve clarity, and return only the replacement text.';
            case 'full':
            default:
                return `Generate a complete commit message for ${scope}. Return only the commit message text without markdown code fences.`;
        }
    })();

    return `${basePrompt}\n\n${modeInstruction}`;
}

export interface ExtensionRpcHandlerOptions {
    context: vscode.ExtensionContext;
    repositoryManager: RepositoryManager;
    onDispose?: () => void;
    onChangelistSelectionChange?: (selection: ChangelistFileSelection | null) => void;
    onChangelistFocusChange?: (focused: boolean) => void;
    consumePendingGitLogReveal?: () => GitLogRevealRequest | undefined;
    openConflictResolver?: (file: ConflictResolverOpenRequest) => void;
    updateConflictResolverTitle?: (file: RepositoryFileReference) => void;
}

/**
 * Full implementation of ExtensionMethods interface for RPC handling.
 * Encapsulates all Git and Changelist operations.
 */
export class ExtensionRpcHandler {
    private context: vscode.ExtensionContext;
    private repositoryManager: RepositoryManager;
    private onDispose: () => void;
    private onChangelistSelectionChange?: (selection: ChangelistFileSelection | null) => void;
    private onChangelistFocusChange?: (focused: boolean) => void;
    private openConflictResolverPanel?: (file: ConflictResolverOpenRequest) => void;
    private updateConflictResolverPanelTitle?: (file: RepositoryFileReference) => void;
    private gitReadRpcHandler: GitReadRpcHandler;
    private changelistRpcHandler: ChangelistRpcHandler;
    private _lastRebaseStatus?: string;

    constructor(options: ExtensionRpcHandlerOptions) {
        this.context = options.context;
        this.repositoryManager = options.repositoryManager;
        this.onDispose = options.onDispose || (() => { });
        this.onChangelistSelectionChange = options.onChangelistSelectionChange;
        this.onChangelistFocusChange = options.onChangelistFocusChange;
        this.openConflictResolverPanel = options.openConflictResolver;
        this.updateConflictResolverPanelTitle = options.updateConflictResolverTitle;
        this.gitReadRpcHandler = new GitReadRpcHandler(this.repositoryManager, options.consumePendingGitLogReveal);
        this.changelistRpcHandler = new ChangelistRpcHandler(
            repoPath => this.getChangelistOperationsForRepo(repoPath),
            repoPath => repoPath ? this.getChangelistStateServiceForRepo(repoPath) : this.changelistStateService
        );
    }

    private get gitService(): GitService {
        const service = this.repositoryManager.getActiveService();
        if (!service) {
            throw new Error("No active repository");
        }
        return service;
    }

    private getServiceForRepo(repoPath?: string): GitService {
        const service = repoPath
            ? this.repositoryManager.getService(repoPath)
            : this.repositoryManager.getActiveService();
        if (!service) {
            throw new Error(repoPath ? `No repository found for ${repoPath}` : 'No active repository');
        }
        return service;
    }

    private getChangelistStateServiceForRepo(repoPath?: string): ChangelistStateService | undefined {
        return this.getServiceForRepo(repoPath).changelistStateService;
    }

    private normalizeFileReference(input: FileReferenceInput): RepositoryFileReference {
        return isRepositoryFileReference(input)
            ? { repoPath: input.repoPath, path: input.path }
            : { path: input };
    }

    private groupFileReferences(inputs: FileReferenceInput[]): Map<string | undefined, string[]> {
        const grouped = new Map<string | undefined, Set<string>>();
        for (const input of inputs) {
            const ref = this.normalizeFileReference(input);
            const paths = grouped.get(ref.repoPath) || new Set<string>();
            paths.add(ref.path);
            grouped.set(ref.repoPath, paths);
        }

        return new Map(Array.from(grouped.entries()).map(([repoPath, paths]) => [repoPath, Array.from(paths)]));
    }

    private getRepositoryName(repoPath: string | undefined, gitService: GitService): string {
        const repositories = typeof this.repositoryManager.getRepositories === 'function'
            ? this.repositoryManager.getRepositories()
            : [];
        return repositories.find(repo => repo.repoPath === repoPath)?.name || path.basename(gitService.getWorkspaceRoot());
    }

    private get inactiveChangesService(): InactiveChangesService | undefined {
        return this.repositoryManager.getActiveService()?.inactiveChangesService;
    }

    private get changelistStateService(): ChangelistStateService | undefined {
        return this.repositoryManager.getActiveService()?.changelistStateService;
    }

    private getChangelistOperationsForRepo(repoPath?: string): ChangelistOperations | undefined {
        const gitService = repoPath ? this.repositoryManager.getService(repoPath) : this.repositoryManager.getActiveService();
        const inactiveChangesService = gitService?.inactiveChangesService;
        const changelistStateService = gitService?.changelistStateService;
        if (!gitService || !inactiveChangesService || !changelistStateService) {
            return undefined;
        }

        return new ChangelistOperations({
            gitService,
            inactiveChangesService,
            changelistStateService,
            refreshDecorations: createDefaultRefreshDecorations()
        });
    }

    log = (params: { message: string, type?: 'info' | 'error' | 'warn' | 'debug' }): Promise<void> => {
        const type = params.type || 'info';
        if (logger[type]) {
            logger[type](params.message);
        } else {
            logger.info(params.message);
        }
        return Promise.resolve();
    };

    private isBehindPushError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error);
        const normalizedMessage = message.toLowerCase();

        return (
            normalizedMessage.includes('non-fast-forward') ||
            normalizedMessage.includes('fetch first') ||
            normalizedMessage.includes('remote contains work that you do not have locally') ||
            normalizedMessage.includes('tip of your current branch is behind')
        );
    }

    private createPushRejectedBehindError(behind: number): Error & { code: PushFailureCode; data: { behind: number } } {
        const error = new Error(i18n.t('Push rejected because the remote branch has new commits.'));
        return Object.assign(error, {
            code: 'behind' as const,
            data: { behind }
        });
    }

    private getPushErrorCode(error: unknown): PushFailureCode | undefined {
        if (typeof error !== 'object' || error === null || !('code' in error)) {
            return undefined;
        }

        const code = (error as { code?: unknown }).code;
        if (code === 'PUSH_REJECTED_BEHIND') {
            return 'behind';
        }
        if (
            code === 'behind' ||
            code === 'auth-failed' ||
            code === 'network' ||
            code === 'rejected' ||
            code === 'cancelled' ||
            code === 'unknown'
        ) {
            return code;
        }
        return undefined;
    }

    private getPushBehindCount(error: unknown): number | undefined {
        const data = typeof error === 'object' && error !== null && 'data' in error
            ? (error as { data?: unknown }).data
            : undefined;
        if (typeof data !== 'object' || data === null || !('behind' in data)) {
            return undefined;
        }

        const behind = Number((data as { behind?: unknown }).behind);
        return Number.isFinite(behind) && behind > 0 ? behind : undefined;
    }

    private classifyPushError(error: unknown): PushFailureCode {
        const structuredCode = this.getPushErrorCode(error);
        if (structuredCode) {
            return structuredCode;
        }

        const message = error instanceof Error ? error.message : String(error);
        const normalized = message.toLowerCase();
        if (
            normalized.includes('authentication failed') ||
            normalized.includes('permission denied') ||
            normalized.includes('could not read from remote repository') ||
            normalized.includes('repository not found') ||
            normalized.includes('access denied')
        ) {
            return 'auth-failed';
        }
        if (
            normalized.includes('could not resolve host') ||
            normalized.includes('failed to connect') ||
            normalized.includes('network is unreachable') ||
            normalized.includes('connection timed out') ||
            normalized.includes('connection reset') ||
            normalized.includes('early eof')
        ) {
            return 'network';
        }
        if (
            normalized.includes('remote rejected') ||
            normalized.includes('pre-receive hook declined') ||
            normalized.includes('protected branch hook declined') ||
            normalized.includes('hook declined')
        ) {
            return 'rejected';
        }
        if (this.isBehindPushError(error)) {
            return 'behind';
        }

        return 'unknown';
    }

    private createPushFailureResult(error: unknown, params: PushRequest): PushFailedResult {
        const code = this.classifyPushError(error);
        const message = error instanceof Error ? error.message : String(error);
        const result: PushFailedResult = {
            ok: false,
            code,
            remote: params.remote,
            branch: params.branch,
            message
        };
        const behindCount = code === 'behind' ? this.getPushBehindCount(error) : undefined;
        if (behindCount !== undefined) {
            result.behindCount = behindCount;
        }
        return result;
    }

    private async pushCurrentBranchToTarget(
        gitService: GitService,
        target: PushTarget,
        options: { force?: boolean; pushTags?: boolean; noVerify?: boolean; setUpstreamToTarget?: boolean } = {}
    ): Promise<void> {
        const branches = await gitService.branchRemote.getBranches();
        const currentBranch = branches.current;
        if (!currentBranch) {
            throw new Error(i18n.t('No current branch to push.'));
        }

        if (!options.force && isProtectedPushTarget(target.remote, target.branch)) {
            const confirmed = await this.confirmProtectedBranchPush(target);
            if (!confirmed) {
                const error = new Error(i18n.t('Protected branch push cancelled.'));
                throw Object.assign(error, { code: 'cancelled' as const });
            }
        }

        const hadUpstream = await gitService.branchRemote.getUpstreamBranch();
        const setUpstreamWithPush = !hadUpstream && options.setUpstreamToTarget;
        const pushOptions = {
            noVerify: options.noVerify,
            setUpstream: setUpstreamWithPush
        };

        try {
            if (options.force) {
                await gitService.branchRemote.forcePush(target.remote, `${currentBranch}:${target.branch}`, pushOptions);
            } else {
                await gitService.branchRemote.push(target.remote, `${currentBranch}:${target.branch}`, pushOptions);
            }

            if (!hadUpstream && !setUpstreamWithPush && target.branch === currentBranch) {
                try {
                    await gitService.branchRemote.setUpstreamBranch(target.remote, target.branch);
                } catch (e) {
                    logger.error('Failed to set upstream:', e);
                }
            }

            if (options.pushTags) {
                await gitService.branchRemote.pushTags(target.remote);
            }
        } catch (error) {
            if (!options.force && this.isBehindPushError(error)) {
                try {
                    await gitService.branchRemote.fetch();
                } catch (fetchError) {
                    logger.warn('Fetch after push rejection failed:', fetchError);
                }

                const branchStatus = await gitService.branchRemote.getBranchStatus();
                throw this.createPushRejectedBehindError(branchStatus.behind || 1);
            }

            throw error;
        }
    }

    private normalizeModelIdentifier(value: string | undefined): string {
        return (value || '').trim().toLowerCase();
    }

    getRepositories = async () => {
        return this.repositoryManager.getRepositories();
    };

    getActiveRepository = async () => {
        return this.repositoryManager.getActiveRepoPath();
    };

    setActiveRepository = async (repoPath: string) => {
        return this.repositoryManager.setActiveRepository(repoPath);
    };

    addRepository = async () => {
        const selected = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: i18n.t('Add Repository')
        });

        const folder = selected?.[0]?.fsPath;
        if (!folder) {
            return undefined;
        }

        const repository = await this.repositoryManager.addRepository(folder);
        if (!repository) {
            vscode.window.showWarningMessage(i18n.t('Selected folder is not a Git repository.'));
        }
        return repository;
    };

    scanWorkspaceRepositories = async () => {
        const candidates = await this.repositoryManager.discoverWorkspaceRepositories();
        if (candidates.length === 0) {
            vscode.window.showInformationMessage(i18n.t('No Git repositories found in this workspace.'));
            return [];
        }

        const selected = await vscode.window.showQuickPick(
            candidates.map(repo => ({
                label: repo.name,
                description: repo.branch,
                detail: repo.path,
                repo
            })),
            {
                canPickMany: true,
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: i18n.t('Select repositories to add')
            }
        );

        if (!selected || selected.length === 0) {
            return [];
        }

        const added = [];
        for (const item of selected) {
            const repo = await this.repositoryManager.addRepository(item.repo.path);
            if (repo) {
                added.push(repo);
            }
        }
        return added;
    };

    removeRepository = async (repoPath: string) => {
        return this.repositoryManager.removeRepository(repoPath);
    };

    getWorktrees = async () => {
        const service = this.repositoryManager.getActiveService();
        if (!service) {
            return [];
        }
        return service.branchRemote.getWorktrees(this.repositoryManager.getActiveRepoPath());
    };

    setActiveWorktree = async (worktreePath: string) => {
        const normalizedPath = normalizeExistingPath(worktreePath);
        const repo = this.repositoryManager.getRepositories().find(item => normalizeExistingPath(item.repoPath) === normalizedPath);
        if (!repo) {
            return false;
        }
        return this.repositoryManager.setActiveRepository(repo.repoPath);
    };

    openWorktree = async (worktreePath: string) => {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), { forceNewWindow: true });
    };

    revealWorktree = async (worktreePath: string) => {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(worktreePath));
    };

    pruneWorktrees = async () => {
        await this.gitService.branchRemote.pruneWorktrees();
    };

    removeWorktree = async (worktreePath: string, force?: boolean) => {
        await this.gitService.branchRemote.removeWorktree(worktreePath, force);
    };

    registerAll(rpc: RpcPeer<WebviewMethods, ExtensionMethods>) {
        rpc.registerAll(
            {
                getRepositories: this.getRepositories,
                getActiveRepository: this.getActiveRepository,
                setActiveRepository: this.setActiveRepository,
                addRepository: this.addRepository,
                scanWorkspaceRepositories: this.scanWorkspaceRepositories,
                removeRepository: this.removeRepository,
                getWorktrees: this.getWorktrees,
                setActiveWorktree: this.setActiveWorktree,
                openWorktree: this.openWorktree,
                revealWorktree: this.revealWorktree,
                pruneWorktrees: this.pruneWorktrees,
                removeWorktree: this.removeWorktree,
                log: this.log,
                getPushInitState: this.gitReadRpcHandler.getPushInitState,
                getRemoteBranches: this.gitReadRpcHandler.getRemoteBranches,
                getPushCommits: this.gitReadRpcHandler.getPushCommits,
                getCommitFiles: this.gitReadRpcHandler.getCommitFiles,
                getMultiCommitFiles: this.gitReadRpcHandler.getMultiCommitFiles,
                push: this.push,
                publishReviewBranch: this.publishReviewBranch,
                confirmForcePush: this.confirmForcePush,
                openDiff: this.openDiff,
                closeWebView: this.closeWebView,
                openCommitDiff: this.openCommitDiff,
                getStatus: this.getStatus,
                getChangelistState: this.getChangelistState,
                getCommitViewState: this.getCommitViewState,
                getBranchInfo: this.gitReadRpcHandler.getBranchInfo,
                getStashList: this.gitReadRpcHandler.getStashList,
                getStashFiles: this.gitReadRpcHandler.getStashFiles,
                commit: this.commit,
                stage: this.stage,
                stageFiles: this.stageFiles,
                unstage: this.unstage,
                unstageFiles: this.unstageFiles,
                stageAll: this.stageAll,
                unstageAll: this.unstageAll,
                stageTracked: this.stageTracked,
                getAIProviderStatus: this.getAIProviderStatus,
                generateCommitMessage: this.generateCommitMessage,
                testAIProvider: this.testAIProvider,
                selectCopilotModel: this.selectCopilotModel,
                openCommitPromptSettings: this.openCommitPromptSettings,
                stash: this.stash,
                deleteFiles: this.deleteFiles,
                rollback: this.rollback,
                switchBranch: this.switchBranch,
                pull: this.pull,
                fetch: this.fetch,
                focusGitLog: this.focusGitLog,
                switchRepository: this.switchRepository,
                openFolder: this.openFolder,
                openFeedback: this.openFeedback,
                openLatestRelease: this.openLatestRelease,
                rebuildDevVsix: this.rebuildDevVsix,
                initializeRepository: this.initializeRepository,
                configureAIProvider: this.configureAIProvider,
                pickBranch: this.pickBranch,
                continueRebase: this.continueRebase,
                abortRebase: this.abortRebase,
                openConflictResolver: this.openConflictResolver,
                updateConflictResolverTitle: this.updateConflictResolverTitle,
                getConflictFileContent: this.getConflictFileContent,
                saveConflictResolution: this.saveConflictResolution,
                resolveConflict: this.resolveConflict,
                openFile: this.openFile,
                openStashDiff: this.openStashDiff,
                getBranchListData: this.gitReadRpcHandler.getBranchListData,
                getLog: this.gitReadRpcHandler.getLog,
                getCommitDetails: this.gitReadRpcHandler.getCommitDetails,
                getPendingGitLogReveal: this.gitReadRpcHandler.getPendingGitLogReveal,
                pickBranchForFilter: this.pickBranchForFilter,
                pickPaths: this.pickPaths,
                getAuthors: this.gitReadRpcHandler.getAuthors,
                getCurrentUser: this.gitReadRpcHandler.getCurrentUser,
                getUnpushedCommits: this.gitReadRpcHandler.getUnpushedCommits,
                getWorkspaceRoot: this.gitReadRpcHandler.getWorkspaceRoot,
                getLastCommitInfo: this.gitReadRpcHandler.getLastCommitInfo,
                showErrorMessage: this.showErrorMessage,
                markHunkInactive: this.changelistRpcHandler.markHunkInactive,
                markHunkActive: this.changelistRpcHandler.markHunkActive,
                markFilesInactive: this.changelistRpcHandler.markFilesInactive,
                markFilesActive: this.changelistRpcHandler.markFilesActive,
                setChangelistMode: this.changelistRpcHandler.setChangelistMode,
                createChangelist: this.changelistRpcHandler.createChangelist,
                renameChangelist: this.changelistRpcHandler.renameChangelist,
                deleteChangelist: this.changelistRpcHandler.deleteChangelist,
                setActiveChangelist: this.changelistRpcHandler.setActiveChangelist,
                moveChangesToChangelist: this.changelistRpcHandler.moveChangesToChangelist,
                moveFilesToChangelist: this.changelistRpcHandler.moveFilesToChangelist,
                moveHunksToChangelist: this.changelistRpcHandler.moveHunksToChangelist,
                setActiveChangelistFile: this.setActiveChangelistFile,
                setChangelistTreeFocus: this.setChangelistTreeFocus
            }
        )
    }

    push = async (params: PushRequest): Promise<PushResult> => {
        if (params.force) {
            const confirmed = await this.confirmForcePush({
                remote: params.remote,
                branch: params.branch
            });
            if (!confirmed) {
                return {
                    ok: false,
                    code: 'cancelled',
                    remote: params.remote,
                    branch: params.branch,
                    message: i18n.t('Force push cancelled.')
                };
            }
        }

        try {
            await this.pushCurrentBranchToTarget(
                this.gitService,
                { remote: params.remote, branch: params.branch },
                { force: params.force, pushTags: params.pushTags, noVerify: params.noVerify }
            );
            return {
                ok: true,
                remote: params.remote,
                branch: params.branch,
                commitCount: params.commitCount ?? 0
            };
        } catch (error) {
            return this.createPushFailureResult(error, params);
        }
    };

    confirmForcePush = async (params: { remote: string; branch: string }): Promise<boolean> => {
        const action = i18n.t('Force Push');
        const selected = await vscode.window.showWarningMessage(
            i18n.t('Force push to {0}/{1}? This can overwrite remote commits. Intelli Git will use --force-with-lease to avoid overwriting newer remote updates.', params.remote, params.branch),
            { modal: true },
            action
        );

        return selected === action;
    };

    private confirmProtectedBranchPush = async (params: { remote: string; branch: string }): Promise<boolean> => {
        const action = i18n.t('Push Anyway');
        const selected = await vscode.window.showWarningMessage(
            i18n.t('Push directly to {0}/{1}? This target is a protected branch. Make sure these commits are intended for the main line.', params.remote, params.branch),
            { modal: true },
            action
        );

        return selected === action;
    };

    private getPullRequestTitlePrompt(): string {
        return vscode.workspace
            .getConfiguration('intelli-git.ai')
            .get<string>('pullRequestTitlePrompt', DEFAULT_PULL_REQUEST_TITLE_PROMPT)
            .trim() || DEFAULT_PULL_REQUEST_TITLE_PROMPT;
    }

    private getPullRequestBodyPrompt(): string {
        return vscode.workspace
            .getConfiguration('intelli-git.ai')
            .get<string>('pullRequestBodyPrompt', DEFAULT_PULL_REQUEST_BODY_PROMPT)
            .trim() || DEFAULT_PULL_REQUEST_BODY_PROMPT;
    }

    private async createPullRequestContext(
        gitService: GitService,
        remote: string,
        baseBranch: string,
        commitCount?: number
    ): Promise<{
        sourceBranch: string;
        commits: CommitDetails[];
        changedFiles: string[];
        commitsText: string;
        changedFilesText: string;
        fallbackTitle: string;
        fallbackBody: string;
    }> {
        const branches = await gitService.branchRemote.getBranches();
        const sourceBranch = branches.current;
        if (!sourceBranch) {
            throw new Error(i18n.t('No current branch to publish.'));
        }

        const limit = Math.max(1, Math.min(commitCount || 50, 50));
        const data = await gitService.branchRemote.getPushCommits({
            remote,
            branch: baseBranch,
            limit
        });
        const commits = data.commits;
        if (commits.length === 0) {
            throw new Error(i18n.t('No outgoing commits found for {0}/{1}.', remote, baseBranch));
        }

        const changedFiles = Array.from(new Set(
            commits.flatMap(commit => commit.files.map(file => file.displayPath || file.path))
        )).sort();
        const commitsText = commits
            .map((commit, index) => {
                const body = commit.body ? `\n${truncateValue(commit.body, 500)}` : '';
                return `${index + 1}. ${commit.shortHash} ${commit.subject}${body}`;
            })
            .join('\n\n');
        const changedFilesText = changedFiles.length > 0
            ? changedFiles.map(file => `- ${file}`).join('\n')
            : '- No file list available';
        const fallbackTitle = commits[0]?.subject || i18n.t('Update project files');
        const fallbackBody = [
            '## Summary',
            ...commits.map(commit => `- ${commit.subject}`),
            '',
            '## Testing',
            '- Not run (not provided).'
        ].join('\n');

        return {
            sourceBranch,
            commits,
            changedFiles,
            commitsText,
            changedFilesText,
            fallbackTitle,
            fallbackBody
        };
    }

    private async generatePullRequestText(
        prompt: string,
        context: {
            baseBranch: string;
            headBranch: string;
            commitCount: number;
            commitsText: string;
            changedFilesText: string;
        },
        token: vscode.CancellationToken
    ): Promise<string> {
        const renderedPrompt = renderPromptTemplate(prompt, {
            baseBranch: context.baseBranch,
            headBranch: context.headBranch,
            commitCount: context.commitCount,
            commits: context.commitsText,
            changedFiles: context.changedFilesText
        });
        const model = await this.getAIModel();
        const response = await model.sendRequest([
            vscode.LanguageModelChatMessage.User(renderedPrompt),
            vscode.LanguageModelChatMessage.User([
                `Base branch: ${context.baseBranch}`,
                `Head branch: ${context.headBranch}`,
                `Commit count: ${context.commitCount}`,
                '',
                'Commits:',
                context.commitsText,
                '',
                'Changed files:',
                context.changedFilesText
            ].join('\n'))
        ], {}, token);

        let text = '';
        for await (const fragment of response.text) {
            if (token.isCancellationRequested) {
                throw createRpcError(i18n.t('Review branch workflow cancelled.'), 'cancelled');
            }
            text += fragment;
        }
        return cleanAiText(text);
    }

    private async getPullRequestCompareUrl(remote: string, baseBranch: string, headBranch: string): Promise<string | undefined> {
        const compareUrl = await this.gitService.branchRemote.getRemoteCompareUrlForRemote(remote, baseBranch, headBranch);
        return compareUrl ? `${compareUrl}?expand=1` : undefined;
    }

    private async copyPullRequestNotes(title: string, body: string, notify = true): Promise<void> {
        await vscode.env.clipboard.writeText(`${title.trim()}\n\n${body.trim()}`.trim());
        if (notify) {
            vscode.window.showInformationMessage(i18n.t('PR notes copied to clipboard.'));
        }
    }

    private getReviewBranchOptionsStorageKey(gitService: GitService): string {
        return createRepoScopedStorageKey(REVIEW_BRANCH_OPTIONS_STORAGE_KEY, gitService.getWorkspaceRoot());
    }

    private getReviewBranchOptions(gitService: GitService): ReviewBranchOptions {
        const saved = this.context.workspaceState.get<Partial<ReviewBranchOptions>>(
            this.getReviewBranchOptionsStorageKey(gitService),
            {}
        );

        return {
            ...DEFAULT_REVIEW_BRANCH_OPTIONS,
            ...saved
        };
    }

    private async saveReviewBranchOptions(gitService: GitService, options: ReviewBranchOptions): Promise<void> {
        await this.context.workspaceState.update(this.getReviewBranchOptionsStorageKey(gitService), options);
    }

    publishReviewBranch = async (params: PublishReviewBranchRequest): Promise<PublishReviewBranchResult | null> => {
        try {
            const gitService = this.gitService;
            const context = await this.createPullRequestContext(
                gitService,
                params.remote,
                params.baseBranch,
                params.commitCount
            );
            const savedOptions = this.getReviewBranchOptions(gitService);
            let title = context.fallbackTitle;
            let body = context.fallbackBody;

            const branchName = await vscode.window.showInputBox({
                title: i18n.t('Create Review Branch'),
                prompt: i18n.t('Enter the new branch name to push for review.'),
                value: createBranchNameFromTitle(title),
                ignoreFocusOut: true,
                validateInput: value => value.trim() ? undefined : i18n.t('Branch name is required.')
            });
            if (!branchName) {
                return null;
            }

            interface ReviewBranchOption extends vscode.QuickPickItem {
                id: 'reset-base' | 'ai-notes';
            }

            const resetOption: ReviewBranchOption = {
                id: 'reset-base',
                label: i18n.t('Reset {0} to {1}/{2} after push', context.sourceBranch, params.remote, params.baseBranch),
                picked: savedOptions.resetBaseBranch
            };
            const aiOption: ReviewBranchOption = {
                id: 'ai-notes',
                label: i18n.t('Generate PR notes with AI'),
                description: i18n.t('Optional'),
                picked: savedOptions.generateAiNotes
            };
            const selectedOptions = await vscode.window.showQuickPick<ReviewBranchOption>(
                [resetOption, aiOption],
                {
                    title: i18n.t('Create Review Branch'),
                    placeHolder: i18n.t('Select review branch options'),
                    canPickMany: true,
                    ignoreFocusOut: true
                }
            );
            if (!selectedOptions) {
                return null;
            }

            const resetBaseBranch = selectedOptions.some(option => option.id === 'reset-base');
            const generateAiNotes = selectedOptions.some(option => option.id === 'ai-notes');
            await this.saveReviewBranchOptions(gitService, { resetBaseBranch, generateAiNotes });

            if (generateAiNotes) {
                let aiCancelled = false;
                try {
                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: i18n.t('Generating PR notes...'),
                            cancellable: true
                        },
                        async (_progress, token) => {
                            token.onCancellationRequested(() => {
                                aiCancelled = true;
                            });
                            const draftContext = {
                                baseBranch: params.baseBranch,
                                headBranch: context.sourceBranch,
                                commitCount: context.commits.length,
                                commitsText: context.commitsText,
                                changedFilesText: context.changedFilesText
                            };
                            const [generatedTitle, generatedBody] = await Promise.all([
                                this.generatePullRequestText(this.getPullRequestTitlePrompt(), draftContext, token),
                                this.generatePullRequestText(this.getPullRequestBodyPrompt(), draftContext, token)
                            ]);
                            title = generatedTitle || title;
                            body = generatedBody || body;
                        }
                    );
                    if (aiCancelled) {
                        return null;
                    }
                } catch (error) {
                    if (aiCancelled || isRpcCancellation(error)) {
                        return null;
                    }
                    logger.warn('Failed to generate pull request notes with AI:', error);
                    vscode.window.showWarningMessage(i18n.t('AI draft generation failed. Intelli Git used a commit-based fallback.'));
                }
            }

            const result = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: i18n.t('Creating review branch {0}...', branchName.trim()),
                    cancellable: false
                },
                async () => this.publishReviewBranchInternal({
                    remote: params.remote,
                    baseBranch: params.baseBranch,
                    branchName: branchName.trim(),
                    resetBaseBranch,
                    noVerify: params.noVerify
                })
            );

            if (result.resetWarning) {
                vscode.window.showWarningMessage(result.resetWarning);
            }

            const openAction = result.compareUrl ? i18n.t('Copy Notes & Open Page') : undefined;
            const copyAction = i18n.t('Copy PR Notes');
            const actions = openAction ? [openAction, copyAction] : [copyAction];
            const selectedAction = await vscode.window.showInformationMessage(
                i18n.t('Review branch {0} pushed to {1}.', result.branchName, result.remote),
                ...actions
            );
            if (selectedAction === openAction && result.compareUrl) {
                await this.copyPullRequestNotes(title, body, false);
                await vscode.env.openExternal(vscode.Uri.parse(result.compareUrl));
            } else if (selectedAction === copyAction) {
                await this.copyPullRequestNotes(title, body);
            }

            return result;
        } catch (error) {
            if (isRpcCancellation(error)) {
                return null;
            }
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(i18n.t('Failed to create review branch: {0}', message));
            throw error;
        }
    };

    private publishReviewBranchInternal = async (params: PublishReviewBranchInternalRequest): Promise<PublishReviewBranchResult> => {
        const gitService = this.gitService;
        const branchName = params.branchName.trim();
        if (!branchName) {
            throw new Error(i18n.t('Branch name is required.'));
        }

        await gitService.branchRemote.validateBranchName(branchName);
        if (await gitService.branchRemote.localBranchExists(branchName)) {
            throw new Error(i18n.t('Branch {0} already exists.', branchName));
        }
        if (await gitService.branchRemote.hasLocalChanges()) {
            throw new Error(i18n.t('Commit or stash local changes before publishing a review branch.'));
        }

        const branches = await gitService.branchRemote.getBranches();
        const sourceBranch = branches.current;
        if (!sourceBranch) {
            throw new Error(i18n.t('No current branch to publish.'));
        }

        await gitService.branchRemote.createBranch(branchName);
        await this.pushCurrentBranchToTarget(
            gitService,
            { remote: params.remote, branch: branchName },
            { noVerify: params.noVerify, setUpstreamToTarget: true }
        );

        let baseBranchReset = false;
        let resetWarning: string | undefined;
        if (params.resetBaseBranch && sourceBranch !== branchName) {
            try {
                await gitService.branchRemote.resetLocalBranchToRemote(sourceBranch, params.remote, params.baseBranch);
                baseBranchReset = true;
            } catch (error) {
                logger.warn('Failed to reset source branch after PR branch publish:', error);
                resetWarning = i18n.t('Branch was pushed, but {0} could not be reset to {1}/{2}.', sourceBranch, params.remote, params.baseBranch);
            }
        }

        const compareUrl = await this.getPullRequestCompareUrl(params.remote, params.baseBranch, branchName);
        const result: PublishReviewBranchResult = {
            remote: params.remote,
            baseBranch: params.baseBranch,
            sourceBranch,
            branchName,
            compareUrl,
            baseBranchReset,
            resetWarning
        };

        return result;
    };

    private async getStatusWithState(): Promise<FileStatus[]> {
        return this.getStatusWithStateForService(this.repositoryManager.getActiveService());
    };

    private async getStatusWithStateForService(gitService: GitService | undefined): Promise<FileStatus[]> {
        if (!gitService) {
            return [];
        }

        const status = await gitService.getStatus();
        gitService.inactiveChangesService?.syncWithStatus(status);
        gitService.changelistStateService?.syncWithStatus(status);

        return this.decorateStatus(status, gitService.inactiveChangesService);
    };

    getStatus = async (): Promise<FileStatus[]> => {
        return this.getStatusWithState();
    };

    getChangelistState = async () => {
        const gitService = this.repositoryManager.getActiveService();
        if (!gitService) {
            return this.getCurrentChangelistState();
        }

        const status = await gitService.getStatus();
        gitService.changelistStateService?.syncWithStatus(status);
        return this.getCurrentChangelistState(gitService);
    };

    getCommitViewState = async () => {
        const startedAt = Date.now();
        const repositories = typeof this.repositoryManager.getRepositories === 'function'
            ? this.repositoryManager.getRepositories()
            : [];
        if (repositories.length === 0) {
            return {
                files: [],
                changelistState: this.getCurrentChangelistState(),
                workspaceRoot: '',
                hasRepository: false,
                repositories: []
            };
        }

        const activeRepoPath = this.repositoryManager.getActiveRepoPath();
        const activeRepository = repositories.find(repository => repository.repoPath === activeRepoPath) || repositories[0];
        const activeService = activeRepository ? this.repositoryManager.getService(activeRepository.repoPath) : undefined;
        const activeRepositoryState: RepositoryCommitViewState | undefined = activeRepository && activeService
            ? {
                repository: activeRepository,
                files: await this.getStatusWithStateForService(activeService),
                changelistState: this.getCurrentChangelistState(activeService),
                workspaceRoot: activeService.getWorkspaceRoot()
            }
            : undefined;
        const repositoryStates = activeRepositoryState ? [activeRepositoryState] : [];
        const files = activeRepositoryState?.files || [];
        const changelistState = activeRepositoryState?.changelistState || this.getCurrentChangelistState();
        const elapsedMs = Date.now() - startedAt;

        logger.info('[refresh] commit view state loaded', {
            elapsedMs,
            repositories: repositoryStates.length,
            files: repositoryStates.reduce((sum, state) => sum + state.files.length, 0),
            hunkFiles: repositoryStates.reduce((sum, state) => sum + state.files.filter(file => file.hunks && file.hunks.length > 0).length, 0),
            mode: changelistState.mode
        });

        return {
            files,
            changelistState,
            workspaceRoot: activeRepositoryState?.workspaceRoot || '',
            hasRepository: true,
            repositories: repositoryStates,
            activeRepository: activeRepositoryState?.repository
        };
    };

    private getCurrentChangelistState(gitService?: GitService): ChangelistState {
        return (gitService?.changelistStateService || this.changelistStateService)?.getState() || {
            mode: 'staged',
            activeListId: 'changes',
            lists: [{ id: 'changes', name: 'Changes', isDefault: true, isActive: true }],
            assignments: {}
        };
    }

    private decorateStatus(status: FileStatus[], inactiveChangesService = this.inactiveChangesService): FileStatus[] {
        return status.map(file => {
            const isFileInactive = !!inactiveChangesService?.isInactive(file.path);
            const inactiveHunkIds = inactiveChangesService?.getInactiveHunkIds(file.path) || [];
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

    openDiff = async (filePathOrArgs: string | [string, boolean?] | { path: string; repoPath?: string; staged?: boolean }, staged?: boolean): Promise<void> => {
        const [filePath, effectiveStaged, repoPath] = Array.isArray(filePathOrArgs)
            ? [filePathOrArgs[0], filePathOrArgs[1], undefined]
            : typeof filePathOrArgs === 'object'
                ? [filePathOrArgs.path, filePathOrArgs.staged, filePathOrArgs.repoPath]
                : [filePathOrArgs, staged, undefined];
        const gitService = this.getServiceForRepo(repoPath);

        if (effectiveStaged) {
            // HEAD vs Index
            const leftUri = createRevisionContentUri(gitService, filePath, { ref: 'HEAD', preferStaged: true });
            const rightUri = createRevisionContentUri(gitService, filePath, { ref: '' });
            const title = `${path.basename(filePath)} ${i18n.t('(Staged)')}`;
            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
        } else {
            const status = await gitService.getStatus();
            const target = status.find(file => file.path === filePath && !file.staged) || status.find(file => file.path === filePath);
            if (target?.status === 'D') {
                const leftUri = createRevisionContentUri(gitService, filePath, { ref: 'HEAD', preferStaged: false });
                const rightUri = createRevisionContentUri(gitService, filePath, { ref: 'WORKTREE', preferStaged: false });
                await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, path.basename(filePath));
                return;
            }

            const workspaceRoot = gitService.getWorkspaceRoot();
            const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
            await vscode.commands.executeCommand('git.openChange', uri);
        }
    };

    setActiveChangelistFile = async (selection: ChangelistFileSelection | null): Promise<void> => {
        if (selection?.repoPath) {
            this.repositoryManager.setActiveRepository(selection.repoPath);
        }
        this.onChangelistSelectionChange?.(selection);
    };

    setChangelistTreeFocus = async (focused: boolean): Promise<void> => {
        this.onChangelistFocusChange?.(focused);
    };

    closeWebView = async (): Promise<void> => {
        this.onDispose();
    };

    openCommitDiff = async (params: { path: string; leftRef: string; rightRef: string; preserveFocus?: boolean }): Promise<void> => {
        const leftUri = createRevisionContentUri(this.gitService, params.path, { ref: params.leftRef, pathKind: 'repo' });
        const rightUri = createRevisionContentUri(this.gitService, params.path, { ref: params.rightRef, pathKind: 'repo' });
        const title = `${path.basename(params.path)} (${params.leftRef.substring(0, 7)} ↔ ${params.rightRef.substring(0, 7)})`;
        vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
            preserveFocus: params.preserveFocus ?? false
        });
    };

    pickPaths = async (): Promise<string[] | undefined> => {
        const workspaceRoot = this.repositoryManager.getActiveService()?.getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showWarningMessage(i18n.t('extension.noRoot'));
            return undefined;
        }

        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: true,
            openLabel: i18n.t('extension.selectPath'),
            defaultUri: vscode.Uri.file(workspaceRoot)
        });

        if (!result || result.length === 0) {
            return undefined;
        }

        const validPaths: string[] = [];
        const invalidPaths: string[] = [];

        for (const uri of result) {
            if (uri.fsPath.startsWith(workspaceRoot)) {
                let relativePath = uri.fsPath.substring(workspaceRoot.length);
                if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
                    relativePath = relativePath.substring(1);
                }
                if (relativePath === '') {
                    relativePath = '.';
                }
                validPaths.push(relativePath);
            } else {
                invalidPaths.push(uri.fsPath);
            }
        }

        if (invalidPaths.length > 0) {
            const msg = invalidPaths.length === 1
                ? i18n.t('extension.pathNotInWorkspace', invalidPaths[0])
                : i18n.t('extension.pathsNotInWorkspace', invalidPaths.length);
            vscode.window.showWarningMessage(msg);
        }

        if (validPaths.length === 0) {
            return undefined;
        }

        return validPaths;
    };

    pickBranchForFilter = async (): Promise<string | undefined> => {
        const gitService = this.repositoryManager.getActiveService();
        if (!gitService) {
            return undefined;
        }

        const branchData = await gitService.branchRemote.getBranchListData();

        interface BranchQuickPickItem extends vscode.QuickPickItem {
            branch: string;
        }

        const items: BranchQuickPickItem[] = [];
        const addedBranches = new Set<string>();

        const addBranch = (branch: string, icon: string, description?: string) => {
            if (addedBranches.has(branch)) return;
            addedBranches.add(branch);
            items.push({
                label: `${icon} ${branch}`,
                description,
                branch
            });
        };

        items.push({
            label: `$(git-branch) ${i18n.t('extension.all')}`,
            branch: 'all',
            kind: vscode.QuickPickItemKind.Default
        });
        addedBranches.add('all');

        items.push({
            label: i18n.t('extension.common'),
            kind: vscode.QuickPickItemKind.Separator,
            branch: ''
        });

        addBranch('HEAD', '$(symbol-reference)', i18n.t('extension.currentHead'));

        if (branchData.currentBranch) {
            addBranch(branchData.currentBranch, '$(git-branch)', i18n.t('extension.currentBranch'));
        }

        const priorityBranches = ['main', 'master'];
        for (const pb of priorityBranches) {
            if (branchData.localBranches.includes(pb)) {
                addBranch(pb, '$(git-branch)');
            }
            for (const remote of Object.keys(branchData.remoteBranches)) {
                if (branchData.remoteBranches[remote].includes(pb)) {
                    addBranch(`${remote}/${pb}`, '$(cloud)');
                }
            }
        }

        items.push({
            label: i18n.t('extension.localBranches'),
            kind: vscode.QuickPickItemKind.Separator,
            branch: ''
        });

        for (const branch of branchData.localBranches) {
            addBranch(branch, '$(git-branch)');
        }

        for (const [remote, branches] of Object.entries(branchData.remoteBranches)) {
            items.push({
                label: remote,
                kind: vscode.QuickPickItemKind.Separator,
                branch: ''
            });

            for (const branch of branches) {
                addBranch(`${remote}/${branch}`, '$(cloud)');
            }
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: i18n.t('extension.selectBranchFilter'),
            matchOnDescription: true,
            canPickMany: true
        });

        if (!selected || selected.length === 0) {
            return undefined;
        }

        const branches = selected.map(s => s.branch).filter(b => b);
        return branches.length === 1 ? branches[0] : branches.join(',');
    };

    commit = async (params: { message: string; amend: boolean; files: FileReferenceInput[]; push?: boolean; pushTarget?: PushTarget }): Promise<void> => {
        if (params.push && !params.pushTarget) {
            throw new Error(i18n.t('Commit & Push requires a confirmed push target.'));
        }
        if (params.pushTarget && (!params.pushTarget.remote.trim() || !params.pushTarget.branch.trim())) {
            throw new Error(i18n.t('Commit & Push requires a confirmed push target.'));
        }

        const groups = this.groupFileReferences(params.files || []);
        const entries = groups.size > 0 ? Array.from(groups.entries()) : [[undefined, []] as [string | undefined, string[]]];
        if (params.amend && entries.length > 1) {
            throw new Error('Amend supports one repository at a time');
        }
        if (params.pushTarget && entries.length > 1) {
            throw new Error(i18n.t('Commit & Push supports one repository at a time.'));
        }

        const failures: string[] = [];

        for (const [repoPath, files] of entries) {
            const gitService = this.getServiceForRepo(repoPath);
            const repoName = this.getRepositoryName(repoPath, gitService);
            let committedHash: string | undefined;

            try {
                const changelistState = gitService.changelistStateService?.getState();

                if (changelistState?.mode === 'changes') {
                    const status = await this.getStatusWithStateForService(gitService);
                    const plan = gitService.changelistStateService?.buildCommitPlan(status, files);

                    if (!plan || (!params.amend && plan.files.length === 0)) {
                        throw new Error('No active changelist changes to commit');
                    }

                    if (params.amend && plan.files.length === 0) {
                        await gitService.commitAmend(params.message, []);
                    } else {
                        await gitService.commitChangelistPlan(params.message, params.amend, plan, status);
                    }
                } else if (params.amend) {
                    await gitService.commitAmend(params.message, undefined);
                } else {
                    await gitService.commit(params.message, undefined);
                }

                if (params.pushTarget) {
                    const lastCommit = await gitService.getLastCommitInfo();
                    committedHash = lastCommit?.shortHash || lastCommit?.hash.substring(0, 7);
                    try {
                        await this.pushCurrentBranchToTarget(gitService, params.pushTarget, { setUpstreamToTarget: true });
                    } catch (pushError) {
                        const pushMessage = pushError instanceof Error ? pushError.message : String(pushError);
                        throw new Error(committedHash
                            ? i18n.t('Commit {0} succeeded; push to {1}/{2} failed: {3}', committedHash, params.pushTarget.remote, params.pushTarget.branch, pushMessage)
                            : i18n.t('Commit succeeded; push to {0}/{1} failed: {2}', params.pushTarget.remote, params.pushTarget.branch, pushMessage), { cause: pushError });
                    }
                }
            } catch (e) {
                failures.push(`${repoName}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        if (failures.length > 0) {
            throw new Error(failures.length === entries.length
                ? failures.join('\n')
                : `Workspace commit completed with failures:\n${failures.join('\n')}`);
        }
    };

    stage = async (filePath: FileReferenceInput): Promise<void> => {
        const ref = this.normalizeFileReference(filePath);
        await this.getServiceForRepo(ref.repoPath).stageFile(ref.path);
    };

    stageFiles = async (filePaths: FileReferenceInput[]): Promise<void> => {
        for (const [repoPath, paths] of this.groupFileReferences(filePaths)) {
            await this.getServiceForRepo(repoPath).stageFiles(paths);
        }
    };

    unstage = async (filePath: FileReferenceInput): Promise<void> => {
        const ref = this.normalizeFileReference(filePath);
        await this.getServiceForRepo(ref.repoPath).unstageFile(ref.path);
    };

    unstageFiles = async (filePaths: FileReferenceInput[]): Promise<void> => {
        for (const [repoPath, paths] of this.groupFileReferences(filePaths)) {
            await this.getServiceForRepo(repoPath).unstageFiles(paths);
        }
    };

    stageAll = async (): Promise<void> => {
        for (const service of this.repositoryManager.getAllServices()) {
            await service.stageAll();
        }
    };

    unstageAll = async (): Promise<void> => {
        for (const service of this.repositoryManager.getAllServices()) {
            await service.unstageAll();
        }
    };

    stageTracked = async (): Promise<void> => {
        for (const service of this.repositoryManager.getAllServices()) {
            await service.stageTracked();
        }
    };

    stash = async (params: { message?: string; files: FileReferenceInput[]; stagedOnly?: boolean }): Promise<void> => {
        try {
            let message = params.message;
            if (!message) {
                message = await vscode.window.showInputBox({
                    placeHolder: i18n.t('extension.stashPlaceholder')
                });
            }
            for (const [repoPath, files] of this.groupFileReferences(params.files)) {
                await this.getServiceForRepo(repoPath).stash(message, files, false, params.stagedOnly);
            }
            vscode.window.showInformationMessage(i18n.t('extension.stashSuccess'));
        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.stashFailed', `${e}`));
        }
    };

    deleteFiles = async (files: FileReferenceInput[]): Promise<void> => {
        const answer = await vscode.window.showWarningMessage(
            i18n.t('extension.deleteFilesConfirm', files.length),
            { modal: true },
            i18n.t('Delete')
        );
        if (answer === i18n.t('Delete')) {
            try {
                for (const [repoPath, repoFiles] of this.groupFileReferences(files)) {
                    const workspaceRoot = this.getServiceForRepo(repoPath).getWorkspaceRoot();
                    for (const file of repoFiles) {
                        const uri = vscode.Uri.file(`${workspaceRoot}/${file}`);
                        await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
                    }
                }

            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.deleteFailed', `${e}`));
            }
        }
    };

    rollback = async (files: FileReferenceInput[]): Promise<void> => {
        const answer = await vscode.window.showWarningMessage(
            i18n.t('extension.rollbackFilesConfirm', files.length),
            { modal: true },
            i18n.t('Rollback')
        );
        if (answer === i18n.t('Rollback')) {
            try {
                for (const [repoPath, repoFiles] of this.groupFileReferences(files)) {
                    await this.getServiceForRepo(repoPath).rollbackFiles(repoFiles);
                }

            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.rollbackFailed', `${e}`));
            }
        }
    };

    openFile = async (params: { path: string; repoPath?: string; preserveFocus?: boolean }): Promise<void> => {
        const gitService = this.getServiceForRepo(params.repoPath);
        const workspaceRoot = gitService.getWorkspaceRoot();
        if (!workspaceRoot) return;
        const uri = vscode.Uri.file(`${workspaceRoot}/${params.path}`);
        try {
            await vscode.workspace.fs.stat(uri);
            await vscode.commands.executeCommand('vscode.open', uri, {
                preserveFocus: params.preserveFocus ?? false
            });
        } catch {
            const status = await gitService.getStatus();
            const deleted = status.some(file => file.path === params.path && file.status === 'D');
            if (deleted) {
                await this.openDiff({
                    path: params.path,
                    repoPath: params.repoPath,
                    staged: status.find(file => file.path === params.path && file.status === 'D')?.staged
                });
            }
        }
    };

    openStashDiff = async (params: { index: number; path: string }): Promise<void> => {
        const stashRef = `stash@{${params.index}}`;
        const parentRef = `${stashRef}^`;
        const filePath = params.path;

        const leftUri = createStashContentUri(this.gitService, parentRef, filePath);
        const rightUri = createStashContentUri(this.gitService, stashRef, filePath);

        const title = `${path.basename(filePath)} (Stash@{${params.index}})`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
            preview: true,
            viewColumn: vscode.ViewColumn.Active
        });
    };

    switchBranch = async (branch: string): Promise<void> => {
        try {
            await this.gitService.branchRemote.switchBranch(branch);

        } catch (e) {
            if (await handleCheckoutWorktreeConflict({
                gitService: this.gitService,
                branch,
                error: e,
                retry: async () => {
                    await this.gitService.branchRemote.switchBranch(branch);
                    vscode.commands.executeCommand('intelli-git.refresh');
                }
            })) {
                return;
            }
            vscode.window.showErrorMessage(i18n.t('extension.switchBranchFailed', `${e}`));
        }
    };

    pull = async (): Promise<void> => {
        try {
            await this.gitService.branchRemote.pull();
            vscode.window.showInformationMessage(i18n.t('extension.pullSuccess'));
        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.pullFailed', `${e}`));
            throw e;
        }
    };

    fetch = async (): Promise<void> => {
        try {
            await this.gitService.branchRemote.fetch();
        } catch (e) {
            logger.error('Fetch failed:', e);
            throw e;
        }
    };

    focusGitLog = async (): Promise<void> => {
        await vscode.commands.executeCommand('intelli-git.focusGitLog');
    };

    switchRepository = async (): Promise<void> => {
        await vscode.commands.executeCommand('intelli-git.repository.switch');
    };

    openFolder = async (): Promise<void> => {
        await vscode.commands.executeCommand('workbench.action.files.openFolder');
    };

    openFeedback = async (): Promise<void> => {
        await vscode.commands.executeCommand('intelli-git.openFeedback');
    };

    openLatestRelease = async (): Promise<void> => {
        await vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_EXTENSION_URL));
    };

    private findExtensionSourceRoot(): string | undefined {
        const extensionPathCandidate = this.context.extensionPath
            ? path.resolve(this.context.extensionPath, '../..')
            : undefined;
        const workspaceCandidates = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || [];

        return [extensionPathCandidate, ...workspaceCandidates].find(isExtensionSourceRoot);
    }

    rebuildDevVsix = async (): Promise<void> => {
        const sourceRoot = this.findExtensionSourceRoot();
        if (!sourceRoot) {
            await vscode.env.openExternal(vscode.Uri.parse(DEV_BUILD_INSTRUCTIONS_URL));
            return;
        }

        const terminal = vscode.window.createTerminal({
            name: i18n.t('Intelli Git Dev Build'),
            cwd: sourceRoot
        });
        terminal.show();
        terminal.sendText('npm run install:extension:dev');
    };

    initializeRepository = async (): Promise<void> => {
        await vscode.commands.executeCommand('git.init');
        await this.repositoryManager.initialize();
    };

    configureAIProvider = async (): Promise<void> => {
        await vscode.commands.executeCommand('intelli-git.ai.configureProvider');
    };

    selectCopilotModel = async (): Promise<void> => {
        await vscode.commands.executeCommand('intelli-git.ai.selectCopilotModel');
    };

    openCommitPromptSettings = async (): Promise<void> => {
        await vscode.commands.executeCommand('intelli-git.ai.openCommitPromptSettings');
    };

    showErrorMessage = async (message: string): Promise<void> => {
        vscode.window.showErrorMessage(message);
    };

    pickBranch = async (): Promise<void> => {
        await vscode.commands.executeCommand('intelli-git.showBranchPicker');
    };

    continueRebase = async (params: { message?: string; files?: string[] }): Promise<void> => {
        try {
            const currentStatus = await this.getStatus();
            const unresolvedFiles = currentStatus.filter(
                file => (file.status === 'C' || file.status === 'U') && !file.resolvedCandidate
            );

            if (unresolvedFiles.length > 0) {
                vscode.window.showErrorMessage(i18n.t('extension.resolveConflictsBeforeContinue'));
                return;
            }

            const filesToStage = new Set<string>(params.files || []);

            // During merge/rebase continue, once no unmerged entries remain,
            // auto-stage tracked unresolved->resolved files so Git can continue.
            currentStatus
                .filter(file => !file.inactive && !file.staged && file.status !== '?')
                .forEach(file => filesToStage.add(file.path));

            for (const file of filesToStage) {
                await this.gitService.stageFile(file);
            }

            await this.gitService.branchRemote.continueRebase(params.message);
            vscode.window.showInformationMessage(i18n.t('extension.rebaseContinued'));

        } catch (e) {
            const errorMessage = `${e}`;
            if (
                errorMessage.includes('No changes - did you forget to use') ||
                errorMessage.includes('mark them as resolved using git add') ||
                errorMessage.includes('You must edit all merge conflicts')
            ) {
                vscode.window.showErrorMessage(i18n.t('extension.stageResolvedFilesBeforeContinue'));
                return;
            }

            vscode.window.showErrorMessage(i18n.t('extension.continueRebaseFailed', errorMessage));
        }
    };

    abortRebase = async (): Promise<void> => {
        try {
            await this.gitService.branchRemote.abortRebase();
            vscode.window.showInformationMessage(i18n.t('extension.rebaseAborted'));

        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.abortRebaseFailed', `${e}`));
        }
    };

    openConflictResolver = async (params: ConflictResolverOpenRequest): Promise<void> => {
        if (this.openConflictResolverPanel) {
            this.openConflictResolverPanel(params);
            return;
        }

        await vscode.commands.executeCommand('intelli-git.openConflictResolver', params);
    };

    updateConflictResolverTitle = async (params: { path: string; repoPath?: string }): Promise<void> => {
        this.updateConflictResolverPanelTitle?.({
            path: params.path,
            repoPath: params.repoPath
        });
    };

    getConflictFileContent = async (params: { path: string; repoPath?: string }): Promise<ConflictFileContent> => {
        const content = await this.getServiceForRepo(params.repoPath).getConflictFileContent(params.path);
        return {
            ...content,
            repoPath: params.repoPath
        };
    };

    saveConflictResolution = async (params: { path: string; repoPath?: string; content: string }): Promise<void> => {
        try {
            await this.getServiceForRepo(params.repoPath).saveConflictResolution(params.path, params.content);
            await vscode.commands.executeCommand('intelli-git.refresh');
        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.resolveConflictFailed', `${e}`));
            throw e;
        }
    };

    resolveConflict = async (params: { path: string; repoPath?: string; side: 'ours' | 'theirs' }): Promise<void> => {
        try {
            await this.getServiceForRepo(params.repoPath).resolveConflict(params.path, params.side);
            await vscode.commands.executeCommand('intelli-git.refresh');
        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.resolveConflictFailed', `${e}`));
            throw e;
        }
    };

    getAIProviderStatus = async (): Promise<AiProviderStatus> => {
        const provider = this.getCurrentAiProvider();
        const model = this.getAiProviderModel(provider);
        const configurationIssue = await this.getAiProviderConfigurationIssue(provider);

        return {
            provider,
            label: this.getAiProviderLabel(provider),
            model,
            isConfigured: !configurationIssue,
            canSelectModel: provider === AiProvider.Copilot,
            detail: configurationIssue
        };
    };

    testAIProvider = async (): Promise<AiProviderTestResult> => {
        try {
            const status = await this.getAIProviderStatus();
            const model = await this.getAIModel();
            const response = await model.sendRequest(
                [vscode.LanguageModelChatMessage.User('Reply with OK to confirm Intelli Git can reach this AI provider.')],
                {},
                new vscode.CancellationTokenSource().token
            );

            for await (const _fragment of response.text) {
                break;
            }

            return {
                ok: true,
                message: i18n.t('extension.aiProviderTestSucceeded', status.label, model.name || model.id)
            };
        } catch (e: any) {
            return {
                ok: false,
                message: e?.message || String(e)
            };
        }
    };

    generateCommitMessage = async (request?: CommitMessageGenerationRequest): Promise<CommitMessageGenerationResult> => {
        try {
            let diff = '';
            const files = request?.files;
            const mode = request?.mode || 'full';

            if (files && files.length > 0) {
                const parts: string[] = [];
                for (const [repoPath, repoFiles] of this.groupFileReferences(files)) {
                    const gitService = this.getServiceForRepo(repoPath);
                    const repoName = this.getRepositoryName(repoPath, gitService);
                    const changelistState = gitService.changelistStateService?.getState();
                    let repoDiff = '';

                    if (changelistState?.mode === 'changes') {
                        const status = await this.getStatusWithStateForService(gitService);
                        const plan = gitService.changelistStateService?.buildCommitPlan(status, repoFiles);
                        repoDiff = plan ? await gitService.getDiffForChangelistPlan(plan, status) : '';
                    } else {
                        repoDiff = await gitService.getStagedDiffForFiles(repoFiles);
                    }

                    if (repoDiff) {
                        parts.push(`# Repository: ${repoName}\n${repoDiff}`);
                    }
                }
                diff = parts.join('\n\n');
            } else {
                const changelistState = this.changelistStateService?.getState();

                if (changelistState?.mode === 'changes') {
                    const status = await this.getStatusWithState();
                    const plan = this.changelistStateService?.buildCommitPlan(status, undefined);
                    diff = plan ? await this.gitService.getDiffForChangelistPlan(plan, status) : '';
                } else {
                    diff = await this.gitService.getStagedDiff();
                }
            }

            if (!diff) {
                return {
                    message: '',
                    mode,
                    fileCount: 0,
                    hunkCount: 0
                };
            }

            const model = await this.getAIModel();
            const commitPrompt = vscode.workspace
                .getConfiguration('intelli-git.ai')
                .get<string>('commitPrompt', DEFAULT_COMMIT_MESSAGE_PROMPT)
                .trim() || DEFAULT_COMMIT_MESSAGE_PROMPT;

            const messages = [
                vscode.LanguageModelChatMessage.User(createCommitMessageGenerationPrompt(commitPrompt, mode, request?.amend))
            ];
            const selectedText = request?.selectedText?.trim();
            const currentMessage = request?.currentMessage?.trim();

            if (mode === 'rewrite' && selectedText) {
                messages.push(vscode.LanguageModelChatMessage.User(`Selected commit message text:\n${selectedText}`));
            } else if (currentMessage) {
                messages.push(vscode.LanguageModelChatMessage.User(`Current commit message:\n${currentMessage}`));
            }

            messages.push(vscode.LanguageModelChatMessage.User(`Diff:\n${diff}`));

            logger.debug('Generating commit message:', diff.length);
            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
            logger.debug('Generating commit message responsed');

            let fullMessage = '';
            for await (const fragment of response.text) {
                fullMessage += fragment;
            }
            logger.debug('Generated commit message:', fullMessage);
            return {
                message: fullMessage.trim(),
                mode,
                fileCount: countDiffFiles(diff),
                hunkCount: countDiffHunks(diff)
            };
        } catch (e) {
            logger.error('Error generating commit message:', e);
            throw e;
        }
    };

    private getCurrentAiProvider(): AiProviderId {
        const provider = vscode.workspace.getConfiguration('intelli-git.ai').get<string>('provider', AiProvider.Copilot);
        if (
            provider === AiProvider.Copilot ||
            provider === AiProvider.Anthropic ||
            provider === AiProvider.Google ||
            provider === AiProvider.OpenAi
        ) {
            return provider;
        }

        return AiProvider.Copilot;
    }

    private getAiProviderLabel(provider: AiProviderId): string {
        if (provider === AiProvider.Copilot) {
            return 'Copilot';
        }

        if (provider === AiProvider.Anthropic) {
            return 'Anthropic';
        }

        if (provider === AiProvider.Google) {
            return 'Google';
        }

        return 'Custom OpenAI-Compatible';
    }

    private getAiProviderModel(provider: AiProviderId): string {
        if (provider === AiProvider.Copilot) {
            return vscode.workspace.getConfiguration('intelli-git.ai.copilot').get<string>('model', DEFAULT_COPILOT_MODEL);
        }

        const configuredModel = vscode.workspace.getConfiguration(`intelli-git.ai.${provider}`).get<string>('model', '');
        if (configuredModel) {
            return configuredModel;
        }

        if (provider === AiProvider.Google) {
            return DEFAULT_GOOGLE_MODEL;
        }

        if (provider === AiProvider.OpenAi) {
            return DEFAULT_CUSTOM_OPENAI_MODEL;
        }

        return '';
    }

    private getAiProviderApiUrl(provider: AiProviderId): string {
        if (provider === AiProvider.Copilot) {
            return '';
        }

        const configuredApiUrl = vscode.workspace.getConfiguration(`intelli-git.ai.${provider}`).get<string>('apiUrl', '');
        if (configuredApiUrl) {
            return configuredApiUrl;
        }

        if (provider === AiProvider.Google) {
            return DEFAULT_GOOGLE_API_URL;
        }

        if (provider === AiProvider.OpenAi) {
            return DEFAULT_CUSTOM_OPENAI_API_URL;
        }

        return '';
    }

    private async getAiProviderConfigurationIssue(provider: AiProviderId): Promise<string | undefined> {
        if (provider === AiProvider.Copilot || provider === AiProvider.OpenAi) {
            return undefined;
        }

        const apiKey = await getAiApiKey(this.context, provider);
        if (!apiKey) {
            return i18n.t('extension.apiKeyMissing');
        }

        if (provider === AiProvider.Anthropic && !this.getAiProviderApiUrl(provider)) {
            return i18n.t('extension.apiUrlMissing');
        }

        return undefined;
    }

    private async getAIModel(): Promise<vscode.LanguageModelChat> {
        const provider = this.getCurrentAiProvider();

        if (provider === AiProvider.Anthropic) {
            const apiKey = await getAiApiKey(this.context, 'anthropic');
            const model = new AnthropicService().getModel(apiKey);
            if (!model) {
                throw createRpcError(
                    apiKey ? i18n.t('extension.anthropicApiUrlMissing') : i18n.t('extension.anthropicApiKeyMissing'),
                    AI_PROVIDER_SETUP_REQUIRED_CODE,
                    { provider, action: 'configure' }
                );
            }
            return model;
        }

        if (provider === AiProvider.Google) {
            const apiKey = await getAiApiKey(this.context, 'google');
            const model = new GoogleAiService().getModel(apiKey);
            if (!model) {
                throw createRpcError(
                    i18n.t('extension.googleApiKeyMissing'),
                    AI_PROVIDER_SETUP_REQUIRED_CODE,
                    { provider, action: 'configure' }
                );
            }
            return model;
        }

        if (provider === AiProvider.OpenAi) {
            const apiKey = await getAiApiKey(this.context, 'custom');
            const model = new OpenAiService().getModel(apiKey);
            if (!model) {
                throw createRpcError(
                    i18n.t('extension.noAIModel'),
                    AI_PROVIDER_SETUP_REQUIRED_CODE,
                    { provider, action: 'configure' }
                );
            }
            return model;
        }

        // Default: use Copilot
        const preferredCopilotModel = this.normalizeModelIdentifier(
            vscode.workspace.getConfiguration('intelli-git.ai.copilot').get<string>('model', DEFAULT_COPILOT_MODEL)
        );

        const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        let model = copilotModels.find(candidate => {
            const identifiers = [
                this.normalizeModelIdentifier(candidate.id),
                this.normalizeModelIdentifier(candidate.name),
                this.normalizeModelIdentifier(candidate.family)
            ];

            return identifiers.includes(preferredCopilotModel);
        });

        if (!model && copilotModels.length > 0) {
            throw createRpcError(
                i18n.t('extension.copilotModelUnavailable', preferredCopilotModel),
                AI_COPILOT_MODEL_UNAVAILABLE_CODE,
                { provider, action: 'selectCopilotModel' }
            );
        }

        if (!model) {
            throw createRpcError(
                i18n.t('extension.noCopilotModelsAvailable'),
                AI_PROVIDER_SETUP_REQUIRED_CODE,
                { provider, action: 'configure' }
            );
        }

        logger.info('Using copilot AI model:', model.id, model.name, model.vendor);

        return model;
    }

}
