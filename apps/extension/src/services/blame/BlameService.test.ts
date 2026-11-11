import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { GitService } from '../GitService';
import type { RepositoryManager } from '../RepositoryManager';
import { BlameService } from './BlameService';

function createService(head: () => string | null, index: () => string | null = () => 'index-1') {
    return {
        getWorkspaceRoot: () => '/repo',
        getFileBlame: vi.fn(
            async (
                _filePath: string,
                _options: { signal?: AbortSignal } = {}
            ): Promise<{ lines: string[]; originalLines: number[]; commits: Map<string, unknown> }> => ({
                lines: [],
                originalLines: [],
                commits: new Map(),
            })
        ),
        getHeadCommit: vi.fn(async () => head()),
        getIndexSignature: vi.fn(async () => index()),
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
        await blameService.checkRepositoryState();
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
        await blameService.checkRepositoryState();
        const second = await blameService.getBlame(document);

        expect(invalidated).toHaveBeenCalledTimes(1);
        expect(service.getFileBlame).toHaveBeenCalledTimes(2);
        expect(second?.service).toBe(service as unknown as GitService);
        expect(second).not.toBe(first);
    });

    it('aborts a superseded blame and hands its waiters the newest result', async () => {
        const service = createService(() => 'a'.repeat(40));
        const signals: AbortSignal[] = [];
        service.getFileBlame.mockImplementation(async (_filePath: string, options: { signal?: AbortSignal } = {}) => {
            signals.push(options.signal!);
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { lines: [String(signals.length)], originalLines: [1], commits: new Map() };
        });
        blameService = createBlameService(service);
        const editing = { ...document, isDirty: true, version: 2 } as unknown as vscode.TextDocument;

        const stale = blameService.getBlame(editing);
        const fresh = blameService.getBlame({ ...editing, version: 3 } as unknown as vscode.TextDocument);

        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);
        expect(await stale).toBe(await fresh);
        expect(blameService.getLastBlame(editing)?.version).toBe(3);
    });

    it('keeps the last finished blame available without starting git', async () => {
        const service = createService(() => 'a'.repeat(40));
        blameService = createBlameService(service);

        expect(blameService.getLastBlame(document)).toBeUndefined();
        const result = await blameService.getBlame(document);

        expect(blameService.getLastBlame({ ...document, version: 5 } as unknown as vscode.TextDocument)).toEqual({
            version: 1,
            documentBlame: result,
        });
        expect(service.getFileBlame).toHaveBeenCalledTimes(1);
    });

    it('retries an unavailable blame after the index changes', async () => {
        let index = 'index-1';
        const service = createService(
            () => 'a'.repeat(40),
            () => index
        );
        service.getFileBlame.mockResolvedValueOnce(null as never);
        blameService = createBlameService(service);
        const invalidated = vi.fn();
        blameService.onDidInvalidate(invalidated);

        expect(await blameService.getBlame(document)).toBeUndefined();
        await blameService.checkRepositoryState();
        expect(await blameService.getBlame(document)).toBeUndefined();
        expect(service.getFileBlame).toHaveBeenCalledTimes(1);

        index = 'index-2';
        await blameService.checkRepositoryState();
        const retried = await blameService.getBlame(document);

        expect(invalidated).toHaveBeenCalledTimes(1);
        expect(service.getFileBlame).toHaveBeenCalledTimes(2);
        expect(retried?.service).toBe(service as unknown as GitService);
    });

    it('keeps available blame when only the index changes', async () => {
        let index = 'index-1';
        const service = createService(
            () => 'a'.repeat(40),
            () => index
        );
        blameService = createBlameService(service);
        const invalidated = vi.fn();
        blameService.onDidInvalidate(invalidated);

        const first = await blameService.getBlame(document);
        index = 'index-2';
        await blameService.checkRepositoryState();

        expect(await blameService.getBlame(document)).toBe(first);
        expect(invalidated).not.toHaveBeenCalled();
        expect(service.getFileBlame).toHaveBeenCalledTimes(1);
    });
});
