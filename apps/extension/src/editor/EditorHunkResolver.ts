import * as path from 'path';
import * as vscode from 'vscode';
import type { ChangelistInfo, FileStatus, GitHunk } from '@shared/messages';
import { GitService } from '../services/GitService';
import { ChangelistStateService } from '../services/ChangelistStateService';
import { InactiveChangesService } from '../services/InactiveChangesService';
import { i18n } from '../utils/i18n';

export type EditorDiffSide = 'original' | 'modified';

export interface EditorDocumentTarget {
    relativePath: string;
    side: EditorDiffSide;
    preferStaged?: boolean;
}

export interface EditorHunkInfo {
    path: string;
    fileStatus: FileStatus;
    hunk: GitHunk;
    side: EditorDiffSide;
    inactive: boolean;
    changelist?: ChangelistInfo;
    isDefaultChangelist: boolean;
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

interface LineChangeLike {
    originalStartLineNumber: number;
    originalEndLineNumber: number;
    modifiedStartLineNumber: number;
    modifiedEndLineNumber: number;
}

function normalizeLineRange(start: number, end: number): [number, number] {
    const normalizedStart = start <= 0 ? 1 : start;
    const normalizedEnd = end <= 0 ? normalizedStart : end;
    return [normalizedStart, Math.max(normalizedStart, normalizedEnd)];
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

function scoreHunkLineChange(hunk: GitHunk, lineChange: LineChangeLike | undefined, fallbackLine: number): number {
    const oldEnd = hunk.oldStart + Math.max(0, hunk.oldLineCount - 1);
    const newEnd = hunk.newStart + Math.max(0, hunk.newLineCount - 1);

    if (!lineChange) {
        return Math.min(
            lineRangeDistance(fallbackLine, fallbackLine, hunk.oldStart, oldEnd),
            lineRangeDistance(fallbackLine, fallbackLine, hunk.newStart, newEnd)
        );
    }

    const [oldStart, oldLineEnd] = normalizeLineRange(lineChange.originalStartLineNumber, lineChange.originalEndLineNumber);
    const [newStart, newLineEnd] = normalizeLineRange(lineChange.modifiedStartLineNumber, lineChange.modifiedEndLineNumber);

    return Math.min(
        lineRangeDistance(oldStart, oldLineEnd, hunk.oldStart, oldEnd),
        lineRangeDistance(newStart, newLineEnd, hunk.newStart, newEnd)
    );
}

function scoreHunkLine(hunk: GitHunk, line: number, side: EditorDiffSide): number {
    const start = side === 'original' ? hunk.oldStart : hunk.newStart;
    const count = side === 'original' ? hunk.oldLineCount : hunk.newLineCount;
    const end = start + Math.max(0, count - 1);
    return lineRangeDistance(line, line, start, end);
}

export function findBestHunkMatch(
    fileStatuses: FileStatus[],
    lineChange: LineChangeLike | undefined,
    fallbackLine: number,
    preferStaged?: boolean,
    side?: EditorDiffSide
): { fileStatus: FileStatus; hunk: GitHunk } | undefined {
    let bestMatch: { fileStatus: FileStatus; hunk: GitHunk } | undefined;
    let bestScore = Number.MAX_SAFE_INTEGER;

    for (const fileStatus of fileStatuses) {
        for (const hunk of fileStatus.hunks || []) {
            const score = side ? scoreHunkLine(hunk, fallbackLine, side) : scoreHunkLineChange(hunk, lineChange, fallbackLine);
            if (score > 1) {
                continue;
            }

            if (
                score < bestScore ||
                (
                    score === bestScore &&
                    preferStaged !== undefined &&
                    fileStatus.staged === preferStaged &&
                    bestMatch?.fileStatus.staged !== preferStaged
                )
            ) {
                bestScore = score;
                bestMatch = { fileStatus, hunk };
            }
        }
    }

    return bestMatch;
}

function toWorktreeHunkId(hunkId: string): string {
    return hunkId.replace(':index:', ':worktree:');
}

export class EditorHunkResolver {
    private statusCache?: { status: FileStatus[]; time: number };

    constructor(
        private readonly gitService: GitService,
        private readonly inactiveChangesService: InactiveChangesService,
        private readonly changelistStateService: ChangelistStateService
    ) { }

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
        let preferStaged: boolean | undefined = false;

        if (uri.scheme === 'file') {
            preferStaged = false;
        } else if (uri.scheme === 'intelli-git-revision') {
            let ref = '';
            try {
                const query = uri.query ? JSON.parse(uri.query) : {};
                ref = query.ref || '';
            } catch {
                ref = '';
            }
            filePath = path.join(workspaceRoot, uri.path.startsWith('/') ? uri.path.substring(1) : uri.path);
            side = ref === 'HEAD' ? 'original' : 'modified';
            preferStaged = true;
        } else if (uri.scheme === 'git') {
            filePath = uri.path;
            preferStaged = uri.authority === 'index';
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

        return { relativePath, side, preferStaged };
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

    public async resolveTargetAt(document: vscode.TextDocument, line: number): Promise<EditorHunkMatchTarget | undefined> {
        const target = this.getDocumentTarget(document);
        if (!target) {
            return undefined;
        }

        const status = await this.getStatus();
        const matchingFiles = status.filter(file => file.path === target.relativePath);
        const match = findBestHunkMatch(
            matchingFiles,
            undefined,
            line,
            target.preferStaged,
            target.side
        );

        if (!match) {
            return undefined;
        }

        return {
            ...this.createHunkInfo(target.relativePath, target.side, match.fileStatus, match.hunk),
            matchingFiles,
            targetLine: line
        };
    }

    public async getDecorations(editor: vscode.TextEditor, options: { showDefaultStagedBlocks?: boolean } = {}): Promise<EditorHunkDecoration[]> {
        const target = this.getDocumentTarget(editor.document);
        if (!target) {
            return [];
        }

        const status = await this.getStatus();
        const matchingFiles = status.filter(file => file.path === target.relativePath);
        const result: EditorHunkDecoration[] = [];

        for (const fileStatus of matchingFiles) {
            if (target.preferStaged !== undefined && fileStatus.staged !== target.preferStaged) {
                continue;
            }

            for (const hunk of fileStatus.hunks || []) {
                const info = this.createHunkInfo(target.relativePath, target.side, fileStatus, hunk);
                const label = this.getDecorationLabel(info, options);
                if (!label) {
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
                    label
                });
            }
        }

        return result;
    }

    private async getStatus(): Promise<FileStatus[]> {
        const now = Date.now();
        if (this.statusCache && now - this.statusCache.time < 750) {
            return this.statusCache.status;
        }

        const status = await this.gitService.getStatus();
        this.inactiveChangesService.syncWithStatus(status);
        this.changelistStateService.syncWithStatus(status);
        this.statusCache = { status, time: now };
        return status;
    }

    private createHunkInfo(path: string, side: EditorDiffSide, fileStatus: FileStatus, hunk: GitHunk): EditorHunkInfo {
        const state = this.changelistStateService.getState();
        const assignment = state.assignments[path];
        const worktreeHunkId = toWorktreeHunkId(hunk.id);
        const inactiveHunkIds = new Set(fileStatus.inactiveHunkIds || this.inactiveChangesService.getInactiveHunkIds(path));
        const inactive = !!fileStatus.inactive || inactiveHunkIds.has(hunk.id) || inactiveHunkIds.has(worktreeHunkId);
        const listId = assignment?.hunkListIds?.[hunk.id] || assignment?.hunkListIds?.[worktreeHunkId] || assignment?.fileListId || state.activeListId;
        const changelist = state.lists.find(list => list.id === listId);
        const isDefaultChangelist = !changelist || changelist.id === 'changes';

        return {
            path,
            fileStatus,
            hunk,
            side,
            inactive,
            changelist,
            isDefaultChangelist,
            mode: state.mode
        };
    }

    private getDecorationLabel(info: EditorHunkInfo, options: { showDefaultStagedBlocks?: boolean }): string | undefined {
        if (info.mode === 'staged') {
            if (info.inactive && info.fileStatus.staged) {
                return `${i18n.t('Staged')} · ${i18n.t('Inactive')}`;
            }
            if (info.inactive) {
                return i18n.t('Inactive');
            }
            if (info.fileStatus.staged) {
                return i18n.t('Staged');
            }
            if (options.showDefaultStagedBlocks) {
                return i18n.t('Unstaged');
            }
            return undefined;
        }

        if (info.inactive) {
            return i18n.t('Inactive');
        }

        if (info.changelist && !info.isDefaultChangelist) {
            return info.changelist.name;
        }

        return undefined;
    }
}
