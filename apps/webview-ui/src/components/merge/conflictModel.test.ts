import { describe, expect, it } from 'vitest';
import {
    applyConflictBlockResolution,
    buildInlineDiffSegments,
    buildThreeWayMergeDocument,
    buildThreeWayMergeDocumentFromSides,
    buildThreeWayMergePaneDocument,
    buildThreeWayMergeResult,
    buildConflictDocumentResult,
    getConflictBaseText,
    getConflictResolutionText,
    getUnresolvedConflictIds,
    getUnresolvedThreeWayConflictIds,
    hasConflictBlocks,
    parseConflictDocument,
    parseConflictBlocks
} from './conflictModel';

describe('conflictModel', () => {
    it('builds inline diff segments for changed words while preserving unchanged tokens', () => {
        expect(buildInlineDiffSegments('const value = 2;\n', 'const value = 1;\n')).toEqual([
            { text: 'const value = ', changed: false },
            { text: '2', changed: true },
            { text: ';\n', changed: false }
        ]);
    });

    it('builds inline diff segments for inserted words', () => {
        expect(buildInlineDiffSegments('return final result;\n', 'return result;\n')).toEqual([
            { text: 'return ', changed: false },
            { text: 'final ', changed: true },
            { text: 'result;\n', changed: false }
        ]);
    });

    it('keeps unchanged inline diff text as one segment', () => {
        expect(buildInlineDiffSegments('same line\n', 'same line\n')).toEqual([
            { text: 'same line\n', changed: false }
        ]);
    });

    it('parses standard Git conflict markers', () => {
        const content = [
            'before\n',
            '<<<<<<< HEAD\n',
            'current line\n',
            '=======\n',
            'incoming line\n',
            '>>>>>>> feature\n',
            'after\n'
        ].join('');

        const blocks = parseConflictBlocks(content);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({
            id: 'conflict-0',
            startLine: 2,
            endLine: 6,
            currentLabel: 'HEAD',
            incomingLabel: 'feature',
            currentText: 'current line\n',
            incomingText: 'incoming line\n',
            baseText: ''
        });
        expect(blocks[0].markerText).toBe([
            '<<<<<<< HEAD\n',
            'current line\n',
            '=======\n',
            'incoming line\n',
            '>>>>>>> feature\n'
        ].join(''));
    });

    it('parses diff3 base markers', () => {
        const content = [
            '<<<<<<< ours\n',
            'current line\n',
            '||||||| base\n',
            'base line\n',
            '=======\n',
            'incoming line\n',
            '>>>>>>> theirs\n'
        ].join('');

        const [block] = parseConflictBlocks(content);

        expect(block).toMatchObject({
            currentLabel: 'ours',
            baseLabel: 'base',
            incomingLabel: 'theirs',
            currentText: 'current line\n',
            baseText: 'base line\n',
            incomingText: 'incoming line\n'
        });
    });

    it('preserves CRLF content while applying block resolutions', () => {
        const content = 'a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> branch\r\nz\r\n';

        expect(applyConflictBlockResolution(content, 'conflict-0', 'incoming')).toBe('a\r\ntheirs\r\nz\r\n');
    });

    it('applies base, current, incoming, and both choices to a single block', () => {
        const content = [
            'before\n',
            '<<<<<<< HEAD\n',
            'ours\n',
            '||||||| base\n',
            'base\n',
            '=======\n',
            'theirs\n',
            '>>>>>>> branch\n',
            'after\n'
        ].join('');

        expect(applyConflictBlockResolution(content, 'conflict-0', 'base')).toBe('before\nbase\nafter\n');
        expect(applyConflictBlockResolution(content, 'conflict-0', 'current')).toBe('before\nours\nafter\n');
        expect(applyConflictBlockResolution(content, 'conflict-0', 'incoming')).toBe('before\ntheirs\nafter\n');
        expect(applyConflictBlockResolution(content, 'conflict-0', 'both')).toBe('before\nours\ntheirs\nafter\n');
    });

    it('updates block ids after resolving earlier conflicts', () => {
        const content = [
            '<<<<<<< HEAD\n',
            'ours 1\n',
            '=======\n',
            'theirs 1\n',
            '>>>>>>> branch\n',
            'middle\n',
            '<<<<<<< HEAD\n',
            'ours 2\n',
            '=======\n',
            'theirs 2\n',
            '>>>>>>> branch\n'
        ].join('');

        const next = applyConflictBlockResolution(content, 'conflict-0', 'current');

        expect(parseConflictBlocks(next)).toHaveLength(1);
        expect(parseConflictBlocks(next)[0].currentText).toBe('ours 2\n');
    });

    it('detects whether unresolved blocks remain', () => {
        expect(hasConflictBlocks('clean\n')).toBe(false);
        expect(hasConflictBlocks('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n')).toBe(true);
    });

    it('splits a conflicted file into preserved text and conflict parts', () => {
        const content = [
            'before\n',
            '<<<<<<< HEAD\n',
            'ours\n',
            '=======\n',
            'theirs\n',
            '>>>>>>> branch\n',
            'after\n'
        ].join('');

        const parts = parseConflictDocument(content);

        expect(parts).toHaveLength(3);
        expect(parts[0]).toMatchObject({ type: 'text', text: 'before\n' });
        expect(parts[1]).toMatchObject({ type: 'conflict', id: 'conflict-0' });
        expect(parts[2]).toMatchObject({ type: 'text', text: 'after\n' });
    });

    it('infers conflict base text from the full base file when markers do not include a base section', () => {
        const content = [
            'before\n',
            '<<<<<<< HEAD\n',
            'ours 1\n',
            '=======\n',
            'theirs 1\n',
            '>>>>>>> branch\n',
            'middle\n',
            '<<<<<<< HEAD\n',
            'ours 2\n',
            '=======\n',
            'theirs 2\n',
            '>>>>>>> branch\n',
            'after\n'
        ].join('');
        const base = [
            'before\n',
            'base 1\n',
            'middle\n',
            'base 2\n',
            'after\n'
        ].join('');

        const conflictParts = parseConflictDocument(content, base)
            .filter((part): part is Extract<ReturnType<typeof parseConflictDocument>[number], { type: 'conflict' }> => part.type === 'conflict');

        expect(conflictParts).toHaveLength(2);
        expect(getConflictBaseText(conflictParts[0].block)).toBe('base 1\n');
        expect(getConflictBaseText(conflictParts[1].block)).toBe('base 2\n');
    });

    it('reconstructs a marker-free result from explicit conflict resolutions', () => {
        const content = [
            'before\n',
            '<<<<<<< HEAD\n',
            'ours\n',
            '=======\n',
            'theirs\n',
            '>>>>>>> branch\n',
            'after\n'
        ].join('');
        const parts = parseConflictDocument(content);
        const conflictPart = parts.find(part => part.type === 'conflict');
        if (!conflictPart || conflictPart.type !== 'conflict') {
            throw new Error('Expected a conflict part');
        }

        const result = buildConflictDocumentResult(parts, {
            [conflictPart.id]: getConflictResolutionText(conflictPart.block, 'incoming')
        });

        expect(result).toBe('before\ntheirs\nafter\n');
        expect(hasConflictBlocks(result)).toBe(false);
    });

    it('treats an empty resolution as explicit and resolved', () => {
        const content = [
            'before\n',
            '<<<<<<< HEAD\n',
            'ours\n',
            '=======\n',
            'theirs\n',
            '>>>>>>> branch\n',
            'after\n'
        ].join('');
        const parts = parseConflictDocument(content);

        expect(getUnresolvedConflictIds(parts, {})).toEqual(['conflict-0']);
        expect(getUnresolvedConflictIds(parts, { 'conflict-0': '' })).toEqual([]);
        expect(buildConflictDocumentResult(parts, { 'conflict-0': '' })).toBe('before\nafter\n');
    });

    it('keeps unresolved conflict marker text while previewing a partial result', () => {
        const content = [
            '<<<<<<< HEAD\n',
            'ours 1\n',
            '=======\n',
            'theirs 1\n',
            '>>>>>>> branch\n',
            'middle\n',
            '<<<<<<< HEAD\n',
            'ours 2\n',
            '=======\n',
            'theirs 2\n',
            '>>>>>>> branch\n'
        ].join('');
        const parts = parseConflictDocument(content);

        const partial = buildConflictDocumentResult(parts, { 'conflict-0': 'resolved 1\n' });

        expect(partial).toContain('resolved 1\n');
        expect(partial).toContain('<<<<<<< HEAD\n');
        expect(getUnresolvedConflictIds(parts, { 'conflict-0': 'resolved 1\n' })).toEqual(['conflict-1']);
    });

    it('builds a three-way document by applying non-overlapping changes automatically', () => {
        const base = [
            'one\n',
            'two\n',
            'three\n'
        ].join('');
        const current = [
            'one changed\n',
            'two\n',
            'three\n'
        ].join('');
        const incoming = [
            'one\n',
            'two\n',
            'three changed\n'
        ].join('');

        const parts = buildThreeWayMergeDocument(base, current, incoming);

        expect(parts.every(part => part.type === 'text')).toBe(true);
        expect(buildThreeWayMergeResult(parts, {})).toBe([
            'one changed\n',
            'two\n',
            'three changed\n'
        ].join(''));
        expect(buildThreeWayMergeResult(parts, {}, 'current')).toBe([
            'one changed\n',
            'two\n',
            'three\n'
        ].join(''));
        expect(buildThreeWayMergeResult(parts, {}, 'incoming')).toBe([
            'one\n',
            'two\n',
            'three changed\n'
        ].join(''));
    });

    it('creates a conflict when both sides change the same base range differently', () => {
        const base = [
            'one\n',
            'base\n',
            'three\n'
        ].join('');
        const current = [
            'one\n',
            'ours\n',
            'three\n'
        ].join('');
        const incoming = [
            'one\n',
            'theirs\n',
            'three\n'
        ].join('');

        const parts = buildThreeWayMergeDocument(base, current, incoming);
        const conflict = parts.find(part => part.type === 'conflict');

        expect(conflict).toMatchObject({
            type: 'conflict',
            id: 'conflict-0',
            baseText: 'base\n',
            currentText: 'ours\n',
            incomingText: 'theirs\n'
        });
        expect(getUnresolvedThreeWayConflictIds(parts, {})).toEqual(['conflict-0']);
        expect(buildThreeWayMergeResult(parts, {})).toBe(base);
        expect(buildThreeWayMergeResult(parts, { 'conflict-0': 'resolved\n' })).toBe('one\nresolved\nthree\n');
    });

    it('projects three-way parts into left, result, and right pane text', () => {
        const parts = buildThreeWayMergeDocument(
            'one\nbase\nthree\n',
            'one\nours\nthree\n',
            'one\ntheirs\nthree\n'
        );

        const paneDocument = buildThreeWayMergePaneDocument(parts, { 'conflict-0': 'resolved\n' });

        expect(paneDocument).toEqual({
            leftText: 'one\nours\nthree\n',
            resultText: 'one\nresolved\nthree\n',
            rightText: 'one\ntheirs\nthree\n',
            leftConflictRanges: [{
                id: 'conflict-0',
                startLine: 2,
                endLine: 2
            }],
            resultConflictRanges: [{
                id: 'conflict-0',
                startLine: 2,
                endLine: 2
            }],
            rightConflictRanges: [{
                id: 'conflict-0',
                startLine: 2,
                endLine: 2
            }]
        });
    });

    it('tracks conflict ranges independently for each merge pane with correct line alignment', () => {
        const parts = buildThreeWayMergeDocument(
            'one\nbase\nthree\n',
            'one\nours-a\nours-b\nthree\n',
            'one\ntheirs\nthree\n'
        );

        const paneDocument = buildThreeWayMergePaneDocument(parts, { 'conflict-0': 'resolved\n' });

        // Left has ours-a and ours-b (2 lines)
        // Result resolved is 1 line, padded to 2 lines with \u200B
        // Right theirs is 1 line, padded to 2 lines with \u200B
        expect(paneDocument.leftText).toBe('one\nours-a\nours-b\nthree\n');
        expect(paneDocument.resultText).toBe('one\nresolved\n\u200B\nthree\n');
        expect(paneDocument.rightText).toBe('one\ntheirs\n\u200B\nthree\n');

        expect(paneDocument.leftConflictRanges).toEqual([{
            id: 'conflict-0',
            startLine: 2,
            endLine: 3
        }]);
        expect(paneDocument.resultConflictRanges).toEqual([{
            id: 'conflict-0',
            startLine: 2,
            endLine: 3
        }]);
        expect(paneDocument.rightConflictRanges).toEqual([{
            id: 'conflict-0',
            startLine: 2,
            endLine: 3
        }]);
    });

    it('keeps separated overlapping edits as independent conflict blocks', () => {
        const base = [
            'header\n',
            'base-first\n',
            'context-a\n',
            'context-b\n',
            'context-c\n',
            'context-d\n',
            'context-e\n',
            'base-second\n',
            'footer\n'
        ].join('');
        const current = [
            'header\n',
            'main-first\n',
            'context-a\n',
            'context-b\n',
            'context-c\n',
            'context-d\n',
            'context-e\n',
            'main-second\n',
            'footer\n'
        ].join('');
        const incoming = [
            'header\n',
            'feature-first\n',
            'context-a\n',
            'context-b\n',
            'context-c\n',
            'context-d\n',
            'context-e\n',
            'feature-second\n',
            'footer\n'
        ].join('');

        const parts = buildThreeWayMergeDocument(base, current, incoming);
        const conflicts = parts.filter((part): part is Extract<(typeof parts)[number], { type: 'conflict' }> => part.type === 'conflict');

        expect(conflicts).toMatchObject([
            {
                id: 'conflict-0',
                baseText: 'base-first\n',
                currentText: 'main-first\n',
                incomingText: 'feature-first\n'
            },
            {
                id: 'conflict-1',
                baseText: 'base-second\n',
                currentText: 'main-second\n',
                incomingText: 'feature-second\n'
            }
        ]);
        expect(getUnresolvedThreeWayConflictIds(parts, {})).toEqual(['conflict-0', 'conflict-1']);
        expect(getUnresolvedThreeWayConflictIds(parts, { 'conflict-0': 'main-first\n' })).toEqual(['conflict-1']);
        expect(buildThreeWayMergeResult(parts, {
            'conflict-0': 'main-first\n',
            'conflict-1': 'feature-second\n'
        })).toBe([
            'header\n',
            'main-first\n',
            'context-a\n',
            'context-b\n',
            'context-c\n',
            'context-d\n',
            'context-e\n',
            'feature-second\n',
            'footer\n'
        ].join(''));
    });

    it('ignores whitespace-only side changes when building a three-way document in ignore mode', () => {
        const base = 'const value = 1;\n';
        const current = 'const   value = 1;\n';
        const incoming = 'const value = 2;\n';

        const strictParts = buildThreeWayMergeDocument(base, current, incoming);
        expect(strictParts.some(part => part.type === 'conflict')).toBe(true);

        const ignoredParts = buildThreeWayMergeDocument(base, current, incoming, 'ignore');

        expect(ignoredParts.some(part => part.type === 'conflict')).toBe(false);
        expect(buildThreeWayMergeResult(ignoredParts, {})).toBe(incoming);
    });

    it('treats equivalent edits as matching when only whitespace differs in ignore mode', () => {
        const base = 'const value = 1;\n';
        const current = 'const value = 2;\n';
        const incoming = 'const   value=2;\n';

        const ignoredParts = buildThreeWayMergeDocument(base, current, incoming, 'ignore');

        expect(ignoredParts.some(part => part.type === 'conflict')).toBe(false);
        expect(buildThreeWayMergeResult(ignoredParts, {})).toBe(current);
    });

    it('does not create a conflict when both sides make the same change', () => {
        const base = 'one\nbase\nthree\n';
        const current = 'one\nsame\nthree\n';
        const incoming = 'one\nsame\nthree\n';

        const parts = buildThreeWayMergeDocument(base, current, incoming);

        expect(parts.some(part => part.type === 'conflict')).toBe(false);
        expect(buildThreeWayMergeResult(parts, {})).toBe('one\nsame\nthree\n');
    });

    it('creates a conflict for competing inserts at the same base position', () => {
        const base = 'one\nthree\n';
        const current = 'one\nours\nthree\n';
        const incoming = 'one\ntheirs\nthree\n';

        const parts = buildThreeWayMergeDocument(base, current, incoming);
        const conflict = parts.find(part => part.type === 'conflict');

        expect(conflict).toMatchObject({
            type: 'conflict',
            baseText: '',
            currentText: 'ours\n',
            incomingText: 'theirs\n'
        });
    });

    it('creates a conflict for modify/delete cases with an empty side candidate', () => {
        const base = 'kept in base\n';
        const current = '';
        const incoming = 'modified on incoming\n';

        const parts = buildThreeWayMergeDocument(base, current, incoming);
        const conflict = parts.find(part => part.type === 'conflict');

        expect(conflict).toMatchObject({
            type: 'conflict',
            baseText: 'kept in base\n',
            currentText: '',
            incomingText: 'modified on incoming\n'
        });
    });

    it('keeps modify/delete stage tuples as unresolved side-aware conflicts', () => {
        const parts = buildThreeWayMergeDocumentFromSides(
            { exists: true, content: 'base version\n' },
            { exists: false, content: '' },
            { exists: true, content: 'incoming modified version\n' }
        );

        expect(parts).toEqual([{
            type: 'conflict',
            id: 'conflict-0',
            baseText: 'base version\n',
            currentText: '',
            incomingText: 'incoming modified version\n'
        }]);
        expect(getUnresolvedThreeWayConflictIds(parts, {})).toEqual(['conflict-0']);
        expect(buildThreeWayMergeResult(parts, {})).toBe('base version\n');
    });

    it('groups overlapping edit clusters and preserves unchanged lines inside each side candidate', () => {
        const base = [
            'start\n',
            'a\n',
            'middle\n',
            'b\n',
            'end\n'
        ].join('');
        const current = [
            'start\n',
            'a current\n',
            'middle\n',
            'b current\n',
            'end\n'
        ].join('');
        const incoming = [
            'start\n',
            'incoming block\n',
            'end\n'
        ].join('');

        const parts = buildThreeWayMergeDocument(base, current, incoming);
        const conflict = parts.find(part => part.type === 'conflict');

        expect(conflict).toMatchObject({
            type: 'conflict',
            baseText: 'a\nmiddle\nb\n',
            currentText: 'a current\nmiddle\nb current\n',
            incomingText: 'incoming block\n'
        });
    });
});
