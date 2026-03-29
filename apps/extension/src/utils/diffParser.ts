import { GitHunk } from '@shared/messages';

/**
 * Parses a git diff output into an array of GitHunk objects.
 */
export function parseDiffToHunks(diffText: string, filePath: string): GitHunk[] {
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
            // Save previous hunk if exists
            if (currentHunk && hunkLines.length > 0) {
                currentHunk.content = hunkLines.join('\n');
                hunks.push(currentHunk as GitHunk);
            }

            const oldStart = parseInt(hunkHeaderMatch[1], 10);
            const oldLineCount = parseInt(hunkHeaderMatch[2] || '1', 10);
            const newStart = parseInt(hunkHeaderMatch[3], 10);
            const newLineCount = parseInt(hunkHeaderMatch[4] || '1', 10);

            currentHunk = {
                id: `${filePath}:${oldStart}:${newStart}`,
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
    if (currentHunk && hunkLines.length > 0) {
        currentHunk.content = hunkLines.join('\n');
        hunks.push(currentHunk as GitHunk);
    }

    return hunks;
}
