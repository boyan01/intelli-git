import { GitHunk } from '@shared/messages';

interface ParseDiffOptions {
    idPrefix?: string;
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

function finalizeHunk(
    hunks: GitHunk[],
    currentHunk: Partial<GitHunk> | null,
    hunkLines: string[],
    filePath: string,
    options?: ParseDiffOptions
) {
    if (!currentHunk || hunkLines.length === 0) {
        return;
    }

    const content = hunkLines.join('\n');
    currentHunk.content = content;
    currentHunk.id = createHunkId(filePath, currentHunk as GitHunk, content, options);
    hunks.push(currentHunk as GitHunk);
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
            finalizeHunk(hunks, currentHunk, hunkLines, filePath, options);

            const oldStart = parseInt(hunkHeaderMatch[1], 10);
            const oldLineCount = parseInt(hunkHeaderMatch[2] || '1', 10);
            const newStart = parseInt(hunkHeaderMatch[3], 10);
            const newLineCount = parseInt(hunkHeaderMatch[4] || '1', 10);

            currentHunk = {
                lineRange: `L${oldStart}-${oldStart + oldLineCount - 1} / L${newStart}-${newStart + newLineCount - 1}`,
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
    finalizeHunk(hunks, currentHunk, hunkLines, filePath, options);

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
        finalizeHunk(hunks, currentHunk, hunkLines, currentFilePath, options);
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
                lineRange: `L${oldStart}-${oldStart + oldLineCount - 1} / L${newStart}-${newStart + newLineCount - 1}`,
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
