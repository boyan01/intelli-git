export type ConflictResolutionChoice = 'base' | 'current' | 'incoming' | 'both';

export interface ConflictBlock {
    id: string;
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
    currentLabel: string;
    baseLabel: string;
    incomingLabel: string;
    currentText: string;
    baseText: string;
    incomingText: string;
    markerText: string;
    inferredBaseText?: string;
}

export interface InlineDiffSegment {
    text: string;
    changed: boolean;
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

export type MergeTextKind = 'unchanged' | 'current' | 'incoming' | 'both';
export type NonConflictingChangeMode = 'all' | 'current' | 'incoming';
export type WhitespaceCompareMode = 'strict' | 'ignore';

export interface MergeSideContent {
    exists: boolean;
    content: string;
}

export interface MergePaneRange {
    id: string;
    startLine: number;
    endLine: number;
}

export interface ThreeWayMergePaneDocument {
    leftText: string;
    resultText: string;
    rightText: string;
    leftConflictRanges: MergePaneRange[];
    resultConflictRanges: MergePaneRange[];
    rightConflictRanges: MergePaneRange[];
}

export type ThreeWayMergePart =
    | {
        type: 'text';
        id: string;
        baseText: string;
        currentText: string;
        incomingText: string;
        resultText: string;
        kind: MergeTextKind;
    }
    | {
        type: 'conflict';
        id: string;
        baseText: string;
        currentText: string;
        incomingText: string;
    };

interface LineSlice {
    startOffset: number;
    endOffset: number;
    text: string;
}

interface LineEdit {
    start: number;
    end: number;
    replacementStart: number;
    replacementEnd: number;
}

interface ContentLine {
    lineNumber: number;
    startOffset: number;
    endOffset: number;
    body: string;
    text: string;
}

interface PaneTextBuilder {
    chunks: string[];
    length: number;
    lineCount: number;
}

const CURRENT_MARKER = '<<<<<<<';
const BASE_MARKER = '|||||||';
const SEPARATOR_MARKER = '=======';
const INCOMING_MARKER = '>>>>>>>';

function tokenizeInlineDiffText(text: string): string[] {
    return text.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]+/g) ?? [];
}

export function buildInlineDiffSegments(text: string, baseText: string): InlineDiffSegment[] {
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

    const unchangedTokenIndexes = new Set<number>();
    for (const [, tokenIndex] of computeLcsPairs(baseTokens, tokens)) {
        unchangedTokenIndexes.add(tokenIndex);
    }

    const segments: InlineDiffSegment[] = [];
    for (let index = 0; index < tokens.length; index++) {
        const changed = !unchangedTokenIndexes.has(index);
        const previous = segments[segments.length - 1];
        if (previous?.changed === changed) {
            previous.text += tokens[index];
        } else {
            segments.push({ text: tokens[index], changed });
        }
    }

    return segments;
}

function splitContentLines(content: string): ContentLine[] {
    const lines: ContentLine[] = [];
    let offset = 0;
    let lineNumber = 1;

    while (offset < content.length) {
        const startOffset = offset;
        while (offset < content.length && content[offset] !== '\n' && content[offset] !== '\r') {
            offset++;
        }

        const body = content.slice(startOffset, offset);
        let eol = '';
        if (offset < content.length) {
            if (content[offset] === '\r' && content[offset + 1] === '\n') {
                eol = '\r\n';
                offset += 2;
            } else {
                eol = content[offset];
                offset++;
            }
        }

        const text = body + eol;
        lines.push({
            lineNumber,
            startOffset,
            endOffset: startOffset + text.length,
            body,
            text
        });
        lineNumber++;
    }

    return lines;
}

function splitLineSlices(content: string): LineSlice[] {
    const lines = splitContentLines(content);
    if (lines.length === 0) {
        return [];
    }

    return lines.map(line => ({
        startOffset: line.startOffset,
        endOffset: line.endOffset,
        text: line.text
    }));
}

function sliceLines(lines: LineSlice[], start: number, end: number): string {
    return lines.slice(start, end).map(line => line.text).join('');
}

function offsetAtLine(lines: LineSlice[], lineIndex: number, contentLength: number): number {
    if (lineIndex <= 0) {
        return 0;
    }
    if (lineIndex >= lines.length) {
        return contentLength;
    }

    return lines[lineIndex].startOffset;
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

function normalizeLineForWhitespaceCompare(text: string, whitespaceMode: WhitespaceCompareMode): string {
    if (whitespaceMode === 'ignore') {
        return text.replace(/\s+/g, '');
    }
    return text;
}

function textMatchesForWhitespaceCompare(left: string, right: string, whitespaceMode: WhitespaceCompareMode): boolean {
    if (whitespaceMode === 'ignore') {
        return left.replace(/\s+/g, '') === right.replace(/\s+/g, '');
    }
    return left === right;
}

function diffLineEdits(baseLines: LineSlice[], sideLines: LineSlice[], whitespaceMode: WhitespaceCompareMode): LineEdit[] {
    const pairs = computeLcsPairs(
        baseLines.map(line => normalizeLineForWhitespaceCompare(line.text, whitespaceMode)),
        sideLines.map(line => normalizeLineForWhitespaceCompare(line.text, whitespaceMode))
    );
    const edits: LineEdit[] = [];
    let baseCursor = 0;
    let sideCursor = 0;

    for (const [baseIndex, sideIndex] of pairs) {
        if (baseCursor !== baseIndex || sideCursor !== sideIndex) {
            edits.push({
                start: baseCursor,
                end: baseIndex,
                replacementStart: sideCursor,
                replacementEnd: sideIndex
            });
        }
        baseCursor = baseIndex + 1;
        sideCursor = sideIndex + 1;
    }

    if (baseCursor !== baseLines.length || sideCursor !== sideLines.length) {
        edits.push({
            start: baseCursor,
            end: baseLines.length,
            replacementStart: sideCursor,
            replacementEnd: sideLines.length
        });
    }

    return edits.filter(edit => edit.start !== edit.end || edit.replacementStart !== edit.replacementEnd);
}

function editBaseStart(edit: LineEdit | undefined): number {
    if (!edit) {
        return Number.POSITIVE_INFINITY;
    }
    return edit.start;
}

function editsOverlap(left: LineEdit, right: LineEdit): boolean {
    if (left.start === left.end && right.start === right.end) {
        return left.start === right.start;
    }
    return left.start < right.end && right.start < left.end;
}

function editIntersectsRange(edit: LineEdit, start: number, end: number): boolean {
    if (edit.start === edit.end) {
        return edit.start >= start && edit.start <= end;
    }

    return edit.start < end && edit.end > start;
}

function buildSideTextForBaseRange(
    baseLines: LineSlice[],
    sideLines: LineSlice[],
    edits: LineEdit[],
    start: number,
    end: number
): string {
    let cursor = start;
    const chunks: string[] = [];

    for (const edit of edits) {
        if (!editIntersectsRange(edit, start, end)) {
            continue;
        }

        const editStart = Math.max(edit.start, start);
        const editEnd = Math.min(edit.end, end);
        if (cursor < editStart) {
            chunks.push(sliceLines(baseLines, cursor, editStart));
        }
        chunks.push(sliceLines(sideLines, edit.replacementStart, edit.replacementEnd));
        cursor = Math.max(cursor, editEnd);
    }

    if (cursor < end) {
        chunks.push(sliceLines(baseLines, cursor, end));
    }

    return chunks.join('');
}

function collectConflictGroup(
    currentEdits: LineEdit[],
    incomingEdits: LineEdit[],
    currentEditIndex: number,
    incomingEditIndex: number
): { start: number; end: number; nextCurrentEditIndex: number; nextIncomingEditIndex: number } {
    let start = Math.min(currentEdits[currentEditIndex].start, incomingEdits[incomingEditIndex].start);
    let end = Math.max(currentEdits[currentEditIndex].end, incomingEdits[incomingEditIndex].end);
    let changed = true;

    while (changed) {
        changed = false;

        for (let index = currentEditIndex; index < currentEdits.length; index++) {
            const edit = currentEdits[index];
            if (edit.start > end) {
                break;
            }
            if (editIntersectsRange(edit, start, end)) {
                const nextStart = Math.min(start, edit.start);
                const nextEnd = Math.max(end, edit.end);
                if (nextStart !== start || nextEnd !== end) {
                    start = nextStart;
                    end = nextEnd;
                    changed = true;
                }
            }
        }

        for (let index = incomingEditIndex; index < incomingEdits.length; index++) {
            const edit = incomingEdits[index];
            if (edit.start > end) {
                break;
            }
            if (editIntersectsRange(edit, start, end)) {
                const nextStart = Math.min(start, edit.start);
                const nextEnd = Math.max(end, edit.end);
                if (nextStart !== start || nextEnd !== end) {
                    start = nextStart;
                    end = nextEnd;
                    changed = true;
                }
            }
        }
    }

    let nextCurrentEditIndex = currentEditIndex;
    while (nextCurrentEditIndex < currentEdits.length && editIntersectsRange(currentEdits[nextCurrentEditIndex], start, end)) {
        nextCurrentEditIndex++;
    }

    let nextIncomingEditIndex = incomingEditIndex;
    while (nextIncomingEditIndex < incomingEdits.length && editIntersectsRange(incomingEdits[nextIncomingEditIndex], start, end)) {
        nextIncomingEditIndex++;
    }

    return { start, end, nextCurrentEditIndex, nextIncomingEditIndex };
}

function buildTextPart(
    id: string,
    kind: MergeTextKind,
    baseText: string,
    currentText: string,
    incomingText: string,
    resultText: string
): ThreeWayMergePart {
    return {
        type: 'text',
        id,
        kind,
        baseText,
        currentText,
        incomingText,
        resultText
    };
}



function createPaneTextBuilder(): PaneTextBuilder {
    return {
        chunks: [],
        length: 0,
        lineCount: 1
    };
}



export function buildThreeWayMergeDocument(
    baseContent: string,
    currentContent: string,
    incomingContent: string,
    whitespaceMode: WhitespaceCompareMode = 'strict'
): ThreeWayMergePart[] {
    const baseLines = splitLineSlices(baseContent);
    const currentLines = splitLineSlices(currentContent);
    const incomingLines = splitLineSlices(incomingContent);
    const currentEdits = diffLineEdits(baseLines, currentLines, whitespaceMode);
    const incomingEdits = diffLineEdits(baseLines, incomingLines, whitespaceMode);
    const parts: ThreeWayMergePart[] = [];
    let baseCursor = 0;
    let currentEditIndex = 0;
    let incomingEditIndex = 0;
    let textIndex = 0;
    let conflictIndex = 0;

    function pushUnchanged(end: number) {
        if (end <= baseCursor) {
            return;
        }
        const text = sliceLines(baseLines, baseCursor, end);
        parts.push(buildTextPart(`text-${textIndex++}`, 'unchanged', text, text, text, text));
        baseCursor = end;
    }

    while (baseCursor < baseLines.length || currentEditIndex < currentEdits.length || incomingEditIndex < incomingEdits.length) {
        const currentEdit = currentEdits[currentEditIndex];
        const incomingEdit = incomingEdits[incomingEditIndex];
        const nextEditStart = Math.min(editBaseStart(currentEdit), editBaseStart(incomingEdit));

        if (baseCursor < nextEditStart && nextEditStart !== Number.POSITIVE_INFINITY) {
            pushUnchanged(nextEditStart);
            continue;
        }

        if (!currentEdit && !incomingEdit) {
            pushUnchanged(baseLines.length);
            break;
        }

        if (currentEdit && !incomingEdit) {
            const baseText = sliceLines(baseLines, currentEdit.start, currentEdit.end);
            const currentText = sliceLines(currentLines, currentEdit.replacementStart, currentEdit.replacementEnd);
            parts.push(buildTextPart(`text-${textIndex++}`, 'current', baseText, currentText, baseText, currentText));
            baseCursor = currentEdit.end;
            currentEditIndex++;
            continue;
        }

        if (!currentEdit && incomingEdit) {
            const baseText = sliceLines(baseLines, incomingEdit.start, incomingEdit.end);
            const incomingText = sliceLines(incomingLines, incomingEdit.replacementStart, incomingEdit.replacementEnd);
            parts.push(buildTextPart(`text-${textIndex++}`, 'incoming', baseText, baseText, incomingText, incomingText));
            baseCursor = incomingEdit.end;
            incomingEditIndex++;
            continue;
        }

        if (!currentEdit || !incomingEdit) {
            break;
        }

        if (!editsOverlap(currentEdit, incomingEdit)) {
            if (currentEdit.start <= incomingEdit.start) {
                const baseText = sliceLines(baseLines, currentEdit.start, currentEdit.end);
                const currentText = sliceLines(currentLines, currentEdit.replacementStart, currentEdit.replacementEnd);
                parts.push(buildTextPart(`text-${textIndex++}`, 'current', baseText, currentText, baseText, currentText));
                baseCursor = currentEdit.end;
                currentEditIndex++;
            } else {
                const baseText = sliceLines(baseLines, incomingEdit.start, incomingEdit.end);
                const incomingText = sliceLines(incomingLines, incomingEdit.replacementStart, incomingEdit.replacementEnd);
                parts.push(buildTextPart(`text-${textIndex++}`, 'incoming', baseText, baseText, incomingText, incomingText));
                baseCursor = incomingEdit.end;
                incomingEditIndex++;
            }
            continue;
        }

        const conflictGroup = collectConflictGroup(currentEdits, incomingEdits, currentEditIndex, incomingEditIndex);
        const currentStartOffset = offsetAtLine(baseLines, conflictGroup.start, baseContent.length);
        const currentEndOffset = offsetAtLine(baseLines, conflictGroup.end, baseContent.length);
        const baseText = baseContent.slice(currentStartOffset, currentEndOffset);
        const currentText = buildSideTextForBaseRange(baseLines, currentLines, currentEdits, conflictGroup.start, conflictGroup.end);
        const incomingText = buildSideTextForBaseRange(baseLines, incomingLines, incomingEdits, conflictGroup.start, conflictGroup.end);

        if (textMatchesForWhitespaceCompare(currentText, incomingText, whitespaceMode)) {
            parts.push(buildTextPart(`text-${textIndex++}`, 'both', baseText, currentText, incomingText, currentText));
        } else {
            parts.push({
                type: 'conflict',
                id: `conflict-${conflictIndex++}`,
                baseText,
                currentText,
                incomingText
            });
        }

        baseCursor = conflictGroup.end;
        currentEditIndex = conflictGroup.nextCurrentEditIndex;
        incomingEditIndex = conflictGroup.nextIncomingEditIndex;
    }

    return parts;
}

export function buildThreeWayMergeDocumentFromSides(
    base: MergeSideContent,
    current: MergeSideContent,
    incoming: MergeSideContent,
    whitespaceMode: WhitespaceCompareMode = 'strict'
): ThreeWayMergePart[] {
    if (base.exists && current.exists !== incoming.exists) {
        return [{
            type: 'conflict',
            id: 'conflict-0',
            baseText: base.content,
            currentText: current.exists ? current.content : '',
            incomingText: incoming.exists ? incoming.content : ''
        }];
    }

    return buildThreeWayMergeDocument(
        base.exists ? base.content : '',
        current.exists ? current.content : '',
        incoming.exists ? incoming.content : '',
        whitespaceMode
    );
}

export function buildThreeWayMergeResult(
    parts: ThreeWayMergePart[],
    resolutions: ConflictResolutionMap,
    nonConflictingMode: NonConflictingChangeMode = 'all'
): string {
    return parts.map(part => {
        if (part.type === 'text') {
            if (part.kind === 'current' && nonConflictingMode === 'incoming') {
                return part.baseText;
            }
            if (part.kind === 'incoming' && nonConflictingMode === 'current') {
                return part.baseText;
            }
            return part.resultText;
        }
        if (Object.prototype.hasOwnProperty.call(resolutions, part.id)) {
            return resolutions[part.id];
        }
        return part.baseText;
    }).join('');
}

function getOriginalLineCount(text: string): number {
    if (!text) {
        return 0;
    }
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        return lines.length - 1;
    }
    return lines.length;
}

function alignTextToLines(text: string, targetLineCount: number): string {
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    while (lines.length < targetLineCount) {
        lines.push('\u200B');
    }
    if (targetLineCount === 0) {
        return '';
    }
    return lines.join('\n') + '\n';
}

function appendAlignedPaneText(builder: PaneTextBuilder, text: string, lineCount: number): MergePaneRange {
    const startLine = builder.lineCount;
    builder.chunks.push(text);
    builder.length += text.length;
    builder.lineCount += lineCount;
    const endLine = Math.max(startLine, startLine + lineCount - 1);
    return {
        id: '',
        startLine,
        endLine
    };
}

export function buildThreeWayMergePaneDocument(
    parts: ThreeWayMergePart[],
    resolutions: ConflictResolutionMap,
    nonConflictingMode: NonConflictingChangeMode = 'all'
): ThreeWayMergePaneDocument {
    const leftPane = createPaneTextBuilder();
    const resultPane = createPaneTextBuilder();
    const rightPane = createPaneTextBuilder();
    const leftConflictRanges: MergePaneRange[] = [];
    const resultConflictRanges: MergePaneRange[] = [];
    const rightConflictRanges: MergePaneRange[] = [];

    for (const part of parts) {
        const resultText = buildThreeWayMergeResult([part], part.type === 'conflict' ? resolutions : {}, nonConflictingMode);
        const leftCount = getOriginalLineCount(part.currentText);
        const resultCount = getOriginalLineCount(resultText);
        const rightCount = getOriginalLineCount(part.incomingText);
        const maxLines = Math.max(leftCount, resultCount, rightCount);

        const alignedLeftText = alignTextToLines(part.currentText, maxLines);
        const alignedResultText = alignTextToLines(resultText, maxLines);
        const alignedRightText = alignTextToLines(part.incomingText, maxLines);

        const leftRange = appendAlignedPaneText(leftPane, alignedLeftText, maxLines);
        const resultRange = appendAlignedPaneText(resultPane, alignedResultText, maxLines);
        const rightRange = appendAlignedPaneText(rightPane, alignedRightText, maxLines);

        if (part.type === 'conflict') {
            leftConflictRanges.push({
                ...leftRange,
                id: part.id
            });
            resultConflictRanges.push({
                ...resultRange,
                id: part.id
            });
            rightConflictRanges.push({
                ...rightRange,
                id: part.id
            });
        }
    }

    return {
        leftText: leftPane.chunks.join(''),
        resultText: resultPane.chunks.join(''),
        rightText: rightPane.chunks.join(''),
        leftConflictRanges,
        resultConflictRanges,
        rightConflictRanges
    };
}

export function getUnresolvedThreeWayConflictIds(
    parts: ThreeWayMergePart[],
    resolutions: ConflictResolutionState
): string[] {
    return parts
        .filter((part): part is Extract<ThreeWayMergePart, { type: 'conflict' }> => part.type === 'conflict')
        .filter(part => !Object.prototype.hasOwnProperty.call(resolutions, part.id))
        .map(part => part.id);
}

function markerLabel(line: ContentLine, marker: string): string {
    return line.body.slice(marker.length).trim();
}

export function parseConflictBlocks(content: string): ConflictBlock[] {
    const lines = splitContentLines(content);
    const blocks: ConflictBlock[] = [];

    for (let index = 0; index < lines.length; index++) {
        const startLine = lines[index];
        if (!startLine.body.startsWith(CURRENT_MARKER)) {
            continue;
        }

        const currentLines: string[] = [];
        const baseLines: string[] = [];
        const incomingLines: string[] = [];
        let baseLabel = '';
        let incomingLabel = '';
        let section: 'current' | 'base' | 'incoming' = 'current';
        let endLine: ContentLine | undefined;

        for (index = index + 1; index < lines.length; index++) {
            const line = lines[index];

            if (section === 'current' && line.body.startsWith(BASE_MARKER)) {
                baseLabel = markerLabel(line, BASE_MARKER);
                section = 'base';
                continue;
            }

            if ((section === 'current' || section === 'base') && line.body.startsWith(SEPARATOR_MARKER)) {
                section = 'incoming';
                continue;
            }

            if (section === 'incoming' && line.body.startsWith(INCOMING_MARKER)) {
                incomingLabel = markerLabel(line, INCOMING_MARKER);
                endLine = line;
                break;
            }

            if (section === 'current') {
                currentLines.push(line.text);
            } else if (section === 'base') {
                baseLines.push(line.text);
            } else {
                incomingLines.push(line.text);
            }
        }

        if (!endLine) {
            break;
        }

        blocks.push({
            id: `conflict-${blocks.length}`,
            startOffset: startLine.startOffset,
            endOffset: endLine.endOffset,
            startLine: startLine.lineNumber,
            endLine: endLine.lineNumber,
            currentLabel: markerLabel(startLine, CURRENT_MARKER),
            baseLabel,
            incomingLabel,
            currentText: currentLines.join(''),
            baseText: baseLines.join(''),
            incomingText: incomingLines.join(''),
            markerText: content.slice(startLine.startOffset, endLine.endOffset)
        });
    }

    return blocks;
}

export function hasConflictBlocks(content: string): boolean {
    return parseConflictBlocks(content).length > 0;
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
    const block = parseConflictBlocks(content).find(candidate => candidate.id === blockId);
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
    const previousText = parts
        .slice(0, conflictIndex)
        .reverse()
        .find(part => part.type === 'text')?.text ?? '';
    const nextText = parts
        .slice(conflictIndex + 1)
        .find(part => part.type === 'text')?.text ?? '';

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
        nextOffset: endOffset
    };
}

export function parseConflictDocument(content: string, baseContent = ''): ConflictDocumentPart[] {
    const blocks = parseConflictBlocks(content);
    if (blocks.length === 0) {
        return [{
            type: 'text',
            id: 'text-0',
            text: content
        }];
    }

    const parts: ConflictDocumentPart[] = [];
    let offset = 0;
    let textIndex = 0;

    for (const block of blocks) {
        if (block.startOffset > offset) {
            parts.push({
                type: 'text',
                id: `text-${textIndex}`,
                text: content.slice(offset, block.startOffset)
            });
            textIndex++;
        }

        parts.push({
            type: 'conflict',
            id: block.id,
            block
        });
        offset = block.endOffset;
    }

    if (offset < content.length) {
        parts.push({
            type: 'text',
            id: `text-${textIndex}`,
            text: content.slice(offset)
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
        .filter(part => !Object.prototype.hasOwnProperty.call(resolutions, part.id))
        .map(part => part.id);
}

export function buildConflictDocumentResult(
    parts: ConflictDocumentPart[],
    resolutions: ConflictResolutionMap
): string {
    return parts.map(part => {
        if (part.type === 'text') {
            return part.text;
        }

        if (Object.prototype.hasOwnProperty.call(resolutions, part.id)) {
            return resolutions[part.id];
        }

        return part.block.markerText;
    }).join('');
}
