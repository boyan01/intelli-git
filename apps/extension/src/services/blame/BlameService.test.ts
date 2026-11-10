import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { GitService } from '../GitService';
import type { RepositoryManager } from '../RepositoryManager';
import { BlameService } from './BlameService';

function createService(head: () => string | null) {
    return {
        getWorkspaceRoot: () => '/repo',
        getFileBlame: vi.fn(async () => ({ lines: [], originalLines: [], commits: new Map() })),
        getHeadCommit: vi.fn(async () => head()),
        onDidChange: () => ({ dispose() {} }),
    };
}

function createBlameService(service: ReturnType<typeof createService>) {
    const repositoryManager = {
        onDidChangeRepositories: () => ({ dispose() {} }),
        getRepositoryForFile: () => ({ service, scope: { repoPath: '/repo' } }),
    };
    return new BlameService(repositoryManager as unknown as RepositoryManager);
}

const document = {
    uri: { scheme: 'file', fsPath: '/repo/src/app.ts', toString: () => 'file:///repo/src/app.ts' },
    isUntitled: false,
    isDirty: false,
    version: 1,
    getText: () => '',
} as unknown as vscode.TextDocument;

describe('BlameService', () => {
    let blameService: BlameService | undefined;

    afterEach(() => {
        blameService?.dispose();
        blameService = undefined;
    });

    it('reuses cached blame while HEAD is unchanged', async () => {
        const service = createService(() => 'a'.repeat(40));
        blameService = createBlameService(service);
        const invalidated = vi.fn();
        blameService.onDidInvalidate(invalidated);

        await blameService.getBlame(document);
        await blameService.checkRepositoryHeads();
        await blameService.getBlame(document);

        expect(invalidated).not.toHaveBeenCalled();
        expect(service.getFileBlame).toHaveBeenCalledTimes(1);
    });

    it('invalidates cached blame when HEAD moves outside Intelli Git', async () => {
        let head = 'a'.repeat(40);
        const service = createService(() => head);
        blameService = createBlameService(service);
        const invalidated = vi.fn();
        blameService.onDidInvalidate(invalidated);

        const first = await blameService.getBlame(document);
        head = 'b'.repeat(40);
        await blameService.checkRepositoryHeads();
        const second = await blameService.getBlame(document);

        expect(invalidated).toHaveBeenCalledTimes(1);
        expect(service.getFileBlame).toHaveBeenCalledTimes(2);
        expect(second?.service).toBe(service as unknown as GitService);
        expect(second).not.toBe(first);
    });
});
