import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { FileStatus } from '@shared/messages';
import { EditorHunkResolver } from './EditorHunkResolver';
import type { GitService } from '../services/GitService';
import type { InactiveChangesService } from '../services/InactiveChangesService';
import type { ChangelistStateService } from '../services/ChangelistStateService';
import { createHunk } from '../testSupport/hunks';

describe('EditorHunkResolver lazy untracked hunks', () => {
    it('resolves editor labels and command targets without adding content to shared status', async () => {
        const status: FileStatus[] = [
            { path: 'new.txt', status: '?', staged: false, inactive: true },
            { path: 'other.txt', status: '?', staged: false }
        ];
        const hunk = createHunk('new.txt:worktree:0:0:1:2:hash', 0, 1, 0, 2);
        const getFileStatusWithHunks = vi.fn(async (filePath: string, snapshot: FileStatus[]) =>
            snapshot.filter(file => file.path === filePath).map(file => ({ ...file, hunks: [hunk] }))
        );
        const resolver = new EditorHunkResolver(
            {
                getWorkspaceRoot: () => '/repo',
                getStatus: async () => status,
                getFileStatusWithHunks
            } as unknown as GitService,
            { syncWithStatus: vi.fn(), getInactiveHunkIds: () => [] } as unknown as InactiveChangesService,
            {
                syncWithStatus: vi.fn(),
                getState: () => ({ mode: 'staged', assignments: {}, lists: [], activeListId: 'changes' })
            } as unknown as ChangelistStateService
        );
        const document = { uri: { scheme: 'file', fsPath: '/repo/new.txt' }, lineCount: 2 } as vscode.TextDocument;
        const target = await resolver.resolveTargetAt(document, 1);
        expect(target?.hunk).toBe(hunk);
        expect(target?.inactive).toBe(true);
        const decorations = await resolver.getDecorations({ document } as vscode.TextEditor);
        expect(decorations).toHaveLength(1);
        expect(decorations[0]).toMatchObject({ startLine: 1, endLine: 2, inactive: true });
        expect(decorations[0].label).toBeTruthy();
        expect(getFileStatusWithHunks).toHaveBeenCalledWith('new.txt', status);
        expect(status.every(file => !file.hunks)).toBe(true);
    });
});
