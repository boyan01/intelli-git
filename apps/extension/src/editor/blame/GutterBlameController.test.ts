import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { findAddedLineStartCursor } from './GutterBlameController';

const document = {
    lineAt: (line: number) => ({ text: ['const a = 1;', '', 'const b = 2;'][line] ?? '' }),
} as Pick<vscode.TextDocument, 'lineAt'>;

function selection(line: number, character: number, isEmpty = true): vscode.Selection {
    const result = {
        isEmpty,
        active: { line, character },
        isEqual: (other: vscode.Selection) =>
            other.isEmpty === isEmpty && other.active.line === line && other.active.character === character,
    };
    return result as unknown as vscode.Selection;
}

describe('findAddedLineStartCursor', () => {
    it('returns the cursor a modifier click added at the start of a non-empty line', () => {
        const added = selection(2, 0);
        expect(findAddedLineStartCursor(document, [selection(0, 4)], [selection(0, 4), added])).toBe(added);
        expect(findAddedLineStartCursor(document, [selection(0, 4)], [added, selection(0, 4)])).toBe(added);
    });

    it('ignores plain clicks that only move the cursor', () => {
        expect(findAddedLineStartCursor(document, [selection(0, 4)], [selection(2, 0)])).toBeUndefined();
    });

    it('ignores cursors added inside the code', () => {
        expect(
            findAddedLineStartCursor(document, [selection(0, 4)], [selection(0, 4), selection(2, 3)])
        ).toBeUndefined();
    });

    it('ignores empty lines because any click on them lands on column 0', () => {
        expect(
            findAddedLineStartCursor(document, [selection(0, 4)], [selection(0, 4), selection(1, 0)])
        ).toBeUndefined();
    });

    it('ignores added selections and changes that replace existing cursors', () => {
        expect(
            findAddedLineStartCursor(document, [selection(0, 4)], [selection(0, 4), selection(2, 0, false)])
        ).toBeUndefined();
        expect(
            findAddedLineStartCursor(document, [selection(0, 4)], [selection(0, 5), selection(2, 0)])
        ).toBeUndefined();
        expect(findAddedLineStartCursor(document, [], [selection(2, 0)])).toBeUndefined();
    });
});
