import type { GitHunk } from '@shared/messages';

export function createHunk(id: string, oldStart: number, newStart: number, oldLineCount = 3, newLineCount = 3): GitHunk {
    return {
        id,
        lineRange: `L${oldStart}-${oldStart + oldLineCount - 1} / L${newStart}-${newStart + newLineCount - 1}`,
        fileHeader: `diff --git a/example.ts b/example.ts`,
        content: `@@ -${oldStart},${oldLineCount} +${newStart},${newLineCount} @@\n-old\n+new`,
        oldStart,
        oldLineCount,
        newStart,
        newLineCount
    };
}
