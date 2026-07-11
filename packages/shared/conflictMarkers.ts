export interface ConflictMarkerBlock {
    id: string;
    markerSize: number;
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
    currentStartOffset: number;
    currentEndOffset: number;
    incomingStartOffset: number;
    incomingEndOffset: number;
    currentLabel: string;
    baseLabel: string;
    incomingLabel: string;
    currentText: string;
    baseText: string;
    incomingText: string;
    markerText: string;
}

interface ContentLine {
    lineNumber: number;
    startOffset: number;
    endOffset: number;
    body: string;
    text: string;
}

interface MarkerLine {
    size: number;
    label: string;
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
        if (offset < content.length) {
            if (content[offset] === '\r' && content[offset + 1] === '\n') {
                offset += 2;
            } else {
                offset++;
            }
        }

        lines.push({
            lineNumber,
            startOffset,
            endOffset: offset,
            body,
            text: content.slice(startOffset, offset)
        });
        lineNumber++;
    }

    return lines;
}

function parseMarkerLine(body: string, marker: '<' | '|' | '=' | '>'): MarkerLine | null {
    let size = 0;
    while (body[size] === marker) {
        size++;
    }

    if (size < 7) {
        return null;
    }

    const suffix = body.slice(size);
    if (suffix && !/^[\t ]/.test(suffix)) {
        return null;
    }
    if (marker === '=' && suffix.trim()) {
        return null;
    }

    return {
        size,
        label: suffix.trim()
    };
}

export function parseConflictMarkerBlocks(content: string): ConflictMarkerBlock[] {
    const lines = splitContentLines(content);
    const blocks: ConflictMarkerBlock[] = [];

    for (let startIndex = 0; startIndex < lines.length; startIndex++) {
        const startLine = lines[startIndex];
        const startMarker = parseMarkerLine(startLine.body, '<');
        if (!startMarker) {
            continue;
        }

        const currentLines: string[] = [];
        const baseLines: string[] = [];
        const incomingLines: string[] = [];
        let baseLabel = '';
        let incomingLabel = '';
        let section: 'current' | 'base' | 'incoming' = 'current';
        let endIndex = -1;
        const currentStartOffset = startLine.endOffset;
        let currentEndOffset = currentStartOffset;
        let incomingStartOffset = currentStartOffset;
        let incomingEndOffset = currentStartOffset;

        for (let index = startIndex + 1; index < lines.length; index++) {
            const line = lines[index];
            const baseMarker = parseMarkerLine(line.body, '|');
            if (section === 'current' && baseMarker?.size === startMarker.size) {
                currentEndOffset = line.startOffset;
                baseLabel = baseMarker.label;
                section = 'base';
                continue;
            }

            const separatorMarker = parseMarkerLine(line.body, '=');
            if ((section === 'current' || section === 'base') && separatorMarker?.size === startMarker.size) {
                if (section === 'current') {
                    currentEndOffset = line.startOffset;
                }
                incomingStartOffset = line.endOffset;
                section = 'incoming';
                continue;
            }

            const incomingMarker = parseMarkerLine(line.body, '>');
            if (section === 'incoming' && incomingMarker?.size === startMarker.size) {
                incomingLabel = incomingMarker.label;
                incomingEndOffset = line.startOffset;
                endIndex = index;
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

        if (endIndex === -1) {
            continue;
        }

        const endLine = lines[endIndex];
        blocks.push({
            id: `conflict-${blocks.length}`,
            markerSize: startMarker.size,
            startOffset: startLine.startOffset,
            endOffset: endLine.endOffset,
            startLine: startLine.lineNumber,
            endLine: endLine.lineNumber,
            currentStartOffset,
            currentEndOffset,
            incomingStartOffset,
            incomingEndOffset,
            currentLabel: startMarker.label,
            baseLabel,
            incomingLabel,
            currentText: currentLines.join(''),
            baseText: baseLines.join(''),
            incomingText: incomingLines.join(''),
            markerText: content.slice(startLine.startOffset, endLine.endOffset)
        });
        startIndex = endIndex;
    }

    return blocks;
}

export function hasConflictMarkerBlocks(content: string): boolean {
    return parseConflictMarkerBlocks(content).length > 0;
}
