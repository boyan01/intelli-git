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

    it('rejects legacy commit push intent without a confirmed target', async () => {
        const commit = vi.fn().mockResolvedValue(undefined);
        const handler = createHandler({ commit });

        await expect(handler.commit({
            message: 'Commit and push',
            amend: false,
            files: ['file.txt'],
            push: true
        })).rejects.toThrow('Commit & Push requires a confirmed push target.');

        expect(commit).not.toHaveBeenCalled();
    });

    it('pushes commit output to the confirmed target and sets upstream from that target', async () => {
        const commit = vi.fn().mockResolvedValue(undefined);
        const branchRemote = {
            getBranches: vi.fn().mockResolvedValue({ current: 'feature', all: ['feature'] }),
            getUpstreamBranch: vi.fn().mockResolvedValue(undefined),
            push: vi.fn().mockResolvedValue(undefined),
            setUpstreamBranch: vi.fn().mockResolvedValue(undefined)
        };
        const handler = createHandler({
            commit,
            branchRemote,
            getLastCommitInfo: vi.fn().mockResolvedValue({
                hash: 'abcdef1234567890',
                shortHash: 'abcdef1',
                subject: 'Commit and push',
                message: 'Commit and push',
                files: []
            })
        } as unknown as Partial<GitService>);

        await handler.commit({
            message: 'Commit and push',
            amend: false,
            files: ['file.txt'],
            pushTarget: { remote: 'fork', branch: 'review/feature' }
        });

        expect(commit).toHaveBeenCalledWith('Commit and push', undefined);
        expect(branchRemote.push).toHaveBeenCalledWith('fork', 'feature:review/feature', {
            noVerify: undefined,
            setUpstream: true
        });
        expect(branchRemote.setUpstreamBranch).not.toHaveBeenCalled();
    });

    it('reports the committed hash when push after commit fails', async () => {
        const commit = vi.fn().mockResolvedValue(undefined);
        const branchRemote = {
            getBranches: vi.fn().mockResolvedValue({ current: 'feature', all: ['feature'] }),
            getUpstreamBranch: vi.fn().mockResolvedValue('origin/feature'),
            push: vi.fn().mockRejectedValue(new Error('remote rejected')),
            fetch: vi.fn().mockResolvedValue(undefined),
            getBranchStatus: vi.fn().mockResolvedValue({ ahead: 1, behind: 0 })
        };
        const handler = createHandler({
            commit,
            branchRemote,
            getLastCommitInfo: vi.fn().mockResolvedValue({
                hash: 'abcdef1234567890',
                shortHash: 'abcdef1',
                subject: 'Commit and push',
                message: 'Commit and push',
                files: []
            })
        } as unknown as Partial<GitService>);

        await expect(handler.commit({
            message: 'Commit and push',
            amend: false,
            files: ['file.txt'],
            pushTarget: { remote: 'fork', branch: 'feature' }
        })).rejects.toThrow('workspace: Commit abcdef1 succeeded; push to fork/feature failed: remote rejected');

        expect(commit).toHaveBeenCalledWith('Commit and push', undefined);
        expect(branchRemote.push).toHaveBeenCalledWith('fork', 'feature:feature', {
            noVerify: undefined,
            setUpstream: false
        });
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

        expect(branchRemote.push).toHaveBeenCalledWith('origin', 'main:main', {
            noVerify: undefined,
            setUpstream: false
        });
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
        const repository = {
            name: 'repo',
            repoPath: '/workspace/repo',
            path: '/workspace/repo',
            workspaceRoot: '/workspace/repo',
            gitRoot: '/workspace/repo',
            isSubmodule: false as const
        };
        const readHandler = new GitReadRpcHandler({
            getActiveScope: () => repository,
            getActiveService: () => ({
                branchRemote: {
                    getBranchListData: vi.fn().mockResolvedValue(branchData)
                }
            })
        } as any);

        await expect(readHandler.getBranchListData()).resolves.toEqual({
            ...branchData,
            repository,
            hasRepository: true
        });
    });

    it('loads commit view files only for the active repository', async () => {
        const repositoryA = {
            name: 'repo-a',
            repoPath: '/workspace/repo-a',
            path: '/workspace/repo-a',
            workspaceRoot: '/workspace/repo-a',
            gitRoot: '/workspace/repo-a',
            isSubmodule: false as const
        };
        const repositoryB = {
            name: 'repo-b',
            repoPath: '/workspace/repo-b',
            path: '/workspace/repo-b',
            workspaceRoot: '/workspace/repo-b',
            gitRoot: '/workspace/repo-b',
            isSubmodule: false as const
        };
        const serviceA = {
            getStatus: vi.fn().mockResolvedValue([{ path: 'a.txt', status: 'M', staged: false }]),
            getWorkspaceRoot: () => '/workspace/repo-a'
        } as Partial<GitService>;
        const serviceB = {
            getStatus: vi.fn().mockResolvedValue([{ path: 'b.txt', status: 'M', staged: false }]),
            getWorkspaceRoot: () => '/workspace/repo-b'
        } as Partial<GitService>;

        for (const service of [serviceA, serviceB]) {
            Object.defineProperty(service, 'inactiveChangesService', {
                get: () => ({
                    syncWithStatus: vi.fn(),
                    isInactive: vi.fn().mockReturnValue(false),
                    getInactiveHunkIds: vi.fn().mockReturnValue([])
                } as Partial<InactiveChangesService>)
            });
            Object.defineProperty(service, 'changelistStateService', {
                get: () => ({
                    syncWithStatus: vi.fn(),
                    getState: () => createStagedChangelistState()
                } as Partial<ChangelistStateService>)
            });
        }

        const handler = new ExtensionRpcHandler({
            context: {} as vscode.ExtensionContext,
            repositoryManager: {
                getActiveRepoPath: () => repositoryB.repoPath,
                getActiveService: () => serviceB as GitService,
                getService: (repoPath: string) => repoPath === repositoryB.repoPath ? serviceB as GitService : serviceA as GitService,
                getRepositories: () => [repositoryA, repositoryB]
            } as any
        });

        const state = await handler.getCommitViewState();

        expect(state.activeRepository).toEqual(repositoryB);
        expect(state.repositories?.map(item => item.repository.repoPath)).toEqual([repositoryB.repoPath]);
        expect(state.files).toEqual([{
            path: 'b.txt',
            status: 'M',
            staged: false,
            inactive: false,
            inactiveHunkIds: [],
            hasStagedInactive: false
        }]);
        expect(serviceA.getStatus).not.toHaveBeenCalled();
        expect(serviceB.getStatus).toHaveBeenCalledOnce();
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
