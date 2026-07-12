import { describe, expect, it } from 'vitest';
import {
    applyConflictBlockResolution,
    applyMergeContentChanges,
    applyMergeGroupDecision,
    buildConflictDocumentResult,
    buildConflictInlineDiffRanges,
    buildInlineDiffSegments,
    buildLineAlignmentBlocks,
    buildMergeSessionDocument,
    getConflictBaseText,
    getConflictResolutionText,
    getMergeGroupApplyMode,
    getMergeResultReviewState,
    getUnresolvedConflictIds,
    hasConflictBlocks,
    isMergeReviewRangePending,
    parseConflictBlocks,
    parseConflictDocument,
    splitContentLines
} from './conflictModel';

describe('conflictModel', () => {
    it('finds the exact stable-gap position of manually inserted result lines', () => {
        expect(buildLineAlignmentBlocks(
            ['68', '69', '70', '71'],
            ['68', '69', 'manual-a', 'manual-b', '70', '71']
        )).toEqual([{
            referenceStart: 2,
            referenceLineCount: 0,
            resultStart: 2,
            resultLineCount: 2
        }]);
    });

    it('keeps separate insertion and deletion alignment blocks in a stable gap', () => {
        expect(buildLineAlignmentBlocks(
            ['a', 'b', 'c', 'd', 'e', 'f'],
            ['a', 'insert', 'b', 'c', 'e', 'replace', 'f']
        )).toEqual([
            {
                referenceStart: 1,
                referenceLineCount: 0,
                resultStart: 1,
                resultLineCount: 1
            },
            {
                referenceStart: 3,
                referenceLineCount: 1,
                resultStart: 4,
                resultLineCount: 0
            },
            {
                referenceStart: 5,
                referenceLineCount: 0,
                resultStart: 5,
                resultLineCount: 1
            }
        ]);
    });

    it('normalizes line endings before aligning merge panes', () => {
        expect(splitContentLines('one\r\ntwo\nthree\r')).toEqual(['one', 'two', 'three']);
        expect(buildLineAlignmentBlocks(
            splitContentLines('one\r\ntwo\r\n'),
            splitContentLines('one\ntwo\n')
        )).toEqual([]);
    });

    it('builds Base-backed change groups without exposing worktree markers', () => {
        const base = 'header\nbase-first\nmiddle\nbase-second\nfooter\n';
        const left = 'header\nleft-first\nmiddle\nbase-second\nfooter\n';
        const right = 'header\nright-first\nmiddle\nright-second\nfooter\n';
        const session = buildMergeSessionDocument(
            base,
            left,
            right,
            [{ id: 'left-1', baseStart: 1, baseLineCount: 1, sideStart: 1, sideLineCount: 1 }],
            [
                { id: 'right-1', baseStart: 1, baseLineCount: 1, sideStart: 1, sideLineCount: 1 },
                { id: 'right-2', baseStart: 3, baseLineCount: 1, sideStart: 3, sideLineCount: 1 }
            ]
        );

        expect(session.resultText).toBe(base);
        expect(session.groups).toEqual([
            expect.objectContaining({
                id: 'change-0',
                kind: 'conflict',
                baseStart: 1,
                baseText: 'base-first\n',
                leftText: 'left-first\n',
                rightText: 'right-first\n'
            }),
            expect.objectContaining({
                id: 'change-1',
                kind: 'right-only',
                baseStart: 3,
                baseText: 'base-second\n',
                leftText: 'base-second\n',
                rightText: 'right-second\n'
            })
        ]);
        expect(session.reviewRanges).toEqual([
            expect.objectContaining({ leftDecision: 'pending', rightDecision: 'pending' }),
            expect.objectContaining({ leftDecision: null, rightDecision: 'pending' })
        ]);
    });

    it('groups an insertion and overlapping deletion around the same Base range', () => {
        const session = buildMergeSessionDocument(
            'a\nb\n',
            'a\nleft\nb\n',
            'a\n',
            [{ id: 'left-insert', baseStart: 1, baseLineCount: 0, sideStart: 1, sideLineCount: 1 }],
            [{ id: 'right-delete', baseStart: 1, baseLineCount: 1, sideStart: 1, sideLineCount: 0 }]
        );

        expect(session.groups).toEqual([
            expect.objectContaining({
                kind: 'conflict',
                baseText: 'b\n',
                leftText: 'left\nb\n',
                rightText: '',
                leftLineCount: 2,
                rightLineCount: 0
            })
        ]);
    });

    it('rebuilds merge groups with the selected whitespace comparison mode', () => {
        const base = 'value\nconst item = 1;\n';
        const left = 'value   \nconst  item = 1;\n';
        const changes = [
            { id: 'mixed-whitespace', baseStart: 0, baseLineCount: 2, sideStart: 0, sideLineCount: 2 }
        ];

        const defaultSession = buildMergeSessionDocument(base, left, base, changes, [], 'none');
        const trimmedSession = buildMergeSessionDocument(base, left, base, changes, [], 'trim');
        const ignoredSession = buildMergeSessionDocument(base, left, base, changes, [], 'ignore');

        expect(defaultSession.groups).toHaveLength(1);
        expect(trimmedSession.groups).toEqual([
            expect.objectContaining({ baseStart: 1, leftText: 'const  item = 1;\n' })
        ]);
        expect(ignoredSession.groups).toHaveLength(0);
        expect(ignoredSession.reviewRanges).toHaveLength(0);
    });

    it('filters a large whitespace-only hunk without building an LCS table', () => {
        const lineCount = 501;
        const base = 'value\n'.repeat(lineCount);
        const left = '  value   \n'.repeat(lineCount);
        const changes = [{
            id: 'large-whitespace',
            baseStart: 0,
            baseLineCount: lineCount,
            sideStart: 0,
            sideLineCount: lineCount
        }];

        expect(buildMergeSessionDocument(base, left, base, changes, [], 'trim').groups).toHaveLength(0);
        expect(buildMergeSessionDocument(base, left, base, changes, [], 'ignore').groups).toHaveLength(0);
    });

    it('starts an add/add conflict from an empty Base result', () => {
        const session = buildMergeSessionDocument(
            '',
            'left add\n',
            'right add\n',
            [{ id: 'left-add', baseStart: 0, baseLineCount: 0, sideStart: 0, sideLineCount: 1 }],
            [{ id: 'right-add', baseStart: 0, baseLineCount: 0, sideStart: 0, sideLineCount: 1 }]
        );

        expect(session.resultText).toBe('');
        expect(session.groups).toEqual([
            expect.objectContaining({
                kind: 'conflict',
                baseText: '',
                leftText: 'left add\n',
                rightText: 'right add\n'
            })
        ]);
        expect(session.reviewRanges[0]).toMatchObject({
            startOffset: 0,
            endOffset: 0,
            leftDecision: 'pending',
            rightDecision: 'pending',
            lastAppliedSide: null
        });
    });

    it('reviews each side independently and keeps later review ranges aligned', () => {
        const session = buildMergeSessionDocument(
            'base-one\nbase-two\n',
            'left-one-longer\nbase-two\n',
            'right-one\nright-two\n',
            [{ id: 'left-1', baseStart: 0, baseLineCount: 1, sideStart: 0, sideLineCount: 1 }],
            [
                { id: 'right-1', baseStart: 0, baseLineCount: 1, sideStart: 0, sideLineCount: 1 },
                { id: 'right-2', baseStart: 1, baseLineCount: 1, sideStart: 1, sideLineCount: 1 }
            ]
        );
        const first = applyMergeGroupDecision(
            session.resultText,
            session.reviewRanges,
            session.groups[0],
            'left',
            'applied'
        );

        expect(first.content).toBe('left-one-longer\nbase-two\n');
        expect(first.ranges[0]).toMatchObject({
            leftDecision: 'applied',
            rightDecision: 'pending',
            lastAppliedSide: 'left'
        });
        expect(isMergeReviewRangePending(first.ranges[0])).toBe(true);
        expect(first.content.slice(first.ranges[1].startOffset, first.ranges[1].endOffset)).toBe('base-two\n');

        const second = applyMergeGroupDecision(
            first.content,
            first.ranges,
            session.groups[0],
            'right',
            'cancelled'
        );

        expect(second.content).toBe(first.content);
        expect(second.ranges[0]).toMatchObject({
            leftDecision: 'applied',
            rightDecision: 'cancelled',
            lastAppliedSide: 'left'
        });
        expect(isMergeReviewRangePending(second.ranges[0])).toBe(false);
    });

    it('marks only the remaining pending sides as manually reviewed', () => {
        const session = buildMergeSessionDocument(
            'base\n',
            'left\n',
            'right\n',
            [{ id: 'left', baseStart: 0, baseLineCount: 1, sideStart: 0, sideLineCount: 1 }],
            [{ id: 'right', baseStart: 0, baseLineCount: 1, sideStart: 0, sideLineCount: 1 }]
        );
        const left = applyMergeGroupDecision(
            session.resultText,
            session.reviewRanges,
            session.groups[0],
            'left',
            'applied'
        );
        const reviewed = applyMergeGroupDecision(
            left.content,
            left.ranges,
            session.groups[0],
            'both',
            'manual'
        );

        expect(reviewed.content).toBe('left\n');
        expect(reviewed.ranges[0]).toMatchObject({
            leftDecision: 'applied',
            rightDecision: 'manual',
            lastAppliedSide: 'left'
        });
        expect(isMergeReviewRangePending(reviewed.ranges[0])).toBe(false);
    });

    it('appends the second applied conflict side and restores the other side when cancelled', () => {
        const session = buildMergeSessionDocument(
            'base\n',
            'left\n',
            'right\n',
            [{ id: 'left', baseStart: 0, baseLineCount: 1, sideStart: 0, sideLineCount: 1 }],
            [{ id: 'right', baseStart: 0, baseLineCount: 1, sideStart: 0, sideLineCount: 1 }]
        );
        const left = applyMergeGroupDecision(
            session.resultText,
            session.reviewRanges,
            session.groups[0],
            'left',
            'applied'
        );
        expect(getMergeGroupApplyMode(
            left.content,
            left.ranges[0],
            session.groups[0],
            'right'
        )).toBe('append');
        const right = applyMergeGroupDecision(
            left.content,
            left.ranges,
            session.groups[0],
            'right',
            'applied'
        );
        const cancelledRight = applyMergeGroupDecision(
            right.content,
            right.ranges,
            session.groups[0],
            'right',
            'cancelled'
        );

        expect(right.content).toBe('left\nright\n');
        expect(cancelledRight.content).toBe('left\n');
        expect(cancelledRight.ranges[0]).toMatchObject({
            leftDecision: 'applied',
            rightDecision: 'cancelled',
            lastAppliedSide: 'left'
        });
    });

    it('appends add/add sides in review order with a line boundary', () => {
        const session = buildMergeSessionDocument(
            '',
            'left add',
            'right add',
            [{ id: 'left', baseStart: 0, baseLineCount: 0, sideStart: 0, sideLineCount: 1 }],
            [{ id: 'right', baseStart: 0, baseLineCount: 0, sideStart: 0, sideLineCount: 1 }]
        );
        const right = applyMergeGroupDecision(
            session.resultText,
            session.reviewRanges,
            session.groups[0],
            'right',
            'applied'
        );
        expect(getMergeGroupApplyMode(
            right.content,
            right.ranges[0],
            session.groups[0],
            'left'
        )).toBe('append');
        const left = applyMergeGroupDecision(
            right.content,
            right.ranges,
            session.groups[0],
            'left',
            'applied'
        );

        expect(left.content).toBe('right add\nleft add');
        expect(left.ranges[0]).toMatchObject({
            leftDecision: 'applied',
            rightDecision: 'applied',
            lastAppliedSide: 'left'
        });
    });

    it('preserves an applied side when the remaining conflict side is a deletion', () => {
        const session = buildMergeSessionDocument(
            'base\n',
            'left\n',
            '',
            [{ id: 'left', baseStart: 0, baseLineCount: 1, sideStart: 0, sideLineCount: 1 }],
            [{ id: 'right', baseStart: 0, baseLineCount: 1, sideStart: 0, sideLineCount: 0 }]
        );
        const left = applyMergeGroupDecision(
            session.resultText,
            session.reviewRanges,
            session.groups[0],
            'left',
            'applied'
        );

        expect(getMergeGroupApplyMode(
            left.content,
            left.ranges[0],
            session.groups[0],
            'right'
        )).toBe('preserve');

        const right = applyMergeGroupDecision(
            left.content,
            left.ranges,
            session.groups[0],
            'right',
            'applied'
        );
        expect(right.content).toBe('left\n');
    });

    it('moves review ranges after manual edits and reopens touched groups', () => {
        const ranges = [
            {
                groupId: 'change-0',
                startOffset: 2,
                endOffset: 6,
                leftDecision: 'applied' as const,
                rightDecision: 'cancelled' as const,
                lastAppliedSide: 'left' as const
            },
            {
                groupId: 'change-1',
                startOffset: 10,
                endOffset: 12,
                leftDecision: null,
                rightDecision: 'applied' as const,
                lastAppliedSide: 'right' as const
            }
        ];
        const updated = applyMergeContentChanges(ranges, [
            { rangeOffset: 3, rangeLength: 1, text: 'manual' }
        ]);

        expect(updated.touchedGroupIds).toEqual(['change-0']);
        expect(updated.ranges[0]).toMatchObject({
            startOffset: 2,
            endOffset: 11,
            leftDecision: 'pending',
            rightDecision: 'pending',
            lastAppliedSide: null
        });
        expect(updated.ranges[1]).toMatchObject({
            startOffset: 15,
            endOffset: 17,
            leftDecision: null,
            rightDecision: 'applied',
            lastAppliedSide: 'right'
        });
    });

    it('does not expand a pending range into a manual edit that starts at its end', () => {
        const session = buildMergeSessionDocument(
            'a\r\nstable',
            'A\r\nstable',
            'a\r\nstable',
            [{ id: 'left', baseStart: 0, baseLineCount: 1, sideStart: 0, sideLineCount: 1 }],
            []
        );
        const editedContent = 'a\r\nStable';
        const updated = applyMergeContentChanges(session.reviewRanges, [
            { rangeOffset: 3, rangeLength: 1, text: 'S' }
        ]);
        const accepted = applyMergeGroupDecision(
            editedContent,
            updated.ranges,
            session.groups[0],
            'left',
            'applied'
        );

        expect(updated.touchedGroupIds).toEqual([]);
        expect(updated.ranges[0]).toMatchObject({ startOffset: 0, endOffset: 3 });
        expect(accepted.content).toBe('A\r\nStable');
    });

    it('keeps adjacent ranges disjoint when inserting at their shared boundary', () => {
        const session = buildMergeSessionDocument(
            'a\nb\n',
            'A\nb\n',
            'a\nB\n',
            [{ id: 'left', baseStart: 0, baseLineCount: 1, sideStart: 0, sideLineCount: 1 }],
            [{ id: 'right', baseStart: 1, baseLineCount: 1, sideStart: 1, sideLineCount: 1 }]
        );
        const editedContent = 'a\nmanual\nb\n';
        const updated = applyMergeContentChanges(session.reviewRanges, [
            { rangeOffset: 2, rangeLength: 0, text: 'manual\n' }
        ]);
        const accepted = applyMergeGroupDecision(
            editedContent,
            updated.ranges,
            session.groups[0],
            'left',
            'applied'
        );

        expect(updated.touchedGroupIds).toEqual(['change-1']);
        expect(updated.ranges[0]).toMatchObject({ startOffset: 0, endOffset: 2 });
        expect(updated.ranges[1]).toMatchObject({ startOffset: 2, endOffset: 11 });
        expect(updated.ranges[0].endOffset).toBeLessThanOrEqual(updated.ranges[1].startOffset);
        expect(accepted.content).toBe('A\nmanual\nb\n');
    });

    it('maps both sides of a shared boundary to the same offset when a replacement spans it', () => {
        const ranges = [
            {
                groupId: 'change-0',
                startOffset: 0,
                endOffset: 2,
                leftDecision: 'pending' as const,
                rightDecision: null,
                lastAppliedSide: null
            },
            {
                groupId: 'change-1',
                startOffset: 2,
                endOffset: 4,
                leftDecision: null,
                rightDecision: 'pending' as const,
                lastAppliedSide: null
            }
        ];
        const updated = applyMergeContentChanges(ranges, [
            { rangeOffset: 1, rangeLength: 2, text: 'X' }
        ]);

        expect(updated.touchedGroupIds).toEqual(['change-0', 'change-1']);
        expect(updated.ranges[0]).toMatchObject({ startOffset: 0, endOffset: 1 });
        expect(updated.ranges[1]).toMatchObject({ startOffset: 1, endOffset: 3 });
    });

    it('keeps an empty range anchored when a following range owns a boundary insertion', () => {
        const updated = applyMergeContentChanges([
            {
                groupId: 'change-0',
                startOffset: 0,
                endOffset: 0,
                leftDecision: 'pending' as const,
                rightDecision: null,
                lastAppliedSide: null
            },
            {
                groupId: 'change-1',
                startOffset: 0,
                endOffset: 4,
                leftDecision: null,
                rightDecision: 'pending' as const,
                lastAppliedSide: null
            }
        ], [
            { rangeOffset: 0, rangeLength: 0, text: 'manual' }
        ]);

        expect(updated.touchedGroupIds).toEqual(['change-1']);
        expect(updated.ranges[0]).toMatchObject({ startOffset: 0, endOffset: 0 });
        expect(updated.ranges[1]).toMatchObject({ startOffset: 0, endOffset: 10 });
    });

    it('transforms multiple Monaco changes from original document offsets', () => {
        const ranges = [
            {
                groupId: 'change-0',
                startOffset: 2,
                endOffset: 6,
                leftDecision: 'applied' as const,
                rightDecision: null,
                lastAppliedSide: 'left' as const
            },
            {
                groupId: 'change-1',
                startOffset: 10,
                endOffset: 12,
                leftDecision: null,
                rightDecision: 'cancelled' as const,
                lastAppliedSide: null
            }
        ];
        const updated = applyMergeContentChanges(ranges, [
            { rangeOffset: 10, rangeLength: 0, text: 'xy' },
            { rangeOffset: 3, rangeLength: 1, text: 'manual' }
        ]);

        expect(updated.touchedGroupIds).toEqual(['change-0', 'change-1']);
        expect(updated.ranges[0]).toMatchObject({ startOffset: 2, endOffset: 11 });
        expect(updated.ranges[1]).toMatchObject({ startOffset: 15, endOffset: 19 });
    });

    it('expands an empty EOF range for all insertions at the same offset', () => {
        const updated = applyMergeContentChanges([{
            groupId: 'change-0',
            startOffset: 6,
            endOffset: 6,
            leftDecision: 'pending',
            rightDecision: 'pending',
            lastAppliedSide: null
        }], [
            { rangeOffset: 6, rangeLength: 0, text: 'right' },
            { rangeOffset: 6, rangeLength: 0, text: 'left' }
        ]);

        expect(updated.touchedGroupIds).toEqual(['change-0']);
        expect(updated.ranges[0]).toMatchObject({ startOffset: 6, endOffset: 15 });
    });

    it('builds inline diff segments while preserving unchanged tokens', () => {
        expect(buildInlineDiffSegments('const value = 2;\n', 'const value = 1;\n')).toEqual([
            { text: 'const value = ', changed: false },
            { text: '2', changed: true },
            { text: ';\n', changed: false }
        ]);
        expect(buildInlineDiffSegments('same line\n', 'same line\n')).toEqual([
            { text: 'same line\n', changed: false }
        ]);
    });

    it('applies IDEA-style whitespace policies to inline word highlights', () => {
        expect(buildInlineDiffSegments('const  value\n', 'const value\n')).toEqual([
            { text: 'const', changed: false },
            { text: '  ', changed: true },
            { text: 'value\n', changed: false }
        ]);
        expect(buildInlineDiffSegments('const  value\n', 'const value\n', 'ignore')).toEqual([
            { text: 'const  value\n', changed: false }
        ]);
        expect(buildInlineDiffSegments('  value  \n', 'value\n', 'trim')).toEqual([
            { text: '  value  \n', changed: false }
        ]);
        expect(buildInlineDiffSegments('const  value\n', 'const value\n', 'trim')).toEqual([
            { text: 'const', changed: false },
            { text: '  ', changed: true },
            { text: 'value\n', changed: false }
        ]);
    });

    it('builds exact inline ranges for both sides of a conflict block', () => {
        const content = [
            '<<<<<<< current\n',
            'const value = 2;\n',
            '||||||| base\n',
            'const value = 1;\n',
            '=======\n',
            'const value = 3;\n',
            '>>>>>>> incoming\n'
        ].join('');

        expect(buildConflictInlineDiffRanges(content, '')).toEqual([
            {
                conflictId: 'conflict-0',
                side: 'current',
                startLine: 2,
                startColumn: 15,
                endLine: 2,
                endColumn: 16
            },
            {
                conflictId: 'conflict-0',
                side: 'incoming',
                startLine: 6,
                startColumn: 15,
                endLine: 6,
                endColumn: 16
            }
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

        const [block] = parseConflictBlocks(content);

        expect(block).toMatchObject({
            id: 'conflict-0',
            markerSize: 7,
            startLine: 2,
            endLine: 6,
            currentLabel: 'HEAD',
            incomingLabel: 'feature',
            currentText: 'current line\n',
            incomingText: 'incoming line\n',
            baseText: ''
        });
        expect(content.slice(block.currentStartOffset, block.currentEndOffset)).toBe(block.currentText);
        expect(content.slice(block.incomingStartOffset, block.incomingEndOffset)).toBe(block.incomingText);
        expect(block.markerText).toBe(content.slice('before\n'.length, content.length - 'after\n'.length));
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

        expect(parseConflictBlocks(content)[0]).toMatchObject({
            currentLabel: 'ours',
            baseLabel: 'base',
            incomingLabel: 'theirs',
            currentText: 'current line\n',
            baseText: 'base line\n',
            incomingText: 'incoming line\n'
        });
    });

    it('supports custom Git conflict marker sizes', () => {
        const content = [
            '<<<<<<<<<< current\n',
            'ours\n',
            '|||||||||| base\n',
            'base\n',
            '==========\n',
            'theirs\n',
            '>>>>>>>>>> incoming\n'
        ].join('');

        expect(parseConflictBlocks(content)[0]).toMatchObject({
            markerSize: 10,
            currentLabel: 'current',
            baseLabel: 'base',
            incomingLabel: 'incoming'
        });
    });

    it('does not treat marker-like source text as a conflict block', () => {
        expect(hasConflictBlocks('const marker = "<<<<<<<";\nconst separator = "=======";\nconst end = ">>>>>>>";\n')).toBe(false);
        expect(hasConflictBlocks('<<<<<<< incomplete\n=======\n')).toBe(false);
    });

    it('requires explicit review before applying an unchanged marker-free result', () => {
        expect(getMergeResultReviewState('resolved\n', 'resolved\n', false)).toEqual({
            conflictMarkerCount: 0,
            isResolutionConfirmed: false
        });
        expect(getMergeResultReviewState('resolved\n', 'resolved\n', true)).toEqual({
            conflictMarkerCount: 0,
            isResolutionConfirmed: true
        });
        expect(getMergeResultReviewState('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n', 'manual\n', false)).toEqual({
            conflictMarkerCount: 0,
            isResolutionConfirmed: true
        });
        expect(getMergeResultReviewState('original\n', '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n', true)).toEqual({
            conflictMarkerCount: 1,
            isResolutionConfirmed: false
        });
    });

    it('preserves CRLF and a missing final newline while applying resolutions', () => {
        const content = 'a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> branch\r\nz';

        expect(applyConflictBlockResolution(content, 'conflict-0', 'incoming')).toBe('a\r\ntheirs\r\nz');
    });

    it('applies base, current, incoming, and both choices', () => {
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

    it('renumbers remaining blocks after resolving an earlier conflict', () => {
        const content = [
            '<<<<<<< HEAD\nours 1\n=======\ntheirs 1\n>>>>>>> branch\n',
            'middle\n',
            '<<<<<<< HEAD\nours 2\n=======\ntheirs 2\n>>>>>>> branch\n'
        ].join('');

        const next = applyConflictBlockResolution(content, 'conflict-0', 'current');

        expect(parseConflictBlocks(next)).toHaveLength(1);
        expect(parseConflictBlocks(next)[0]).toMatchObject({ id: 'conflict-0', currentText: 'ours 2\n' });
    });

    it('splits a conflicted file into preserved text and conflict parts', () => {
        const content = 'before\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\nafter\n';
        const parts = parseConflictDocument(content);

        expect(parts).toHaveLength(3);
        expect(parts[0]).toMatchObject({ type: 'text', text: 'before\n' });
        expect(parts[1]).toMatchObject({ type: 'conflict', id: 'conflict-0' });
        expect(parts[2]).toMatchObject({ type: 'text', text: 'after\n' });
    });

    it('infers base text when markers do not include a base section', () => {
        const content = [
            'before\n',
            '<<<<<<< HEAD\nours 1\n=======\ntheirs 1\n>>>>>>> branch\n',
            'middle\n',
            '<<<<<<< HEAD\nours 2\n=======\ntheirs 2\n>>>>>>> branch\n',
            'after\n'
        ].join('');
        const base = 'before\nbase 1\nmiddle\nbase 2\nafter\n';
        const conflicts = parseConflictDocument(content, base)
            .filter((part): part is Extract<ReturnType<typeof parseConflictDocument>[number], { type: 'conflict' }> => part.type === 'conflict');

        expect(getConflictBaseText(conflicts[0].block)).toBe('base 1\n');
        expect(getConflictBaseText(conflicts[1].block)).toBe('base 2\n');
    });

    it('reconstructs partial and complete results from explicit resolutions', () => {
        const content = [
            '<<<<<<< HEAD\nours 1\n=======\ntheirs 1\n>>>>>>> branch\n',
            'middle\n',
            '<<<<<<< HEAD\nours 2\n=======\ntheirs 2\n>>>>>>> branch\n'
        ].join('');
        const parts = parseConflictDocument(content);
        const firstConflict = parts.find(part => part.type === 'conflict');
        if (!firstConflict || firstConflict.type !== 'conflict') {
            throw new Error('Expected a conflict part');
        }

        const partialResolutions = {
            [firstConflict.id]: getConflictResolutionText(firstConflict.block, 'incoming')
        };
        const partial = buildConflictDocumentResult(parts, partialResolutions);

        expect(partial).toContain('theirs 1\n');
        expect(partial).toContain('<<<<<<< HEAD\n');
        expect(getUnresolvedConflictIds(parts, partialResolutions)).toEqual(['conflict-1']);
        expect(buildConflictDocumentResult(parts, {
            'conflict-0': '',
            'conflict-1': 'resolved 2\n'
        })).toBe('middle\nresolved 2\n');
    });
});
