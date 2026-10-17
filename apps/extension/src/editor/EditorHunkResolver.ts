import * as path from 'path';
import * as vscode from 'vscode';
import type { ChangelistInfo, FileStatus, GitHunk } from '@shared/messages';
import { GitService } from '../services/GitService';
import { ChangelistStateService } from '../services/ChangelistStateService';

export type EditorDiffSide = 'original' | 'modified';

export interface EditorDocumentTarget {
    relativePath: string;
    side: EditorDiffSide;
}

export interface EditorHunkInfo {
    path: string;
    fileStatus: FileStatus;
    hunk: GitHunk;
    side: EditorDiffSide;
    changelist?: ChangelistInfo;
    isDefaultChangelist: boolean;
    isActiveChangelist: boolean;
    mode: 'staged' | 'changes';
}

export interface EditorHunkDecoration extends EditorHunkInfo {
    startLine: number;
    endLine: number;
    label: string;
}

export interface EditorHunkMatchTarget extends EditorHunkInfo {
    matchingFiles: FileStatus[];
    targetLine: number;
}

function lineRangeDistance(lineStart: number, lineEnd: number, hunkStart: number, hunkEnd: number): number {
    if (lineEnd < hunkStart) {
        return hunkStart - lineEnd;
    }
    if (lineStart > hunkEnd) {
        return lineStart - hunkEnd;
    }
    return 0;
}

function scoreHunkLine(hunk: GitHunk, line: number, side: EditorDiffSide): number {
    const start = side === 'original' ? hunk.oldStart : hunk.newStart;
    const count = side === 'original' ? hunk.oldLineCount : hunk.newLineCount;
    const end = start + Math.max(0, count - 1);
    return lineRangeDistance(line, line, start, end);
}

export function findBestHunkMatch(
    fileStatuses: FileStatus[],
    line: number,
    side: EditorDiffSide
): { fileStatus: FileStatus; hunk: GitHunk } | undefined {
    let bestMatch: { fileStatus: FileStatus; hunk: GitHunk } | undefined;
    let bestScore = Number.MAX_SAFE_INTEGER;

    for (const fileStatus of fileStatuses) {
        for (const hunk of fileStatus.hunks || []) {
            const score = scoreHunkLine(hunk, line, side);
            if (score <= 1 && score < bestScore) {
                bestScore = score;
                bestMatch = { fileStatus, hunk };
            }
        }
    }

    return bestMatch;
}

export class EditorHunkResolver {
    private statusCache?: { status: FileStatus[]; time: number };

    constructor(
        private readonly gitService: GitService,
        private readonly changelistStateService: ChangelistStateService
    ) {}

    public invalidate(): void {
        this.statusCache = undefined;
    }

    public getDocumentTarget(document: vscode.TextDocument): EditorDocumentTarget | undefined {
        const workspaceRoot = this.gitService.getWorkspaceRoot();
        if (!workspaceRoot) {
            return undefined;
        }

        const uri = document.uri;
        let filePath = uri.fsPath;
        let side: EditorDiffSide = 'modified';

        if (uri.scheme === 'file') {
            // Worktree files use the modified side of HEAD-relative change blocks.
        } else if (uri.scheme === 'intelli-git-revision') {
            let ref: string;
            try {
                const query = uri.query ? JSON.parse(uri.query) : {};
                ref = query.ref || '';
            } catch {
                ref = '';
            }
            filePath = path.join(workspaceRoot, uri.path.startsWith('/') ? uri.path.substring(1) : uri.path);
            side = ref === 'HEAD' ? 'original' : 'modified';
        } else if (uri.scheme === 'git') {
            filePath = uri.path;
            side = uri.authority === 'HEAD' ? 'original' : 'modified';
        } else {
            return undefined;
        }

        if (!filePath.startsWith(workspaceRoot)) {
            return undefined;
        }

        const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
        if (!relativePath || relativePath.startsWith('..')) {
            return undefined;
        }

        return { relativePath, side };
    }

    public async resolveCurrent(editor: vscode.TextEditor): Promise<EditorHunkInfo | undefined> {
        return this.resolveAt(editor.document, editor.selection.active.line + 1);
    }

    public async resolveCurrentTarget(editor: vscode.TextEditor): Promise<EditorHunkMatchTarget | undefined> {
        return this.resolveTargetAt(editor.document, editor.selection.active.line + 1);
    }

    public async resolveAt(document: vscode.TextDocument, line: number): Promise<EditorHunkInfo | undefined> {
        const target = await this.resolveTargetAt(document, line);
        if (!target) {
            return undefined;
        }

        const { matchingFiles: _matchingFiles, targetLine: _targetLine, ...info } = target;
        return info;
    }

    public async resolveTargetAt(
        document: vscode.TextDocument,
        line: number
    ): Promise<EditorHunkMatchTarget | undefined> {
        const target = this.getDocumentTarget(document);
        if (!target || !this.isChangesMode()) {
            return undefined;
        }

        const status = await this.getStatus();
        const matchingFiles = await this.gitService.getFileStatusWithHunks(target.relativePath, status);
        const match = findBestHunkMatch(matchingFiles, line, target.side);

        if (!match) {
            return undefined;
        }

        return {
            ...this.createHunkInfo(target.relativePath, target.side, match.fileStatus, match.hunk),
            matchingFiles,
            targetLine: line,
        };
    }

    /** Change block labels only exist in changes mode, where blocks can belong to other changelists. */
    public async getDecorations(editor: vscode.TextEditor): Promise<EditorHunkDecoration[]> {
        const target = this.getDocumentTarget(editor.document);
        if (!target || !this.isChangesMode()) {
            return [];
        }

        const status = await this.getStatus();
        const matchingFiles = await this.gitService.getFileStatusWithHunks(target.relativePath, status);
        const result: EditorHunkDecoration[] = [];

        for (const fileStatus of matchingFiles) {
            for (const hunk of fileStatus.hunks || []) {
                const info = this.createHunkInfo(target.relativePath, target.side, fileStatus, hunk);
                if (!info.changelist || info.isActiveChangelist) {
                    continue;
                }

                const start = target.side === 'original' ? hunk.oldStart : hunk.newStart;
                const count = target.side === 'original' ? hunk.oldLineCount : hunk.newLineCount;
                const line = Math.min(Math.max(start, 1), editor.document.lineCount);
                const end = Math.min(Math.max(start + Math.max(count, 1) - 1, line), editor.document.lineCount);

                result.push({
                    ...info,
                    startLine: line,
                    endLine: end,
                    label: info.changelist.name,
                });
            }
        }

        return result;
    }

    private isChangesMode(): boolean {
        return this.changelistStateService.getState().mode === 'changes';
    }

    private async getStatus(): Promise<FileStatus[]> {
        const now = Date.now();
        if (this.statusCache && now - this.statusCache.time < 750) {
            return this.statusCache.status;
        }

        const status = await this.gitService.getStatus();
        this.changelistStateService.syncWithStatus(status);
        this.statusCache = { status, time: now };
        return status;
    }

    private createHunkInfo(path: string, side: EditorDiffSide, fileStatus: FileStatus, hunk: GitHunk): EditorHunkInfo {
        const state = this.changelistStateService.getState();
        const assignment = state.assignments[path];
        const listId = assignment?.hunkListIds?.[hunk.id] || assignment?.fileListId || state.activeListId;
        const changelist = state.lists.find((list) => list.id === listId);
        const isDefaultChangelist = !changelist || changelist.id === 'changes';
        const isActiveChangelist = listId === state.activeListId;

        return {
            path,
            fileStatus,
            hunk,
            side,
            changelist,
            isDefaultChangelist,
            isActiveChangelist,
            mode: state.mode,
        };
    }
}
