import { describe, expect, it, vi } from 'vitest';
import { ExtensionRpcHandler } from './ExtensionRpcHandler';
import type { ChangelistState } from '@shared/messages';
import type { ChangelistStateService } from '../services/ChangelistStateService';
import type { GitService } from '../services/GitService';
import type { InactiveChangesService } from '../services/InactiveChangesService';
import type * as vscode from 'vscode';

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
    return new ExtensionRpcHandler({
        context: {} as vscode.ExtensionContext,
        gitService: gitService as GitService,
        inactiveChangesService: {} as InactiveChangesService,
        changelistStateService: {
            getState: () => createStagedChangelistState()
        } as ChangelistStateService
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
