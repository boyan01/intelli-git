import { describe, expect, it, vi } from 'vitest';
import { ExtensionRpcHandler } from './ExtensionRpcHandler';
import { GitReadRpcHandler } from './GitReadRpcHandler';
import type { ChangelistState } from '@shared/messages';
import type { ChangelistStateService } from '../services/ChangelistStateService';
import type { GitService } from '../services/GitService';
import type { InactiveChangesService } from '../services/InactiveChangesService';
import type * as vscode from 'vscode';
import * as vscodeMock from 'vscode';

const vscodeTestMock = vscodeMock as unknown as {
    __getExecutedCommands(): Array<{ command: string; args: unknown[] }>;
    __resetExecutedCommands(): void;
};

function createStagedChangelistState(): ChangelistState {
    return {
        mode: 'staged',
        activeListId: 'changes',
        lists: [
            { id: 'changes', name: 'Changes', isDefault: true, isActive: true },
            { id: 'inactive-changes', name: 'Inactive Changes', isDefault: true, isActive: false }
        ],
        assignments: {}
    };
}

function createHandler(gitService: Partial<GitService>): ExtensionRpcHandler {
    // Add getActiveService to the gitService mock or wrap it
    const gitServiceMock = gitService as GitService;
    if (!gitServiceMock.getWorkspaceRoot) {
        (gitServiceMock as unknown as { getWorkspaceRoot: () => string }).getWorkspaceRoot = () => '/workspace';
    }
    // We mock properties accessed via get inactiveChangesService / changelistStateService
    Object.defineProperty(gitServiceMock, 'inactiveChangesService', {
        get: () => ({} as InactiveChangesService)
    });
    Object.defineProperty(gitServiceMock, 'changelistStateService', {
        get: () => ({
            getState: () => createStagedChangelistState()
        } as ChangelistStateService)
    });

    return new ExtensionRpcHandler({
        context: {} as vscode.ExtensionContext,
        repositoryManager: { getActiveService: () => gitServiceMock } as any,
    });
}

function createNoRepoHandler(): ExtensionRpcHandler {
    return new ExtensionRpcHandler({
        context: {} as vscode.ExtensionContext,
        repositoryManager: { getActiveService: () => undefined } as any,
    });
}

describe('ExtensionRpcHandler commit', () => {
    it('uses the current index for staged mode commits', async () => {
        const commit = vi.fn().mockResolvedValue(undefined);
        const handler = createHandler({ commit });

        await handler.commit({
            message: 'Commit partial staging',
            amend: false,
            files: ['partial.txt']
        });

        expect(commit).toHaveBeenCalledWith('Commit partial staging', undefined);
    });

    it('uses the current index for staged mode amend commits', async () => {
        const commitAmend = vi.fn().mockResolvedValue(undefined);
        const handler = createHandler({ commitAmend });

        await handler.commit({
            message: 'Amend partial staging',
            amend: true,
            files: ['partial.txt']
        });

        expect(commitAmend).toHaveBeenCalledWith('Amend partial staging', undefined);
    });

    it('commits each selected repository in a workspace commit', async () => {
        const commitA = vi.fn().mockResolvedValue(undefined);
        const commitB = vi.fn().mockResolvedValue(undefined);
        const serviceA = {
            commit: commitA,
            getWorkspaceRoot: () => '/workspace/a'
        } as Partial<GitService>;
        const serviceB = {
            commit: commitB,
            getWorkspaceRoot: () => '/workspace/b'
        } as Partial<GitService>;

        for (const service of [serviceA, serviceB]) {
            Object.defineProperty(service, 'inactiveChangesService', {
                get: () => ({} as InactiveChangesService)
            });
            Object.defineProperty(service, 'changelistStateService', {
                get: () => ({
                    getState: () => createStagedChangelistState()
                } as ChangelistStateService)
            });
        }

        const handler = new ExtensionRpcHandler({
            context: {} as vscode.ExtensionContext,
            repositoryManager: {
                getActiveService: () => serviceA as GitService,
                getService: (repoPath: string) => repoPath === '/workspace/b' ? serviceB as GitService : serviceA as GitService,
                getRepositories: () => [
                    { name: 'a', repoPath: '/workspace/a', path: '/workspace/a', workspaceRoot: '/workspace/a', gitRoot: '/workspace/a', isSubmodule: false },
                    { name: 'b', repoPath: '/workspace/b', path: '/workspace/b', workspaceRoot: '/workspace/b', gitRoot: '/workspace/b', isSubmodule: false }
                ]
            } as any
        });

        await handler.commit({
            message: 'Commit workspace changes',
            amend: false,
            files: [
                { repoPath: '/workspace/a', path: 'a.txt' },
                { repoPath: '/workspace/b', path: 'b.txt' }
            ]
        });

        expect(commitA).toHaveBeenCalledWith('Commit workspace changes', undefined);
        expect(commitB).toHaveBeenCalledWith('Commit workspace changes', undefined);
    });
});

describe('ExtensionRpcHandler push', () => {
    it('fetches and reports behind count when a normal push is rejected', async () => {
        const branchRemote = {
            getBranches: vi.fn().mockResolvedValue({ current: 'main', all: ['main'] }),
            getUpstreamBranch: vi.fn().mockResolvedValue('origin/main'),
            push: vi.fn().mockRejectedValue(new Error('non-fast-forward')),
            fetch: vi.fn().mockResolvedValue(undefined),
            getBranchStatus: vi.fn().mockResolvedValue({ ahead: 0, behind: 2 })
        };
        const handler = createHandler({
            branchRemote
        } as unknown as Partial<GitService>);

        await expect(handler.push({
            force: false,
            pushTags: false,
            remote: 'origin',
            branch: 'main'
        })).rejects.toThrow('PUSH_REJECTED_BEHIND:2');

        expect(branchRemote.push).toHaveBeenCalledWith('origin', 'main:main', { noVerify: undefined });
        expect(branchRemote.fetch).toHaveBeenCalledOnce();
        expect(branchRemote.getBranchStatus).toHaveBeenCalledOnce();
    });
});

describe('ExtensionRpcHandler no repository state', () => {
    it('returns empty read models instead of throwing', async () => {
        const handler = createNoRepoHandler();
        const readHandler = new GitReadRpcHandler({ getActiveService: () => undefined } as any);

        await expect(handler.getCommitViewState()).resolves.toMatchObject({
            files: [],
            workspaceRoot: '',
            hasRepository: false
        });
        await expect(readHandler.getStashList()).resolves.toEqual([]);
        await expect(readHandler.getBranchListData()).resolves.toEqual({
            hasRepository: false,
            currentBranch: '',
            localBranches: [],
            localBranchesInfo: [],
            remoteBranches: {},
            tags: []
        });
        await expect(readHandler.getLog({})).resolves.toEqual([]);
        await expect(readHandler.getWorkspaceRoot()).resolves.toBe('');
    });

    it('marks branch list data as repository-backed when a repository is active', async () => {
        const branchData = {
            currentBranch: 'main',
            localBranches: ['main'],
            localBranchesInfo: [],
            remoteBranches: {},
            tags: []
        };
        const readHandler = new GitReadRpcHandler({
            getActiveService: () => ({
                branchRemote: {
                    getBranchListData: vi.fn().mockResolvedValue(branchData)
                }
            })
        } as any);

        await expect(readHandler.getBranchListData()).resolves.toEqual({
            ...branchData,
            hasRepository: true
        });
    });

    it('rescans repositories after initializing a repository', async () => {
        vscodeTestMock.__resetExecutedCommands();
        const initialize = vi.fn().mockResolvedValue(undefined);
        const handler = new ExtensionRpcHandler({
            context: {} as vscode.ExtensionContext,
            repositoryManager: {
                getActiveService: () => undefined,
                initialize
            } as any
        });

        await handler.initializeRepository();

        expect(vscodeTestMock.__getExecutedCommands()).toContainEqual({
            command: 'git.init',
            args: []
        });
        expect(initialize).toHaveBeenCalledOnce();
    });

    it('opens AI provider setup from webview empty states', async () => {
        vscodeTestMock.__resetExecutedCommands();
        const handler = createNoRepoHandler();

        await handler.configureAIProvider();

        expect(vscodeTestMock.__getExecutedCommands()).toContainEqual({
            command: 'intelli-git.ai.configureProvider',
            args: []
        });
    });
});

describe('ExtensionRpcHandler openDiff', () => {
    it('accepts RpcPeer multi-argument payloads for deleted files', async () => {
        vscodeTestMock.__resetExecutedCommands();
        const handler = createHandler({
            getStatus: vi.fn().mockResolvedValue([
                { path: 'src/deleted.txt', status: 'D', staged: false }
            ])
        });

        await handler.openDiff(['src/deleted.txt', false]);

        const commands = vscodeTestMock.__getExecutedCommands();
        expect(commands).toHaveLength(1);
        expect(commands[0].command).toBe('vscode.diff');
        expect(String(commands[0].args[0])).toContain('"ref":"HEAD"');
        expect(String(commands[0].args[0])).toContain('"preferStaged":false');
        expect(String(commands[0].args[1])).toContain('"ref":"WORKTREE"');
    });
});
