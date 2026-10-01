import { parseConflictMarkerBlocks, type ConflictMarkerBlock } from '@shared/conflictMarkers';
import type { ConflictChange } from '@shared/messages';

export type ConflictResolutionChoice = 'base' | 'current' | 'incoming' | 'both';

export interface ConflictBlock extends ConflictMarkerBlock {
    inferredBaseText?: string;
}

export interface InlineDiffSegment {
    text: string;
    changed: boolean;
}

export interface ConflictInlineDiffRange {
    conflictId: string;
    side: 'current' | 'incoming';
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

export type ConflictDocumentPart =
    | {
          type: 'text';
          id: string;
          text: string;
      }
    | {
          type: 'conflict';
          id: string;
          block: ConflictBlock;
      };

export type ConflictResolutionMap = Record<string, string>;
export type ConflictResolutionState = Record<string, unknown>;

export interface MergeResultReviewState {
    conflictMarkerCount: number;
    isResolutionConfirmed: boolean;
}

export type MergeReviewDecision = 'pending' | 'applied' | 'cancelled' | 'manual';
export type MergeReviewSide = 'left' | 'right';
export type WhitespaceCompareMode = 'none' | 'ignore' | 'trim';

export interface MergeChangeGroup {
    id: string;
    baseStart: number;
    baseLineCount: number;
    leftStart: number;
    leftLineCount: number;
    rightStart: number;
    rightLineCount: number;
    baseText: string;
    leftText: string;
    rightText: string;
    hasLeftChange: boolean;
    hasRightChange: boolean;
    kind: 'left-only' | 'right-only' | 'identical' | 'conflict';
}

export interface MergeReviewRange {
    groupId: string;
    startOffset: number;
    endOffset: number;
    leftDecision: MergeReviewDecision | null;
    rightDecision: MergeReviewDecision | null;
    lastAppliedSide: MergeReviewSide | null;
}

export interface MergeSessionDocument {
    resultText: string;
    groups: MergeChangeGroup[];
    reviewRanges: MergeReviewRange[];
}

export interface MergeTextRange {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

export interface LineAlignmentBlock {
    referenceStart: number;
    referenceLineCount: number;
    resultStart: number;
    resultLineCount: number;
}

interface ContentLineSlice {
    startOffset: number;
    endOffset: number;
    text: string;
}

interface TaggedConflictChange {
    side: 'left' | 'right';
    change: ConflictChange;
    index: number;
}

function tokenizeInlineDiffText(text: string): string[] {
    return text.match(/\r\n|\r|\n|[^\S\r\n]+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]+/g) ?? [];
}

function isWhitespaceToken(token: string): boolean {
    return /^\s+$/.test(token);
}

function isHorizontalWhitespaceToken(token: string): boolean {
    return /^[^\S\r\n]+$/.test(token);
}

function isLineBreak(value: string | undefined): boolean {
    return value === '\r' || value === '\n';
}

function shouldIgnoreInlineToken(tokens: string[], index: number, whitespaceMode: WhitespaceCompareMode): boolean {
    const token = tokens[index];
    if (whitespaceMode === 'ignore') {
        return isWhitespaceToken(token);
    }
    if (whitespaceMode !== 'trim' || !isHorizontalWhitespaceToken(token)) {
        return false;
    }

    const previousCharacter = tokens[index - 1]?.at(-1);
    const nextCharacter = tokens[index + 1]?.[0];
    return (
        previousCharacter === undefined ||
        nextCharacter === undefined ||
        isLineBreak(previousCharacter) ||
        isLineBreak(nextCharacter)
    );
}

function computeLcsPairs(left: string[], right: string[]): Array<[number, number]> {
    const table: number[][] = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));

    for (let i = left.length - 1; i >= 0; i--) {
        for (let j = right.length - 1; j >= 0; j--) {
            if (left[i] === right[j]) {
                table[i][j] = table[i + 1][j + 1] + 1;
            } else {
                table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
            }
        }
    }

    const pairs: Array<[number, number]> = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
        if (left[i] === right[j]) {
            pairs.push([i, j]);
            i++;
            j++;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            i++;
        } else {
            j++;
        }
    }

    return pairs;
}

export function buildInlineDiffSegments(
    text: string,
    baseText: string,
    whitespaceMode: WhitespaceCompareMode = 'none'
): InlineDiffSegment[] {
    if (!text) {
        return [];
    }

    if (text === baseText) {
        return [{ text, changed: false }];
    }

    const tokens = tokenizeInlineDiffText(text);
    const baseTokens = tokenizeInlineDiffText(baseText);
    if (tokens.length === 0) {
        return [{ text, changed: true }];
    }

    const indexedTokens = tokens.map((token, index) => ({ token, index }));
    const indexedBaseTokens = baseTokens.map((token, index) => ({ token, index }));
    const comparableTokens = indexedTokens.filter(
        ({ index }) => !shouldIgnoreInlineToken(tokens, index, whitespaceMode)
    );
    const comparableBaseTokens = indexedBaseTokens.filter(
        ({ index }) => !shouldIgnoreInlineToken(baseTokens, index, whitespaceMode)
    );

    if (comparableTokens.length * comparableBaseTokens.length > 50_000) {
        return [{ text, changed: false }];
    }

    const unchangedTokenIndexes = new Set<number>();
    for (const [, comparableIndex] of computeLcsPairs(
        comparableBaseTokens.map(({ token }) => token),
        comparableTokens.map(({ token }) => token)
    )) {
        unchangedTokenIndexes.add(comparableTokens[comparableIndex].index);
    }

    const segments: InlineDiffSegment[] = [];
    for (let index = 0; index < tokens.length; index++) {
        const changed = !shouldIgnoreInlineToken(tokens, index, whitespaceMode) && !unchangedTokenIndexes.has(index);
        const previous = segments[segments.length - 1];
        if (previous?.changed === changed) {
            previous.text += tokens[index];
        } else {
            segments.push({ text: tokens[index], changed });
        }
    }

    return segments;
}

function getLineStartOffsets(content: string): number[] {
    const offsets = [0];
    for (let index = 0; index < content.length; index++) {
        if (content[index] === '\r' && content[index + 1] === '\n') {
            index++;
            offsets.push(index + 1);
        } else if (content[index] === '\r' || content[index] === '\n') {
            offsets.push(index + 1);
        }
    }
    return offsets;
}

function getPositionAtOffset(lineStarts: number[], offset: number): { line: number; column: number } {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (lineStarts[middle] <= offset) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    const lineIndex = Math.max(0, high);
    return {
        line: lineIndex + 1,
        column: offset - lineStarts[lineIndex] + 1,
    };
}

function splitContentLineSlices(content: string): ContentLineSlice[] {
    const lines: ContentLineSlice[] = [];
    let offset = 0;
    while (offset < content.length) {
        const startOffset = offset;
        while (offset < content.length && content[offset] !== '\r' && content[offset] !== '\n') {
            offset++;
        }
        if (content[offset] === '\r' && content[offset + 1] === '\n') {
            offset += 2;
        } else if (offset < content.length) {
            offset++;
        }
        lines.push({
            startOffset,
            endOffset: offset,
            text: content.slice(startOffset, offset),
        });
    }
    return lines;
}

export function splitContentLines(content: string): string[] {
    return splitContentLineSlices(content).map((line) => line.text.replace(/\r\n$|\r$|\n$/, ''));
}

export function buildLineAlignmentBlocks(referenceLines: string[], resultLines: string[]): LineAlignmentBlock[] {
    let commonPrefixLineCount = 0;
    while (
        commonPrefixLineCount < referenceLines.length &&
        commonPrefixLineCount < resultLines.length &&
        referenceLines[commonPrefixLineCount] === resultLines[commonPrefixLineCount]
    ) {
        commonPrefixLineCount++;
    }

    let referenceEnd = referenceLines.length;
    let resultEnd = resultLines.length;
    while (
        referenceEnd > commonPrefixLineCount &&
        resultEnd > commonPrefixLineCount &&
        referenceLines[referenceEnd - 1] === resultLines[resultEnd - 1]
    ) {
        referenceEnd--;
        resultEnd--;
    }

    const referenceMiddle = referenceLines.slice(commonPrefixLineCount, referenceEnd);
    const resultMiddle = resultLines.slice(commonPrefixLineCount, resultEnd);
    if (referenceMiddle.length === 0 && resultMiddle.length === 0) {
        return [];
    }

    if (referenceMiddle.length * resultMiddle.length > 250_000) {
        return [
            {
                referenceStart: commonPrefixLineCount,
                referenceLineCount: referenceMiddle.length,
                resultStart: commonPrefixLineCount,
                resultLineCount: resultMiddle.length,
            },
        ];
    }

    const matchingLines = computeLcsPairs(referenceMiddle, resultMiddle);
    const blocks: LineAlignmentBlock[] = [];
    let referenceCursor = 0;
    let resultCursor = 0;

    for (let index = 0; index <= matchingLines.length; index++) {
        const [referenceMatch, resultMatch] =
            index < matchingLines.length ? matchingLines[index] : [referenceMiddle.length, resultMiddle.length];
        const referenceLineCount = referenceMatch - referenceCursor;
        const resultLineCount = resultMatch - resultCursor;
        if (referenceLineCount > 0 || resultLineCount > 0) {
            blocks.push({
                referenceStart: commonPrefixLineCount + referenceCursor,
                referenceLineCount,
                resultStart: commonPrefixLineCount + resultCursor,
                resultLineCount,
            });
        }
        if (index < matchingLines.length) {
            referenceCursor = referenceMatch + 1;
            resultCursor = resultMatch + 1;
        }
    }

    return blocks;
}

function getLineBoundaryOffset(lines: ContentLineSlice[], contentLength: number, lineIndex: number): number {
    if (lineIndex <= 0) {
        return 0;
    }
    if (lineIndex >= lines.length) {
        return contentLength;
    }
    return lines[lineIndex].startOffset;
}

function sliceLineRange(content: string, lines: ContentLineSlice[], start: number, lineCount: number): string {
    const startOffset = getLineBoundaryOffset(lines, content.length, start);
    const endOffset = getLineBoundaryOffset(lines, content.length, start + lineCount);
    return content.slice(startOffset, endOffset);
}

function changesOverlap(left: ConflictChange, right: ConflictChange): boolean {
    const leftEnd = left.baseStart + left.baseLineCount;
    const rightEnd = right.baseStart + right.baseLineCount;
    if (left.baseLineCount === 0 && right.baseLineCount === 0) {
        return left.baseStart === right.baseStart;
    }
    if (left.baseLineCount === 0) {
        return left.baseStart >= right.baseStart && left.baseStart <= rightEnd;
    }
    if (right.baseLineCount === 0) {
        return right.baseStart >= left.baseStart && right.baseStart <= leftEnd;
    }
    return left.baseStart < rightEnd && right.baseStart < leftEnd;
}

function buildChangeComponents(
    leftChanges: ConflictChange[],
    rightChanges: ConflictChange[]
): TaggedConflictChange[][] {
    const tagged: TaggedConflictChange[] = [
        ...leftChanges.map((change, index) => ({ side: 'left' as const, change, index })),
        ...rightChanges.map((change, index) => ({ side: 'right' as const, change, index: leftChanges.length + index })),
    ];
    const parents = tagged.map((_, index) => index);
    const find = (index: number): number => {
        while (parents[index] !== index) {
            parents[index] = parents[parents[index]];
            index = parents[index];
        }
        return index;
    };
    const union = (left: number, right: number) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) {
            parents[rightRoot] = leftRoot;
        }
    };

    for (let leftIndex = 0; leftIndex < leftChanges.length; leftIndex++) {
        for (let rightIndex = 0; rightIndex < rightChanges.length; rightIndex++) {
            if (changesOverlap(leftChanges[leftIndex], rightChanges[rightIndex])) {
                union(leftIndex, leftChanges.length + rightIndex);
            }
        }
    }

    const components = new Map<number, TaggedConflictChange[]>();
    for (const item of tagged) {
        const root = find(item.index);
        const component = components.get(root) ?? [];
        component.push(item);
        components.set(root, component);
    }
    return [...components.values()].sort((left, right) => {
        const leftStart = Math.min(...left.map((item) => item.change.baseStart));
        const rightStart = Math.min(...right.map((item) => item.change.baseStart));
        return leftStart - rightStart;
    });
}

function applySideChanges(
    baseContent: string,
    baseLines: ContentLineSlice[],
    sideContent: string,
    sideLines: ContentLineSlice[],
    groupStart: number,
    groupEnd: number,
    changes: ConflictChange[]
): string {
    if (changes.length === 0) {
        return sliceLineRange(baseContent, baseLines, groupStart, groupEnd - groupStart);
    }

    let cursor = groupStart;
    let result = '';
    for (const change of [...changes].sort((left, right) => left.baseStart - right.baseStart)) {
        result += sliceLineRange(baseContent, baseLines, cursor, change.baseStart - cursor);
        result += sliceLineRange(sideContent, sideLines, change.sideStart, change.sideLineCount);
        cursor = Math.max(cursor, change.baseStart + change.baseLineCount);
    }
    result += sliceLineRange(baseContent, baseLines, cursor, groupEnd - cursor);
    return result;
}

function normalizeWhitespaceForComparison(content: string, whitespaceMode: WhitespaceCompareMode): string {
    const normalized = content.replace(/\r\n?|\n/g, '\n');
    if (whitespaceMode === 'none') {
        return normalized;
    }

    return normalized
        .split('\n')
        .map((line) =>
            whitespaceMode === 'ignore' ? line.replace(/[^\S\r\n]+/g, '') : line.replace(/^[^\S\r\n]+|[^\S\r\n]+$/g, '')
        )
        .join('\n');
}

function filterChangesByWhitespaceMode(
    baseLines: ContentLineSlice[],
    sideLines: ContentLineSlice[],
    changes: ConflictChange[],
    whitespaceMode: WhitespaceCompareMode
): ConflictChange[] {
    if (whitespaceMode === 'none') {
        return changes;
    }

    return changes.flatMap((change) => {
        const comparableBaseLines = baseLines
            .slice(change.baseStart, change.baseStart + change.baseLineCount)
            .map((line) => normalizeWhitespaceForComparison(line.text, whitespaceMode));
        const comparableSideLines = sideLines
            .slice(change.sideStart, change.sideStart + change.sideLineCount)
            .map((line) => normalizeWhitespaceForComparison(line.text, whitespaceMode));

        if (
            comparableBaseLines.length === comparableSideLines.length &&
            comparableBaseLines.every((line, index) => line === comparableSideLines[index])
        ) {
            return [];
        }

        if (comparableBaseLines.length * comparableSideLines.length > 250_000) {
            return [change];
        }

        const matchingLines = computeLcsPairs(comparableBaseLines, comparableSideLines);
        const refined: ConflictChange[] = [];
        let baseCursor = 0;
        let sideCursor = 0;
        let partIndex = 0;

        for (let index = 0; index <= matchingLines.length; index++) {
            const [baseMatch, sideMatch] =
                index < matchingLines.length
                    ? matchingLines[index]
                    : [comparableBaseLines.length, comparableSideLines.length];
            const baseLineCount = baseMatch - baseCursor;
            const sideLineCount = sideMatch - sideCursor;
            if (baseLineCount > 0 || sideLineCount > 0) {
                refined.push({
                    id: `${change.id}:${partIndex++}`,
                    baseStart: change.baseStart + baseCursor,
                    baseLineCount,
                    sideStart: change.sideStart + sideCursor,
                    sideLineCount,
                });
            }
            if (index < matchingLines.length) {
                baseCursor = baseMatch + 1;
                sideCursor = sideMatch + 1;
            }
        }

        return refined;
    });
}

export function buildMergeSessionDocument(
    baseContent: string,
    leftContent: string,
    rightContent: string,
    leftChanges: ConflictChange[],
    rightChanges: ConflictChange[],
    whitespaceMode: WhitespaceCompareMode = 'none'
): MergeSessionDocument {
    const baseLines = splitContentLineSlices(baseContent);
    const leftLines = splitContentLineSlices(leftContent);
    const rightLines = splitContentLineSlices(rightContent);
    const visibleLeftChanges = filterChangesByWhitespaceMode(baseLines, leftLines, leftChanges, whitespaceMode);
    const visibleRightChanges = filterChangesByWhitespaceMode(baseLines, rightLines, rightChanges, whitespaceMode);
    const components = buildChangeComponents(visibleLeftChanges, visibleRightChanges);
    const groups: MergeChangeGroup[] = [];
    const reviewRanges: MergeReviewRange[] = [];
    let previousBaseEnd = 0;
    let previousLeftEnd = 0;
    let previousRightEnd = 0;

    for (let index = 0; index < components.length; index++) {
        const component = components[index];
        const componentLeftChanges = component.filter((item) => item.side === 'left').map((item) => item.change);
        const componentRightChanges = component.filter((item) => item.side === 'right').map((item) => item.change);
        const allChanges = component.map((item) => item.change);
        const baseStart = Math.min(...allChanges.map((change) => change.baseStart));
        const baseEnd = Math.max(...allChanges.map((change) => change.baseStart + change.baseLineCount));
        const baseLineCount = baseEnd - baseStart;
        const contextLineCount = Math.max(0, baseStart - previousBaseEnd);
        const leftStart = previousLeftEnd + contextLineCount;
        const rightStart = previousRightEnd + contextLineCount;
        const leftLineCount =
            baseLineCount +
            componentLeftChanges.reduce((total, change) => total + change.sideLineCount - change.baseLineCount, 0);
        const rightLineCount =
            baseLineCount +
            componentRightChanges.reduce((total, change) => total + change.sideLineCount - change.baseLineCount, 0);
        const baseText = sliceLineRange(baseContent, baseLines, baseStart, baseLineCount);
        const leftText = applySideChanges(
            baseContent,
            baseLines,
            leftContent,
            leftLines,
            baseStart,
            baseEnd,
            componentLeftChanges
        );
        const rightText = applySideChanges(
            baseContent,
            baseLines,
            rightContent,
            rightLines,
            baseStart,
            baseEnd,
            componentRightChanges
        );
        const hasLeftChange = componentLeftChanges.length > 0;
        const hasRightChange = componentRightChanges.length > 0;
        const kind =
            hasLeftChange && hasRightChange
                ? leftText === rightText
                    ? 'identical'
                    : 'conflict'
                : hasLeftChange
                  ? 'left-only'
                  : 'right-only';
        const id = `change-${index}`;
        groups.push({
            id,
            baseStart,
            baseLineCount,
            leftStart,
            leftLineCount,
            rightStart,
            rightLineCount,
            baseText,
            leftText,
            rightText,
            hasLeftChange,
            hasRightChange,
            kind,
        });
        reviewRanges.push({
            groupId: id,
            startOffset: getLineBoundaryOffset(baseLines, baseContent.length, baseStart),
            endOffset: getLineBoundaryOffset(baseLines, baseContent.length, baseEnd),
            leftDecision: hasLeftChange ? 'pending' : null,
            rightDecision: hasRightChange ? 'pending' : null,
            lastAppliedSide: null,
        });
        previousBaseEnd = baseEnd;
        previousLeftEnd = leftStart + leftLineCount;
        previousRightEnd = rightStart + rightLineCount;
    }

    return {
        resultText: baseContent,
        groups,
        reviewRanges,
    };
}

export function getMergeGroupApplyMode(
    content: string,
    range: MergeReviewRange,
    group: MergeChangeGroup,
    side: MergeReviewSide
): 'replace' | 'append' | 'preserve' {
    const otherDecision = side === 'left' ? range.rightDecision : range.leftDecision;
    if (group.kind !== 'conflict' || otherDecision !== 'applied') {
        return 'replace';
    }

    const sideText = side === 'left' ? group.leftText : group.rightText;
    if (!sideText) {
        return 'preserve';
    }
    return content.slice(range.startOffset, range.endOffset) ? 'append' : 'replace';
}

export function applyMergeGroupDecision(
    content: string,
    ranges: MergeReviewRange[],
    group: MergeChangeGroup,
    side: MergeReviewSide | 'both',
    decision: Exclude<MergeReviewDecision, 'pending'>
): { content: string; ranges: MergeReviewRange[] } {
    const target = ranges.find((range) => range.groupId === group.id);
    if (!target) {
        return { content, ranges };
    }

    if (side === 'both') {
        if (decision !== 'manual') {
            return { content, ranges };
        }
        return {
            content,
            ranges: ranges.map((range) =>
                range.groupId === group.id
                    ? {
                          ...range,
                          leftDecision: range.leftDecision === 'pending' ? 'manual' : range.leftDecision,
                          rightDecision: range.rightDecision === 'pending' ? 'manual' : range.rightDecision,
                      }
                    : range
            ),
        };
    }

    const sideDecision = side === 'left' ? target.leftDecision : target.rightDecision;
    if (sideDecision === null || decision === 'manual') {
        return { content, ranges };
    }

    const otherSide: MergeReviewSide = side === 'left' ? 'right' : 'left';
    const otherDecision = otherSide === 'left' ? target.leftDecision : target.rightDecision;
    const sideText = side === 'left' ? group.leftText : group.rightText;
    const otherText = otherSide === 'left' ? group.leftText : group.rightText;
    const applyMode = getMergeGroupApplyMode(content, target, group, side);
    let replacement: string | undefined;
    let lastAppliedSide = target.lastAppliedSide;

    if (decision === 'applied') {
        const currentText = content.slice(target.startOffset, target.endOffset);
        if (applyMode === 'append') {
            const lineSeparator =
                [currentText, sideText, group.baseText]
                    .map((text) => text.match(/\r\n|\n|\r/)?.[0])
                    .find((separator): separator is string => Boolean(separator)) ?? '\n';
            replacement =
                /[\r\n]$/.test(currentText) || /^[\r\n]/.test(sideText)
                    ? currentText + sideText
                    : currentText + lineSeparator + sideText;
        } else if (applyMode === 'preserve') {
            replacement = currentText;
        } else {
            replacement = sideText;
        }
        lastAppliedSide = side;
    } else if (sideDecision === 'applied') {
        if (otherDecision === 'applied') {
            replacement = otherText;
            lastAppliedSide = otherSide;
        } else {
            replacement = group.baseText;
            lastAppliedSide = null;
        }
    }

    const nextContent =
        replacement === undefined
            ? content
            : content.slice(0, target.startOffset) + replacement + content.slice(target.endOffset);
    const delta = replacement === undefined ? 0 : replacement.length - (target.endOffset - target.startOffset);
    return {
        content: nextContent,
        ranges: ranges.map((range) => {
            if (range.groupId === group.id) {
                return {
                    ...range,
                    endOffset: replacement === undefined ? range.endOffset : range.startOffset + replacement.length,
                    leftDecision: side === 'left' ? decision : range.leftDecision,
                    rightDecision: side === 'right' ? decision : range.rightDecision,
                    lastAppliedSide,
                };
            }
            if (delta !== 0 && range.startOffset >= target.endOffset) {
                return {
                    ...range,
                    startOffset: range.startOffset + delta,
                    endOffset: range.endOffset + delta,
                };
            }
            return range;
        }),
    };
}

export function isMergeReviewRangePending(range: MergeReviewRange): boolean {
    return range.leftDecision === 'pending' || range.rightDecision === 'pending';
}

function changeTouchesRange(change: { rangeOffset: number; rangeLength: number }, range: MergeReviewRange): boolean {
    const changeEnd = change.rangeOffset + change.rangeLength;
    if (change.rangeLength === 0) {
        if (range.startOffset === range.endOffset) {
            return change.rangeOffset === range.startOffset;
        }
        return change.rangeOffset >= range.startOffset && change.rangeOffset < range.endOffset;
    }
    if (range.startOffset === range.endOffset) {
        return change.rangeOffset <= range.startOffset && changeEnd > range.endOffset;
    }
    return change.rangeOffset < range.endOffset && changeEnd > range.startOffset;
}

function transformOffset(
    offset: number,
    affinity: 'start' | 'empty-end',
    changes: Array<{ rangeOffset: number; rangeLength: number; text: string }>
): number {
    let delta = 0;
    for (const change of changes) {
        const changeStart = change.rangeOffset;
        const changeEnd = change.rangeOffset + change.rangeLength;
        if (offset < changeStart) {
            break;
        }
        if (offset > changeEnd) {
            delta += change.text.length - change.rangeLength;
            continue;
        }
        if (offset === changeStart) {
            if (affinity === 'empty-end' && change.rangeLength === 0) {
                delta += change.text.length;
                continue;
            }
            return changeStart + delta;
        }
        if (offset === changeEnd && change.rangeLength > 0) {
            return changeStart + delta + change.text.length;
        }
        return changeStart + delta;
    }
    return offset + delta;
}

export function applyMergeContentChanges(
    ranges: MergeReviewRange[],
    rawChanges: Array<{ rangeOffset: number; rangeLength: number; text: string }>
): { ranges: MergeReviewRange[]; touchedGroupIds: string[] } {
    const changes = [...rawChanges].sort((left, right) => left.rangeOffset - right.rangeOffset);
    const touched = new Set<string>();
    for (const change of changes) {
        const touchingRanges = ranges.filter((range) => changeTouchesRange(change, range));
        if (change.rangeLength === 0) {
            const target = touchingRanges.find((range) => range.startOffset < range.endOffset) ?? touchingRanges[0];
            if (target) {
                touched.add(target.groupId);
            }
            continue;
        }
        for (const range of touchingRanges) {
            touched.add(range.groupId);
        }
    }
    const touchedGroupIds = ranges.filter((range) => touched.has(range.groupId)).map((range) => range.groupId);
    return {
        ranges: ranges.map((range) => {
            const isTouched = touched.has(range.groupId);
            const isEmpty = range.startOffset === range.endOffset;
            return {
                ...range,
                startOffset: transformOffset(range.startOffset, 'start', changes),
                endOffset: transformOffset(range.endOffset, isEmpty && isTouched ? 'empty-end' : 'start', changes),
                leftDecision: isTouched && range.leftDecision !== null ? 'pending' : range.leftDecision,
                rightDecision: isTouched && range.rightDecision !== null ? 'pending' : range.rightDecision,
                lastAppliedSide: isTouched ? null : range.lastAppliedSide,
            };
        }),
        touchedGroupIds,
    };
}

export function getMergeTextRange(content: string, startOffset: number, endOffset: number): MergeTextRange {
    const lineStarts = getLineStartOffsets(content);
    const visualEndOffset =
        endOffset > startOffset && /[\r\n]/.test(content[endOffset - 1])
            ? endOffset - (content[endOffset - 1] === '\n' && content[endOffset - 2] === '\r' ? 2 : 1)
            : endOffset;
    const start = getPositionAtOffset(lineStarts, startOffset);
    const end = getPositionAtOffset(lineStarts, Math.max(startOffset, visualEndOffset));
    return {
        startLine: start.line,
        startColumn: start.column,
        endLine: end.line,
        endColumn: end.column,
    };
}

export function getContentLineCount(content: string): number {
    return splitContentLineSlices(content).length;
}

export function buildMergeSideInlineDiffRanges(
    groups: MergeChangeGroup[],
    side: 'current' | 'incoming',
    whitespaceMode: WhitespaceCompareMode = 'none'
): ConflictInlineDiffRange[] {
    const ranges: ConflictInlineDiffRange[] = [];
    for (const group of groups) {
        const hasChange = side === 'current' ? group.hasLeftChange : group.hasRightChange;
        if (!hasChange) {
            continue;
        }
        const text = side === 'current' ? group.leftText : group.rightText;
        const startLine = side === 'current' ? group.leftStart : group.rightStart;
        const lineStarts = getLineStartOffsets(text);
        let localOffset = 0;
        for (const segment of buildInlineDiffSegments(text, group.baseText, whitespaceMode)) {
            const segmentStart = localOffset;
            localOffset += segment.text.length;
            if (!segment.changed || !segment.text) {
                continue;
            }
            const start = getPositionAtOffset(lineStarts, segmentStart);
            const end = getPositionAtOffset(lineStarts, localOffset);
            ranges.push({
                conflictId: group.id,
                side,
                startLine: startLine + start.line,
                startColumn: start.column,
                endLine: startLine + end.line,
                endColumn: end.column,
            });
        }
    }
    return ranges;
}

export function buildConflictInlineDiffRanges(
    content: string,
    baseContent: string,
    whitespaceMode: WhitespaceCompareMode = 'none'
): ConflictInlineDiffRange[] {
    const lineStarts = getLineStartOffsets(content);
    const parts = parseConflictDocument(content, baseContent);
    const ranges: ConflictInlineDiffRange[] = [];

    for (const part of parts) {
        if (part.type !== 'conflict') {
            continue;
        }

        const baseText = getConflictBaseText(part.block);
        const sides = [
            {
                side: 'current' as const,
                text: part.block.currentText,
                startOffset: part.block.currentStartOffset,
            },
            {
                side: 'incoming' as const,
                text: part.block.incomingText,
                startOffset: part.block.incomingStartOffset,
            },
        ];

        for (const side of sides) {
            let localOffset = 0;
            for (const segment of buildInlineDiffSegments(side.text, baseText, whitespaceMode)) {
                const startOffset = side.startOffset + localOffset;
                localOffset += segment.text.length;
                if (!segment.changed || !segment.text) {
                    continue;
                }

                const start = getPositionAtOffset(lineStarts, startOffset);
                const end = getPositionAtOffset(lineStarts, side.startOffset + localOffset);
                ranges.push({
                    conflictId: part.id,
                    side: side.side,
                    startLine: start.line,
                    startColumn: start.column,
                    endLine: end.line,
                    endColumn: end.column,
                });
            }
        }
    }

    return ranges;
}

export function parseConflictBlocks(content: string): ConflictBlock[] {
    return parseConflictMarkerBlocks(content);
}

export function hasConflictBlocks(content: string): boolean {
    return parseConflictBlocks(content).length > 0;
}

export function getMergeResultReviewState(
    originalResult: string,
    result: string,
    resolutionAcknowledged: boolean
): MergeResultReviewState {
    const conflictMarkerCount = parseConflictBlocks(result).length;
    return {
        conflictMarkerCount,
        isResolutionConfirmed: conflictMarkerCount === 0 && (resolutionAcknowledged || result !== originalResult),
    };
}

export function getConflictResolutionText(block: ConflictBlock, choice: ConflictResolutionChoice): string {
    if (choice === 'base') {
        return getConflictBaseText(block);
    }
    if (choice === 'current') {
        return block.currentText;
    }
    if (choice === 'incoming') {
        return block.incomingText;
    }
    return block.currentText + block.incomingText;
}

export function applyConflictBlockResolution(
    content: string,
    blockId: string,
    choice: ConflictResolutionChoice
): string {
    const block = parseConflictBlocks(content).find((candidate) => candidate.id === blockId);
    if (!block) {
        return content;
    }

    const replacement = getConflictResolutionText(block, choice);
    return content.slice(0, block.startOffset) + replacement + content.slice(block.endOffset);
}

function inferBaseTextForConflict(
    baseContent: string,
    parts: ConflictDocumentPart[],
    conflictIndex: number,
    searchOffset: number
): { text: string; nextOffset: number } {
    const previousText =
        parts
            .slice(0, conflictIndex)
            .reverse()
            .find((part) => part.type === 'text')?.text ?? '';
    const nextText = parts.slice(conflictIndex + 1).find((part) => part.type === 'text')?.text ?? '';

    let startOffset = searchOffset;
    if (previousText) {
        const previousIndex = baseContent.indexOf(previousText, searchOffset);
        if (previousIndex !== -1) {
            startOffset = previousIndex + previousText.length;
        }
    }

    let endOffset = baseContent.length;
    if (nextText) {
        const nextIndex = baseContent.indexOf(nextText, startOffset);
        if (nextIndex !== -1) {
            endOffset = nextIndex;
        }
    }

    if (endOffset < startOffset) {
        return { text: '', nextOffset: searchOffset };
    }

    return {
        text: baseContent.slice(startOffset, endOffset),
        nextOffset: endOffset,
    };
}

export function parseConflictDocument(content: string, baseContent = ''): ConflictDocumentPart[] {
    const blocks = parseConflictBlocks(content);
    if (blocks.length === 0) {
        return [
            {
                type: 'text',
                id: 'text-0',
                text: content,
            },
        ];
    }

    const parts: ConflictDocumentPart[] = [];
    let offset = 0;
    let textIndex = 0;

    for (const block of blocks) {
        if (block.startOffset > offset) {
            parts.push({
                type: 'text',
                id: `text-${textIndex}`,
                text: content.slice(offset, block.startOffset),
            });
            textIndex++;
        }

        parts.push({
            type: 'conflict',
            id: block.id,
            block,
        });
        offset = block.endOffset;
    }

    if (offset < content.length) {
        parts.push({
            type: 'text',
            id: `text-${textIndex}`,
            text: content.slice(offset),
        });
    }

    if (baseContent) {
        let searchOffset = 0;
        for (let index = 0; index < parts.length; index++) {
            const part = parts[index];
            if (part.type !== 'conflict' || part.block.baseText) {
                continue;
            }

            const inferred = inferBaseTextForConflict(baseContent, parts, index, searchOffset);
            part.block.inferredBaseText = inferred.text;
            searchOffset = inferred.nextOffset;
        }
    }

    return parts;
}

export function getConflictBaseText(block: ConflictBlock): string {
    if (block.baseText) {
        return block.baseText;
    }

    return block.inferredBaseText ?? '';
}

export function getUnresolvedConflictIds(
    parts: ConflictDocumentPart[],
    resolutions: ConflictResolutionState
): string[] {
    return parts
        .filter((part): part is Extract<ConflictDocumentPart, { type: 'conflict' }> => part.type === 'conflict')
        .filter((part) => !Object.prototype.hasOwnProperty.call(resolutions, part.id))
        .map((part) => part.id);
}

export function buildConflictDocumentResult(parts: ConflictDocumentPart[], resolutions: ConflictResolutionMap): string {
    return parts
        .map((part) => {
            if (part.type === 'text') {
                return part.text;
            }

            if (Object.prototype.hasOwnProperty.call(resolutions, part.id)) {
                return resolutions[part.id];
            }

            return part.block.markerText;
        })
        .join('');
}
