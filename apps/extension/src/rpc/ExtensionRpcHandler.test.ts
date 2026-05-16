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
            currentBranch: '',
            localBranches: [],
            localBranchesInfo: [],
            remoteBranches: {},
            tags: []
        });
        await expect(readHandler.getLog({})).resolves.toEqual([]);
        await expect(readHandler.getWorkspaceRoot()).resolves.toBe('');
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
