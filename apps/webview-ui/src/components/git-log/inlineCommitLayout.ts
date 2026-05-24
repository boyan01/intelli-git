import type { CommitDetails, CommitFile } from '@shared/messages';

const INLINE_LOADING_HEIGHT = 34;
const INLINE_BODY_LINE_HEIGHT = 17;
const INLINE_META_HEIGHT = 17;
const INLINE_FILES_HEIGHT = 18;
const INLINE_VERTICAL_PADDING = 5;
const INLINE_SECTION_GAP = 2;
const INLINE_MAX_BODY_LINES = 3;
const INLINE_WRAP_COLUMN = 88;
const INLINE_FILE_LIMIT = 3;

export interface InlineFileSummary {
    visibleFiles: string[];
    moreCount: number;
    totalCount: number;
}

function estimateWrappedLineCount(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;

    return trimmed
        .split(/\r?\n/)
        .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / INLINE_WRAP_COLUMN)), 0);
}

export function getInlineFileSummary(files: CommitFile[], limit = INLINE_FILE_LIMIT): InlineFileSummary {
    const visibleFiles = files
        .slice(0, limit)
        .map(file => file.displayPath || file.path);

    return {
        visibleFiles,
        moreCount: Math.max(0, files.length - visibleFiles.length),
        totalCount: files.length
    };
}

export function getInlineDetailsHeight(commit?: Pick<CommitDetails, 'body' | 'files'>): number {
    if (!commit) {
        return INLINE_LOADING_HEIGHT;
    }

    const bodyLines = Math.min(INLINE_MAX_BODY_LINES, estimateWrappedLineCount(commit.body));
    const bodyHeight = bodyLines > 0 ? bodyLines * INLINE_BODY_LINE_HEIGHT : 0;
    const filesHeight = commit.files.length > 0 ? INLINE_FILES_HEIGHT : 0;
    const sectionCount = 1 + (bodyHeight > 0 ? 1 : 0) + (filesHeight > 0 ? 1 : 0);
    const gapHeight = Math.max(0, sectionCount - 1) * INLINE_SECTION_GAP;

    return INLINE_VERTICAL_PADDING + bodyHeight + INLINE_META_HEIGHT + filesHeight + gapHeight + INLINE_VERTICAL_PADDING;
}
