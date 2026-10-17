import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { ChangelistState, FileStatus } from '@shared/messages';
import { EditorHunkResolver } from './EditorHunkResolver';
import type { GitService } from '../services/GitService';
import type { ChangelistStateService } from '../services/ChangelistStateService';
import { createHunk } from '../testSupport/hunks';

function createResolver(
    status: FileStatus[],
    state: ChangelistState,
    hunk = createHunk('new.txt:head:0:0:1:2:hash', 0, 1, 0, 2)
) {
    const getFileStatusWithHunks = vi.fn(async (filePath: string, snapshot: FileStatus[]) =>
        snapshot.filter((file) => file.path === filePath).map((file) => ({ ...file, hunks: [hunk] }))
    );
    const resolver = new EditorHunkResolver(
        {
            getWorkspaceRoot: () => '/repo',
            getStatus: async () => status,
            getFileStatusWithHunks,
        } as unknown as GitService,
        {
            syncWithStatus: vi.fn(),
            getState: () => state,
        } as unknown as ChangelistStateService
    );
    return { resolver, getFileStatusWithHunks, hunk };
}

const lists = [
    { id: 'changes', name: 'Changes', isDefault: true, isActive: true },
    { id: 'later', name: 'Later', isDefault: false, isActive: false },
];

describe('EditorHunkResolver', () => {
    it('labels change blocks of non-active changelists without adding content to shared status', async () => {
        const status: FileStatus[] = [
            { path: 'new.txt', status: '?', staged: false },
            { path: 'other.txt', status: '?', staged: false },
        ];
        const { resolver, getFileStatusWithHunks, hunk } = createResolver(status, {
            mode: 'changes',
            activeListId: 'changes',
            lists,
            assignments: { 'new.txt': { fileListId: 'later' } },
        });
        const document = { uri: { scheme: 'file', fsPath: '/repo/new.txt' }, lineCount: 2 } as vscode.TextDocument;

        const target = await resolver.resolveTargetAt(document, 1);
        expect(target?.hunk).toBe(hunk);
        expect(target?.changelist?.id).toBe('later');

        const decorations = await resolver.getDecorations({ document } as vscode.TextEditor);
        expect(decorations).toHaveLength(1);
        expect(decorations[0]).toMatchObject({ startLine: 1, endLine: 2, label: 'Later' });
        expect(getFileStatusWithHunks).toHaveBeenCalledWith('new.txt', status);
        expect(status.every((file) => !file.hunks)).toBe(true);
    });

    it('stays idle in staged mode', async () => {
        const { resolver } = createResolver([{ path: 'new.txt', status: '?', staged: false }], {
            mode: 'staged',
            activeListId: 'changes',
            lists,
            assignments: {},
        });
        const document = { uri: { scheme: 'file', fsPath: '/repo/new.txt' }, lineCount: 2 } as vscode.TextDocument;

        expect(await resolver.resolveTargetAt(document, 1)).toBeUndefined();
        expect(await resolver.getDecorations({ document } as vscode.TextEditor)).toEqual([]);
    });
});
