import { GitHunk } from '@shared/messages';

interface ParseDiffOptions {
    idPrefix?: string;
}

interface ParsedDiffLine {
    text: string;
    type: 'context' | 'add' | 'delete' | 'marker';
    oldLine?: number;
    newLine?: number;
    oldBefore: number;
    newBefore: number;
}

interface ParsedHunkHeader {
    oldStart: number;
    oldLineCount: number;
    newStart: number;
    newLineCount: number;
}

function hashHunk(content: string): string {
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
        hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}

function createHunkId(filePath: string, hunk: Pick<GitHunk, 'oldStart' | 'oldLineCount' | 'newStart' | 'newLineCount'>, content: string, options?: ParseDiffOptions): string {
    const prefix = options?.idPrefix ? `${options.idPrefix}:` : '';
    return `${filePath}:${prefix}${hunk.oldStart}:${hunk.oldLineCount}:${hunk.newStart}:${hunk.newLineCount}:${hashHunk(content)}`;
}

function formatRange(start: number, count: number): string {
    return count === 1 ? `${start}` : `${start},${count}`;
}

function formatLineRange(oldStart: number, oldLineCount: number, newStart: number, newLineCount: number): string {
    const oldEnd = oldLineCount === 0 ? oldStart : oldStart + oldLineCount - 1;
    const newEnd = newLineCount === 0 ? newStart : newStart + newLineCount - 1;
    return `L${oldStart}-${oldEnd} / L${newStart}-${newEnd}`;
}

function normalizeDiffPath(value: string): string {
    if (value === '/dev/null') {
        return value;
    }

    let path = value.trim();
    if (path.startsWith('"') && path.endsWith('"')) {
        try {
            path = JSON.parse(path);
        } catch {
            path = path.slice(1, -1);
        }
    }

    if (path.startsWith('a/') || path.startsWith('b/')) {
        return path.slice(2);
    }

    return path;
}

function extractHeaderPath(fileHeader: string[]): string | undefined {
    let deletedPath: string | undefined;

    for (const line of fileHeader) {
        if (line.startsWith('--- ')) {
            const path = normalizeDiffPath(line.slice(4));
            if (path !== '/dev/null') {
                deletedPath = path;
            }
            continue;
        }

        if (line.startsWith('+++ ')) {
            const path = normalizeDiffPath(line.slice(4));
            if (path !== '/dev/null') {
                return path;
            }
        }
    }

    return deletedPath;
}

function parseHunkLines(header: ParsedHunkHeader, hunkLines: string[]): ParsedDiffLine[] {
    const bodyLines = hunkLines.slice(1);
    const result: ParsedDiffLine[] = [];
    let oldLine = header.oldStart;
    let newLine = header.newStart;

    for (const text of bodyLines) {
        const oldBefore = oldLine;
        const newBefore = newLine;

        if (text.startsWith(' ')) {
            result.push({ text, type: 'context', oldLine, newLine, oldBefore, newBefore });
            oldLine++;
            newLine++;
            continue;
        }

        if (text.startsWith('-')) {
            result.push({ text, type: 'delete', oldLine, oldBefore, newBefore });
            oldLine++;
            continue;
        }

        if (text.startsWith('+')) {
            result.push({ text, type: 'add', newLine, oldBefore, newBefore });
            newLine++;
            continue;
        }

        result.push({ text, type: 'marker', oldBefore, newBefore });
    }

    return result;
}

function isChangeLine(line: ParsedDiffLine): boolean {
    return line.type === 'add' || line.type === 'delete';
}

function buildChangeBlock(
    filePath: string,
    fileHeader: string,
    lines: ParsedDiffLine[],
    changeStart: number,
    changeEnd: number,
    options?: ParseDiffOptions
): GitHunk {
    let includeStart = changeStart;
    let includeEnd = changeEnd;

    if (includeStart > 0 && lines[includeStart - 1].type === 'context') {
        includeStart--;
    }

    if (includeEnd + 1 < lines.length && lines[includeEnd + 1].type === 'context') {
        includeEnd++;
    }

    while (includeEnd + 1 < lines.length && lines[includeEnd + 1].type === 'marker') {
        includeEnd++;
    }

    const includedLines = lines.slice(includeStart, includeEnd + 1);
    const oldLines = includedLines.filter(line => line.type === 'context' || line.type === 'delete');
    const newLines = includedLines.filter(line => line.type === 'context' || line.type === 'add');
    const firstIncluded = includedLines[0];
    const patchOldStart = oldLines[0]?.oldLine ?? firstIncluded.oldBefore;
    const patchNewStart = newLines[0]?.newLine ?? firstIncluded.newBefore;
    const patchOldLineCount = oldLines.length;
    const patchNewLineCount = newLines.length;
    const patchHeader = `@@ -${formatRange(patchOldStart, patchOldLineCount)} +${formatRange(patchNewStart, patchNewLineCount)} @@`;
    const content = [patchHeader, ...includedLines.map(line => line.text)].join('\n');

    const changedLines = lines.slice(changeStart, changeEnd + 1);
    const deletedLines = changedLines.filter(line => line.type === 'delete');
    const addedLines = changedLines.filter(line => line.type === 'add');
    const firstChanged = changedLines[0];
    const oldStart = deletedLines[0]?.oldLine ?? firstChanged.oldBefore;
    const newStart = addedLines[0]?.newLine ?? firstChanged.newBefore;
    const oldLineCount = deletedLines.length;
    const newLineCount = addedLines.length;
    const block: GitHunk = {
        id: '',
        lineRange: formatLineRange(oldStart, oldLineCount, newStart, newLineCount),
        fileHeader,
        content,
        oldStart,
        oldLineCount,
        newStart,
        newLineCount
    };
    block.id = createHunkId(filePath, block, content, options);
    return block;
}

function splitHunkIntoChangeBlocks(
    hunks: GitHunk[],
    currentHunk: Partial<GitHunk> | null,
    hunkLines: string[],
    filePath: string,
    options?: ParseDiffOptions
) {
    if (!currentHunk || hunkLines.length === 0) {
        return;
    }

    const parsedLines = parseHunkLines(currentHunk as ParsedHunkHeader, hunkLines);
    let changeStart: number | null = null;

    for (let i = 0; i < parsedLines.length; i++) {
        if (isChangeLine(parsedLines[i])) {
            changeStart = changeStart ?? i;
            continue;
        }

        if (changeStart !== null) {
            hunks.push(buildChangeBlock(filePath, currentHunk.fileHeader || '', parsedLines, changeStart, i - 1, options));
            changeStart = null;
        }
    }

    if (changeStart !== null) {
        hunks.push(buildChangeBlock(filePath, currentHunk.fileHeader || '', parsedLines, changeStart, parsedLines.length - 1, options));
    }
}

/**
 * Parses a git diff output into an array of GitHunk objects.
 */
export function parseDiffToHunks(diffText: string, filePath: string, options?: ParseDiffOptions): GitHunk[] {
    const hunks: GitHunk[] = [];
    const lines = diffText.split('\n');
    let currentHunk: Partial<GitHunk> | null = null;
    let currentFileHeader: string[] = [];
    let hunkLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('diff --git ')) {
            currentFileHeader = [line];
            continue;
        }

        const hunkHeaderMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);

        if (hunkHeaderMatch) {
            splitHunkIntoChangeBlocks(hunks, currentHunk, hunkLines, filePath, options);

            const oldStart = parseInt(hunkHeaderMatch[1], 10);
            const oldLineCount = parseInt(hunkHeaderMatch[2] || '1', 10);
            const newStart = parseInt(hunkHeaderMatch[3], 10);
            const newLineCount = parseInt(hunkHeaderMatch[4] || '1', 10);

            currentHunk = {
                lineRange: formatLineRange(oldStart, oldLineCount, newStart, newLineCount),
                fileHeader: currentFileHeader.join('\n'),
                oldStart,
                oldLineCount,
                newStart,
                newLineCount
            };
            hunkLines = [line];
        } else if (currentHunk) {
            // Collect hunk content lines
            if (!line.startsWith('diff --git ')) {
                hunkLines.push(line);
            }
        } else {
            currentFileHeader.push(line);
        }
    }

    // Push the last hunk
    splitHunkIntoChangeBlocks(hunks, currentHunk, hunkLines, filePath, options);

    return hunks;
}

/**
 * Parses a multi-file git diff into hunks keyed by workspace-relative file path.
 */
export function parseDiffToFileHunks(
    diffText: string,
    mapRepoPath: (repoPath: string) => string | null,
    options?: ParseDiffOptions
): Map<string, GitHunk[]> {
    const result = new Map<string, GitHunk[]>();
    const lines = diffText.split('\n');
    let currentFileHeader: string[] = [];
    let currentFilePath: string | null = null;
    let currentHunk: Partial<GitHunk> | null = null;
    let hunkLines: string[] = [];

    const flushHunk = () => {
        if (!currentFilePath) {
            return;
        }

        const hunks = result.get(currentFilePath) || [];
        splitHunkIntoChangeBlocks(hunks, currentHunk, hunkLines, currentFilePath, options);
        if (hunks.length > 0) {
            result.set(currentFilePath, hunks);
        }
        currentHunk = null;
        hunkLines = [];
    };

    for (const line of lines) {
        if (line.startsWith('diff --git ')) {
            flushHunk();
            currentFileHeader = [line];
            currentFilePath = null;
            continue;
        }

        const hunkHeaderMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (hunkHeaderMatch) {
            flushHunk();

            const repoPath = extractHeaderPath(currentFileHeader);
            currentFilePath = repoPath ? mapRepoPath(repoPath) : null;
            if (!currentFilePath) {
                continue;
            }

            const oldStart = parseInt(hunkHeaderMatch[1], 10);
            const oldLineCount = parseInt(hunkHeaderMatch[2] || '1', 10);
            const newStart = parseInt(hunkHeaderMatch[3], 10);
            const newLineCount = parseInt(hunkHeaderMatch[4] || '1', 10);

            currentHunk = {
                lineRange: formatLineRange(oldStart, oldLineCount, newStart, newLineCount),
                fileHeader: currentFileHeader.join('\n'),
                oldStart,
                oldLineCount,
                newStart,
                newLineCount
            };
            hunkLines = [line];
            continue;
        }

        if (currentHunk) {
            hunkLines.push(line);
        } else {
            currentFileHeader.push(line);
        }
    }

    flushHunk();
    return result;
}
