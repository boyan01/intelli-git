import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { isClickAtLineStart } from './GutterBlameController';

const document = {
    lineAt: (line: number) => ({ text: ['const a = 1;', ''][line] ?? '' }),
} as Pick<vscode.TextDocument, 'lineAt'>;

function selection(line: number, character: number, isEmpty = true): vscode.Selection {
    return { isEmpty, active: { line, character } } as vscode.Selection;
}

describe('isClickAtLineStart', () => {
    it('accepts a single empty selection at the start of a non-empty line', () => {
        expect(isClickAtLineStart(document, [selection(0, 0)])).toBe(true);
    });

    it('ignores clicks inside the code', () => {
        expect(isClickAtLineStart(document, [selection(0, 4)])).toBe(false);
    });

    it('ignores empty lines because any click on them lands on column 0', () => {
        expect(isClickAtLineStart(document, [selection(1, 0)])).toBe(false);
    });

    it('ignores selections and multiple cursors', () => {
        expect(isClickAtLineStart(document, [selection(0, 0, false)])).toBe(false);
        expect(isClickAtLineStart(document, [selection(0, 0), selection(0, 0)])).toBe(false);
    });
});
