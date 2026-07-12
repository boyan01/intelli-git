import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConflictFileContent, RepositoryFileReference } from '@shared/messages';
import type { MergeEditorContext } from '@shared/webviewContext';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import {
    applyMergeContentChanges,
    applyMergeGroupDecision,
    buildLineAlignmentBlocks,
    buildMergeSessionDocument,
    buildMergeSideInlineDiffRanges,
    getContentLineCount,
    getMergeGroupApplyMode,
    getMergeTextRange,
    hasConflictBlocks,
    isMergeReviewRangePending,
    splitContentLines,
    type ConflictInlineDiffRange,
    type MergeChangeGroup,
    type MergeReviewDecision,
    type MergeReviewRange,
    type MergeReviewSide,
    type WhitespaceCompareMode
} from './conflictModel';
import type { CodeDecoration, CodeEditorContentChange, CodeViewZone } from './MonacoCodeEditor';
import {
    ThreeWayMergeEditor,
    type MergeBlockAction,
    type MergeDecorationType
} from './ThreeWayMergeEditor';
import styles from './ConflictResolver.module.css';

interface ConflictResolverProps {
    file: RepositoryFileReference;
    onClose: () => void;
}

interface ConflictResolverInitialState {
    conflictFile?: RepositoryFileReference;
}

interface ConflictResolverInitialSession {
    file: RepositoryFileReference;
}

type MergeHighlightMode = 'words' | 'lines';

interface MergePaneLayout {
    leftViewZones: CodeViewZone[];
    resultViewZones: CodeViewZone[];
    rightViewZones: CodeViewZone[];
    displayRows: Map<string, number>;
    resultLineCounts: Map<string, number>;
    resultTextRanges: Map<string, ReturnType<typeof getMergeTextRange>>;
}

interface MergeGapLayout {
    visualLineCount: number;
    leftViewZones: CodeViewZone[];
    resultViewZones: CodeViewZone[];
    rightViewZones: CodeViewZone[];
}

interface MergeHistoryEntry {
    resultDraft: string | null;
    resultExists: boolean;
    usingResolvedResult: boolean;
    groups: MergeChangeGroup[];
    reviewRanges: MergeReviewRange[];
    activeGroupId: string | null;
    whitespaceMode: WhitespaceCompareMode;
}

const MAX_MERGE_HISTORY_ENTRIES = 50;

function isSameFileReference(left: RepositoryFileReference, right: RepositoryFileReference): boolean {
    return left.path === right.path && (left.repoPath || '') === (right.repoPath || '');
}

function getFileReferenceKey(file: RepositoryFileReference): string {
    return `${file.repoPath || ''}\u0000${file.path}`;
}

function getShortObjectId(objectId: string | undefined): string {
    return objectId ? objectId.slice(0, 12) : '—';
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        target.isContentEditable ||
        Boolean(target.closest('.monaco-editor'));
}

function getInitialConflictSession(): ConflictResolverInitialSession | null {
    const state = window.initialState as ConflictResolverInitialState | null | undefined;
    const file = state?.conflictFile;
    if (!file?.path) {
        return null;
    }
    return {
        file: {
            path: file.path,
            repoPath: file.repoPath
        }
    };
}

function buildMergeEditorContext(
    file: RepositoryFileReference,
    section: MergeEditorContext['webviewSection'],
    group: MergeChangeGroup | undefined,
    range: MergeReviewRange | undefined,
    disabled: boolean
): MergeEditorContext {
    return {
        webviewSection: section,
        path: file.path,
        repoPath: file.repoPath,
        changeGroupId: group?.id,
        canReviewLeft: Boolean(group?.hasLeftChange && range?.leftDecision === 'pending' && !disabled),
        canReviewRight: Boolean(group?.hasRightChange && range?.rightDecision === 'pending' && !disabled),
        canMarkReviewed: Boolean(range && isMergeReviewRangePending(range) && !disabled),
        preventDefaultContextMenuItems: true
    };
}

function getMergeDecorationType(group: MergeChangeGroup): MergeDecorationType {
    if (group.kind === 'conflict') {
        return 'conflict';
    }
    if (group.baseLineCount === 0) {
        return 'inserted';
    }
    const changedLineCount = group.hasLeftChange ? group.leftLineCount : group.rightLineCount;
    return changedLineCount === 0 ? 'deleted' : 'modified';
}

function buildResolvedDecorations(
    startLine: number,
    endLine: number,
    decorationType: MergeDecorationType
): CodeDecoration[] {
    const typeClass = `intelli-git-merge-${decorationType}`;
    const topClasses = `${typeClass} intelli-git-merge-resolved-boundary intelli-git-merge-resolved-top${
        startLine === endLine ? ' intelli-git-merge-resolved-bottom' : ''
    }`;
    const topDecoration = {
        startLine,
        endLine: startLine,
        isWholeLine: true,
        className: topClasses,
        marginClassName: topClasses
    } satisfies CodeDecoration;
    if (startLine === endLine) {
        return [topDecoration];
    }
    const bottomClasses = `${typeClass} intelli-git-merge-resolved-boundary intelli-git-merge-resolved-bottom`;
    return [
        topDecoration,
        {
            startLine: endLine,
            endLine,
            isWholeLine: true,
            className: bottomClasses,
            marginClassName: bottomClasses
        }
    ];
}

function buildSideDecorations(
    groups: MergeChangeGroup[],
    ranges: MergeReviewRange[],
    side: 'current' | 'incoming',
    inlineRanges: ConflictInlineDiffRange[]
): CodeDecoration[] {
    const rangeById = new Map(ranges.map(range => [range.groupId, range]));
    const groupById = new Map(groups.map(group => [group.id, group]));
    const pendingGroupIds = new Set<string>();
    const wholeLineDecorations = groups.flatMap(group => {
        const hasChange = side === 'current' ? group.hasLeftChange : group.hasRightChange;
        const start = side === 'current' ? group.leftStart : group.rightStart;
        const lineCount = side === 'current' ? group.leftLineCount : group.rightLineCount;
        if (!hasChange || lineCount === 0) {
            return [];
        }
        const range = rangeById.get(group.id);
        const decision = side === 'current' ? range?.leftDecision : range?.rightDecision;
        const decorationType = getMergeDecorationType(group);
        if (decision !== 'pending') {
            return buildResolvedDecorations(start + 1, start + lineCount, decorationType);
        }
        pendingGroupIds.add(group.id);
        const typeClass = `intelli-git-merge-${decorationType}`;
        return [{
            startLine: start + 1,
            endLine: start + lineCount,
            isWholeLine: true,
            className: `${typeClass} intelli-git-merge-pending`,
            marginClassName: `${typeClass} intelli-git-merge-pending`,
            overviewRulerType: decorationType
        } satisfies CodeDecoration];
    });
    const inlineDecorations = inlineRanges.flatMap(range => {
        const group = groupById.get(range.conflictId);
        if (!group || !pendingGroupIds.has(group.id)) {
            return [];
        }
        return [{
            startLine: range.startLine,
            startColumn: range.startColumn,
            endLine: range.endLine,
            endColumn: range.endColumn,
            inlineClassName: `intelli-git-merge-${getMergeDecorationType(group)} intelli-git-merge-word`
        } satisfies CodeDecoration];
    });
    return [...wholeLineDecorations, ...inlineDecorations];
}

function buildResultDecorations(
    resultText: string,
    groups: MergeChangeGroup[],
    ranges: MergeReviewRange[]
): CodeDecoration[] {
    const groupById = new Map(groups.map(group => [group.id, group]));
    return ranges.flatMap(range => {
        const group = groupById.get(range.groupId);
        if (!group) {
            return [];
        }
        const textRange = getMergeTextRange(resultText, range.startOffset, range.endOffset);
        const decorationType = getMergeDecorationType(group);
        if (range.startOffset === range.endOffset) {
            return [];
        }
        if (!isMergeReviewRangePending(range)) {
            return buildResolvedDecorations(textRange.startLine, textRange.endLine, decorationType);
        }
        const typeClass = `intelli-git-merge-${decorationType}`;
        return [{
            ...textRange,
            isWholeLine: true,
            className: `${typeClass} intelli-git-merge-pending`,
            marginClassName: `${typeClass} intelli-git-merge-pending`
        } satisfies CodeDecoration];
    });
}

function getZoneClass(
    pane: 'left' | 'result' | 'right',
    group: MergeChangeGroup,
    range: MergeReviewRange
): string {
    const typeClass = `intelli-git-merge-${getMergeDecorationType(group)}`;
    if (pane === 'left' && group.hasLeftChange && group.leftLineCount === 0) {
        return `${typeClass} ${range.leftDecision === 'pending'
            ? 'intelli-git-merge-empty-pending'
            : 'intelli-git-merge-empty-resolved'}`;
    }
    if (pane === 'right' && group.hasRightChange && group.rightLineCount === 0) {
        return `${typeClass} ${range.rightDecision === 'pending'
            ? 'intelli-git-merge-empty-pending'
            : 'intelli-git-merge-empty-resolved'}`;
    }
    if (pane === 'result' && range.startOffset === range.endOffset) {
        return `${typeClass} ${isMergeReviewRangePending(range)
            ? 'intelli-git-merge-empty-pending'
            : 'intelli-git-merge-empty-resolved'}`;
    }
    return 'intelli-git-merge-padding-zone';
}

function buildMergeGapLayout(
    id: string,
    referenceLines: string[],
    resultLines: string[],
    panes: {
        leftStart: number;
        leftLineCount: number;
        resultStart: number;
        rightStart: number;
        rightLineCount: number;
    }
): MergeGapLayout {
    const leftViewZones: CodeViewZone[] = [];
    const resultViewZones: CodeViewZone[] = [];
    const rightViewZones: CodeViewZone[] = [];
    let sideExtraLineCount = 0;
    let resultExtraLineCount = 0;

    for (const [index, block] of buildLineAlignmentBlocks(referenceLines, resultLines).entries()) {
        const lineCountDelta = block.resultLineCount - block.referenceLineCount;
        if (lineCountDelta > 0) {
            const referenceEnd = block.referenceStart + block.referenceLineCount;
            const leftAfterLineNumber = panes.leftStart + Math.min(panes.leftLineCount, referenceEnd);
            const rightAfterLineNumber = panes.rightStart + Math.min(panes.rightLineCount, referenceEnd);
            leftViewZones.push({
                id: `${id}:alignment:${index}:left`,
                afterLineNumber: leftAfterLineNumber,
                heightInLines: lineCountDelta,
                className: 'intelli-git-merge-padding-zone'
            });
            rightViewZones.push({
                id: `${id}:alignment:${index}:right`,
                afterLineNumber: rightAfterLineNumber,
                heightInLines: lineCountDelta,
                className: 'intelli-git-merge-padding-zone'
            });
            sideExtraLineCount += lineCountDelta;
        } else if (lineCountDelta < 0) {
            const resultEnd = block.resultStart + block.resultLineCount;
            resultViewZones.push({
                id: `${id}:alignment:${index}:result`,
                afterLineNumber: panes.resultStart + Math.min(resultLines.length, resultEnd),
                heightInLines: -lineCountDelta,
                className: 'intelli-git-merge-padding-zone'
            });
            resultExtraLineCount -= lineCountDelta;
        }
    }

    const leftVisualLineCount = panes.leftLineCount + sideExtraLineCount;
    const resultVisualLineCount = resultLines.length + resultExtraLineCount;
    const rightVisualLineCount = panes.rightLineCount + sideExtraLineCount;
    const visualLineCount = Math.max(leftVisualLineCount, resultVisualLineCount, rightVisualLineCount);

    if (leftVisualLineCount < visualLineCount) {
        leftViewZones.push({
            id: `${id}:alignment:tail:left`,
            afterLineNumber: panes.leftStart + panes.leftLineCount,
            heightInLines: visualLineCount - leftVisualLineCount,
            className: 'intelli-git-merge-padding-zone'
        });
    }
    if (resultVisualLineCount < visualLineCount) {
        resultViewZones.push({
            id: `${id}:alignment:tail:result`,
            afterLineNumber: panes.resultStart + resultLines.length,
            heightInLines: visualLineCount - resultVisualLineCount,
            className: 'intelli-git-merge-padding-zone'
        });
    }
    if (rightVisualLineCount < visualLineCount) {
        rightViewZones.push({
            id: `${id}:alignment:tail:right`,
            afterLineNumber: panes.rightStart + panes.rightLineCount,
            heightInLines: visualLineCount - rightVisualLineCount,
            className: 'intelli-git-merge-padding-zone'
        });
    }

    return { visualLineCount, leftViewZones, resultViewZones, rightViewZones };
}

function buildMergePaneLayout(
    groups: MergeChangeGroup[],
    ranges: MergeReviewRange[],
    baseText: string,
    leftText: string,
    resultText: string,
    rightText: string
): MergePaneLayout {
    const leftViewZones: CodeViewZone[] = [];
    const resultViewZones: CodeViewZone[] = [];
    const rightViewZones: CodeViewZone[] = [];
    const displayRows = new Map<string, number>();
    const resultLineCounts = new Map<string, number>();
    const resultTextRanges = new Map<string, ReturnType<typeof getMergeTextRange>>();
    const rangeById = new Map(ranges.map(range => [range.groupId, range]));
    const baseLines = splitContentLines(baseText);
    const leftLines = splitContentLines(leftText);
    const resultLines = splitContentLines(resultText);
    const rightLines = splitContentLines(rightText);
    let previousBaseEnd = 0;
    let previousLeftEnd = 0;
    let previousResultEnd = 0;
    let previousRightEnd = 0;
    let displayRow = 0;

    for (const group of groups) {
        const range = rangeById.get(group.id);
        if (!range) {
            continue;
        }
        const resultRange = getMergeTextRange(resultText, range.startOffset, range.endOffset);
        resultTextRanges.set(group.id, resultRange);
        const resultLineCount = getContentLineCount(resultText.slice(range.startOffset, range.endOffset));
        resultLineCounts.set(group.id, resultLineCount);
        const resultStart = resultRange.startLine - 1;
        const gapLayout = buildMergeGapLayout(
            `${group.id}:before`,
            baseLines.slice(previousBaseEnd, group.baseStart),
            resultLines.slice(previousResultEnd, resultStart),
            {
                leftStart: previousLeftEnd,
                leftLineCount: Math.max(0, group.leftStart - previousLeftEnd),
                resultStart: previousResultEnd,
                rightStart: previousRightEnd,
                rightLineCount: Math.max(0, group.rightStart - previousRightEnd)
            }
        );
        leftViewZones.push(...gapLayout.leftViewZones);
        resultViewZones.push(...gapLayout.resultViewZones);
        rightViewZones.push(...gapLayout.rightViewZones);
        displayRow += gapLayout.visualLineCount;
        displayRows.set(group.id, displayRow);

        const maxLineCount = Math.max(1, group.leftLineCount, resultLineCount, group.rightLineCount);

        if (group.leftLineCount < maxLineCount) {
            leftViewZones.push({
                id: `${group.id}:left`,
                afterLineNumber: group.leftStart + group.leftLineCount,
                heightInLines: maxLineCount - group.leftLineCount,
                className: getZoneClass('left', group, range)
            });
        }
        if (resultLineCount < maxLineCount) {
            resultViewZones.push({
                id: `${group.id}:result`,
                afterLineNumber: resultStart + resultLineCount,
                heightInLines: maxLineCount - resultLineCount,
                className: getZoneClass('result', group, range)
            });
        }
        if (group.rightLineCount < maxLineCount) {
            rightViewZones.push({
                id: `${group.id}:right`,
                afterLineNumber: group.rightStart + group.rightLineCount,
                heightInLines: maxLineCount - group.rightLineCount,
                className: getZoneClass('right', group, range)
            });
        }

        displayRow += maxLineCount;
        previousBaseEnd = Math.max(previousBaseEnd, group.baseStart + group.baseLineCount);
        previousLeftEnd = Math.max(previousLeftEnd, group.leftStart + group.leftLineCount);
        previousResultEnd = Math.max(previousResultEnd, resultStart + resultLineCount);
        previousRightEnd = Math.max(previousRightEnd, group.rightStart + group.rightLineCount);
    }

    const trailingLayout = buildMergeGapLayout(
        'trailing',
        baseLines.slice(previousBaseEnd),
        resultLines.slice(previousResultEnd),
        {
            leftStart: previousLeftEnd,
            leftLineCount: Math.max(0, leftLines.length - previousLeftEnd),
            resultStart: previousResultEnd,
            rightStart: previousRightEnd,
            rightLineCount: Math.max(0, rightLines.length - previousRightEnd)
        }
    );
    leftViewZones.push(...trailingLayout.leftViewZones);
    resultViewZones.push(...trailingLayout.resultViewZones);
    rightViewZones.push(...trailingLayout.rightViewZones);

    return { leftViewZones, resultViewZones, rightViewZones, displayRows, resultLineCounts, resultTextRanges };
}

export function ConflictResolver({ file, onClose }: ConflictResolverProps) {
    const { t } = useTranslation();
    const [content, setContent] = useState<ConflictFileContent | null>(null);
    const [groups, setGroups] = useState<MergeChangeGroup[]>([]);
    const [reviewRanges, setReviewRanges] = useState<MergeReviewRange[]>([]);
    const [resultDraft, setResultDraft] = useState<string | null>(null);
    const [resultExists, setResultExists] = useState(false);
    const [usingResolvedResult, setUsingResolvedResult] = useState(false);
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
    const [whitespaceMode, setWhitespaceMode] = useState<WhitespaceCompareMode>('none');
    const [highlightMode, setHighlightMode] = useState<MergeHighlightMode>('words');
    const [changingWhitespaceMode, setChangingWhitespaceMode] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const undoHistoryRef = useRef<MergeHistoryEntry[]>([]);
    const redoHistoryRef = useRef<MergeHistoryEntry[]>([]);
    const visibleContent = content && isSameFileReference(content, file) ? content : null;
    const isContentLoading = loading || Boolean(content && !visibleContent);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setContent(null);
        setGroups([]);
        setReviewRanges([]);
        setResultDraft(null);
        setResultExists(false);
        setUsingResolvedResult(false);
        setActiveGroupId(null);
        setWhitespaceMode('none');
        setHighlightMode('words');
        setChangingWhitespaceMode(false);
        undoHistoryRef.current = [];
        redoHistoryRef.current = [];

        rpc.getConflictFileContent(file)
            .then(next => {
                if (cancelled) {
                    return;
                }
                const session = buildMergeSessionDocument(
                    next.base.content,
                    next.current.content,
                    next.incoming.content,
                    next.currentChanges,
                    next.incomingChanges
                );
                const preserveResolvedResult = next.resolvedCandidate;
                setContent(next);
                setGroups(preserveResolvedResult ? [] : session.groups);
                setReviewRanges(preserveResolvedResult ? [] : session.reviewRanges);
                setResultDraft(preserveResolvedResult ? next.result : session.resultText);
                setResultExists(preserveResolvedResult || next.base.exists);
                setUsingResolvedResult(preserveResolvedResult);
                setActiveGroupId(preserveResolvedResult ? null : session.groups[0]?.id ?? null);
            })
            .catch(e => {
                if (!cancelled) {
                    setError(e instanceof Error ? e : new Error(String(e)));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [file]);

    const resultText = resultDraft ?? '';
    const rangeById = useMemo(
        () => new Map(reviewRanges.map(range => [range.groupId, range])),
        [reviewRanges]
    );
    const pendingGroups = useMemo(
        () => groups.filter(group => {
            const range = rangeById.get(group.id);
            return range ? isMergeReviewRangePending(range) : false;
        }),
        [groups, rangeById]
    );
    const pendingGroupCount = pendingGroups.length;
    const activeGroup = groups.find(group => group.id === activeGroupId) ?? pendingGroups[0];
    const activeRange = activeGroup ? rangeById.get(activeGroup.id) : undefined;
    const activeGroupIndex = activeGroup ? groups.findIndex(group => group.id === activeGroup.id) : -1;
    const previousPendingGroup = activeGroupIndex > 0
        ? [...groups.slice(0, activeGroupIndex)].reverse().find(group => {
            const range = rangeById.get(group.id);
            return range ? isMergeReviewRangePending(range) : false;
        })
        : undefined;
    const nextPendingGroup = activeGroupIndex >= 0
        ? groups.slice(activeGroupIndex + 1).find(group => {
            const range = rangeById.get(group.id);
            return range ? isMergeReviewRangePending(range) : false;
        })
        : pendingGroups[0];
    const layout = useMemo(
        () => buildMergePaneLayout(
            groups,
            reviewRanges,
            visibleContent?.base.content ?? '',
            visibleContent?.current.content ?? '',
            resultText,
            visibleContent?.incoming.content ?? ''
        ),
        [groups, reviewRanges, resultText, visibleContent]
    );
    const leftInlineRanges = useMemo(
        () => highlightMode === 'words'
            ? buildMergeSideInlineDiffRanges(groups, 'current', whitespaceMode)
            : [],
        [groups, highlightMode, whitespaceMode]
    );
    const rightInlineRanges = useMemo(
        () => highlightMode === 'words'
            ? buildMergeSideInlineDiffRanges(groups, 'incoming', whitespaceMode)
            : [],
        [groups, highlightMode, whitespaceMode]
    );
    const leftDecorations = useMemo(
        () => buildSideDecorations(groups, reviewRanges, 'current', leftInlineRanges),
        [groups, leftInlineRanges, reviewRanges]
    );
    const rightDecorations = useMemo(
        () => buildSideDecorations(groups, reviewRanges, 'incoming', rightInlineRanges),
        [groups, reviewRanges, rightInlineRanges]
    );
    const resultDecorations = useMemo(
        () => buildResultDecorations(resultText, groups, reviewRanges),
        [groups, resultText, reviewRanges]
    );
    const currentBranchLabel = visibleContent?.currentLabel || t('Left');
    const incomingBranchLabel = visibleContent?.incomingLabel || t('Right');
    const acceptLeftFileLabel = visibleContent && !visibleContent.current.exists
        ? t('Accept Left (delete file)')
        : t('Accept Left');
    const acceptRightFileLabel = visibleContent && !visibleContent.incoming.exists
        ? t('Accept Right (delete file)')
        : t('Accept Right');
    const controlsDisabled = saving || isContentLoading || changingWhitespaceMode;
    const completeDisabled = controlsDisabled || !visibleContent || visibleContent.isBinary ||
        resultDraft === null || pendingGroupCount > 0 || hasConflictBlocks(resultText);
    const statusLabel = !visibleContent
        ? ''
        : visibleContent.kind !== 'text'
            ? ''
            : pendingGroupCount > 0
            ? t('{{count}} unresolved', { count: pendingGroupCount })
            : t('No conflicts remaining');

    const completeAction = useCallback(() => {
        rpcEvents.refresh.emit();
        onClose();
    }, [onClose]);

    const createMergeHistoryEntry = useCallback((): MergeHistoryEntry => ({
        resultDraft,
        resultExists,
        usingResolvedResult,
        groups,
        reviewRanges,
        activeGroupId,
        whitespaceMode
    }), [activeGroupId, groups, resultDraft, resultExists, reviewRanges, usingResolvedResult, whitespaceMode]);

    const restoreMergeHistoryEntry = useCallback((entry: MergeHistoryEntry) => {
        setResultDraft(entry.resultDraft);
        setResultExists(entry.resultExists);
        setUsingResolvedResult(entry.usingResolvedResult);
        setGroups(entry.groups);
        setReviewRanges(entry.reviewRanges);
        setActiveGroupId(entry.activeGroupId);
        setWhitespaceMode(entry.whitespaceMode);
        setError(null);
    }, []);

    const pushMergeHistory = useCallback(() => {
        undoHistoryRef.current.push(createMergeHistoryEntry());
        if (undoHistoryRef.current.length > MAX_MERGE_HISTORY_ENTRIES) {
            undoHistoryRef.current.shift();
        }
        redoHistoryRef.current = [];
    }, [createMergeHistoryEntry]);

    const undoMergeOperation = useCallback((): boolean => {
        const previous = undoHistoryRef.current.pop();
        if (!previous) {
            return false;
        }
        redoHistoryRef.current.push(createMergeHistoryEntry());
        if (redoHistoryRef.current.length > MAX_MERGE_HISTORY_ENTRIES) {
            redoHistoryRef.current.shift();
        }
        restoreMergeHistoryEntry(previous);
        return true;
    }, [createMergeHistoryEntry, restoreMergeHistoryEntry]);

    const redoMergeOperation = useCallback((): boolean => {
        const next = redoHistoryRef.current.pop();
        if (!next) {
            return false;
        }
        undoHistoryRef.current.push(createMergeHistoryEntry());
        if (undoHistoryRef.current.length > MAX_MERGE_HISTORY_ENTRIES) {
            undoHistoryRef.current.shift();
        }
        restoreMergeHistoryEntry(next);
        return true;
    }, [createMergeHistoryEntry, restoreMergeHistoryEntry]);

    const changeWhitespaceMode = useCallback(async (nextMode: WhitespaceCompareMode) => {
        if (!visibleContent || nextMode === whitespaceMode) {
            return;
        }

        const hasReviewedChanges = reviewRanges.some(range => (
            (range.leftDecision !== null && range.leftDecision !== 'pending') ||
            (range.rightDecision !== null && range.rightDecision !== 'pending')
        ));
        const hasResultEdits = usingResolvedResult || resultDraft !== visibleContent.base.content;
        setChangingWhitespaceMode(true);
        try {
            if ((hasReviewedChanges || hasResultEdits) && !await rpc.confirmConflictResolverRestart()) {
                return;
            }

            const session = buildMergeSessionDocument(
                visibleContent.base.content,
                visibleContent.current.content,
                visibleContent.incoming.content,
                visibleContent.currentChanges,
                visibleContent.incomingChanges,
                nextMode
            );
            pushMergeHistory();
            setWhitespaceMode(nextMode);
            setGroups(session.groups);
            setReviewRanges(session.reviewRanges);
            setResultDraft(session.resultText);
            setResultExists(visibleContent.base.exists);
            setUsingResolvedResult(false);
            setActiveGroupId(session.groups[0]?.id ?? null);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e : new Error(String(e)));
        } finally {
            setChangingWhitespaceMode(false);
        }
    }, [pushMergeHistory, resultDraft, reviewRanges, usingResolvedResult, visibleContent, whitespaceMode]);

    const acceptFileSide = useCallback(async (side: 'ours' | 'theirs') => {
        if (!visibleContent) {
            return;
        }
        setSaving(true);
        try {
            await rpc.resolveConflict({
                ...file,
                side,
                stageSignature: visibleContent.stageSignature,
                resultFingerprint: visibleContent.resultFingerprint
            });
            completeAction();
        } catch (e) {
            setError(e instanceof Error ? e : new Error(String(e)));
        } finally {
            setSaving(false);
        }
    }, [completeAction, file, visibleContent]);

    const applyGroupDecision = useCallback((
        group: MergeChangeGroup,
        side: MergeReviewSide | 'both',
        decision: Exclude<MergeReviewDecision, 'pending'>
    ) => {
        const range = reviewRanges.find(candidate => candidate.groupId === group.id);
        if (!range) {
            return;
        }
        const pendingDecision = side === 'both'
            ? isMergeReviewRangePending(range)
            : side === 'left'
                ? range.leftDecision === 'pending'
                : range.rightDecision === 'pending';
        if (!pendingDecision) {
            return;
        }
        pushMergeHistory();
        const next = applyMergeGroupDecision(resultText, reviewRanges, group, side, decision);
        setResultDraft(next.content);
        setReviewRanges(next.ranges);
        if (visibleContent && side !== 'both') {
            const sideDecision = side === 'left' ? range.leftDecision : range.rightDecision;
            const otherDecision = side === 'left' ? range.rightDecision : range.leftDecision;
            if (decision === 'applied') {
                const sideExists = side === 'left'
                    ? visibleContent.current.exists
                    : visibleContent.incoming.exists;
                setResultExists(group.kind === 'conflict' && otherDecision === 'applied'
                    ? resultExists || sideExists
                    : sideExists);
            } else if (sideDecision === 'applied') {
                setResultExists(otherDecision === 'applied'
                    ? side === 'left'
                        ? visibleContent.incoming.exists
                        : visibleContent.current.exists
                    : visibleContent.base.exists);
            }
        }
        setError(null);
    }, [pushMergeHistory, resultExists, resultText, reviewRanges, visibleContent]);

    useEffect(() => rpcEvents.conflictResolverAction.subscribe(request => {
        if (!isSameFileReference(request, file)) {
            return;
        }
        const group = groups.find(candidate => candidate.id === request.groupId);
        if (!group) {
            return;
        }
        switch (request.action) {
            case 'acceptLeft':
                applyGroupDecision(group, 'left', 'applied');
                break;
            case 'cancelLeft':
                applyGroupDecision(group, 'left', 'cancelled');
                break;
            case 'acceptRight':
                applyGroupDecision(group, 'right', 'applied');
                break;
            case 'cancelRight':
                applyGroupDecision(group, 'right', 'cancelled');
                break;
            case 'markReviewed':
                applyGroupDecision(group, 'both', 'manual');
                break;
        }
    }), [applyGroupDecision, file, groups]);

    const handleResultChange = useCallback((value: string, changes: CodeEditorContentChange[]) => {
        if (resultDraft === null || (value === resultDraft && changes.length === 0)) {
            return;
        }
        pushMergeHistory();
        const next = applyMergeContentChanges(reviewRanges, changes);
        setResultDraft(value);
        setResultExists(true);
        setReviewRanges(next.ranges);
        if (next.touchedGroupIds[0]) {
            setActiveGroupId(next.touchedGroupIds[0]);
        }
        setError(null);
    }, [pushMergeHistory, resultDraft, reviewRanges]);

    useEffect(() => {
        const handleUndoRedo = (event: KeyboardEvent) => {
            if (event.isComposing || event.altKey || (!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== 'z') {
                return;
            }
            const changed = event.shiftKey ? redoMergeOperation() : undoMergeOperation();
            if (!changed) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
        };
        window.addEventListener('keydown', handleUndoRedo, true);
        return () => window.removeEventListener('keydown', handleUndoRedo, true);
    }, [redoMergeOperation, undoMergeOperation]);

    const goToPreviousConflict = useCallback(() => {
        if (previousPendingGroup) {
            setActiveGroupId(previousPendingGroup.id);
        }
    }, [previousPendingGroup]);

    const goToNextConflict = useCallback(() => {
        if (nextPendingGroup) {
            setActiveGroupId(nextPendingGroup.id);
        }
    }, [nextPendingGroup]);

    const selectConflictByResultLine = useCallback((lineNumber: number) => {
        const group = groups.find(candidate => {
            const range = layout.resultTextRanges.get(candidate.id);
            return range && lineNumber >= range.startLine && lineNumber <= range.endLine;
        });
        if (group) {
            setActiveGroupId(group.id);
        }
    }, [groups, layout.resultTextRanges]);

    const selectConflictBySideLine = useCallback((side: MergeReviewSide, lineNumber: number) => {
        const group = groups.find(candidate => {
            const start = side === 'left' ? candidate.leftStart : candidate.rightStart;
            const lineCount = side === 'left' ? candidate.leftLineCount : candidate.rightLineCount;
            return lineCount > 0 && lineNumber >= start + 1 && lineNumber <= start + lineCount;
        });
        if (group) {
            setActiveGroupId(group.id);
        }
    }, [groups]);

    const saveResolution = useCallback(async () => {
        if (!visibleContent || resultDraft === null) {
            return;
        }
        if (pendingGroupCount > 0) {
            setError(new Error(t('Resolve all conflict blocks before completing the merge.')));
            return;
        }
        if (hasConflictBlocks(resultDraft)) {
            setError(new Error(t('The final result still contains conflict markers.')));
            return;
        }

        setSaving(true);
        try {
            await rpc.saveConflictResolution({
                ...file,
                content: resultDraft,
                resultExists,
                stageSignature: visibleContent.stageSignature,
                resultFingerprint: visibleContent.resultFingerprint
            });
            completeAction();
        } catch (e) {
            setError(e instanceof Error ? e : new Error(String(e)));
        } finally {
            setSaving(false);
        }
    }, [completeAction, file, pendingGroupCount, resultDraft, resultExists, t, visibleContent]);

    const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !completeDisabled) {
            event.preventDefault();
            event.stopPropagation();
            void saveResolution();
            return;
        }
        if (isEditableKeyboardTarget(event.target) || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
            return;
        }
        if (event.key === 'ArrowUp' && previousPendingGroup) {
            event.preventDefault();
            goToPreviousConflict();
        } else if (event.key === 'ArrowDown' && nextPendingGroup) {
            event.preventDefault();
            goToNextConflict();
        }
    }, [completeDisabled, goToNextConflict, goToPreviousConflict, nextPendingGroup, previousPendingGroup, saveResolution]);

    const reviewActionsDisabled = controlsDisabled;
    const blockActions: MergeBlockAction[] = groups.map(group => {
        const range = rangeById.get(group.id);
        return {
            id: group.id,
            displayRow: layout.displayRows.get(group.id) ?? group.baseStart,
            leftLineCount: group.leftLineCount,
            resultLineCount: layout.resultLineCounts.get(group.id) ?? 0,
            rightLineCount: group.rightLineCount,
            decorationType: getMergeDecorationType(group),
            hasLeftChange: group.hasLeftChange,
            hasRightChange: group.hasRightChange,
            leftDecision: range?.leftDecision ?? null,
            rightDecision: range?.rightDecision ?? null,
            leftApplyAppends: Boolean(range && getMergeGroupApplyMode(resultText, range, group, 'left') === 'append'),
            rightApplyAppends: Boolean(range && getMergeGroupApplyMode(resultText, range, group, 'right') === 'append'),
            leftContextData: buildMergeEditorContext(file, 'mergeEditorLeft', group, range, reviewActionsDisabled),
            resultContextData: buildMergeEditorContext(file, 'mergeEditorResult', group, range, reviewActionsDisabled),
            rightContextData: buildMergeEditorContext(file, 'mergeEditorRight', group, range, reviewActionsDisabled),
            disabled: reviewActionsDisabled,
            onCancelLeft: () => applyGroupDecision(group, 'left', 'cancelled'),
            onAcceptLeft: () => applyGroupDecision(group, 'left', 'applied'),
            onAcceptRight: () => applyGroupDecision(group, 'right', 'applied'),
            onCancelRight: () => applyGroupDecision(group, 'right', 'cancelled')
        };
    });
    const leftContextData = buildMergeEditorContext(file, 'mergeEditorLeft', activeGroup, activeRange, reviewActionsDisabled);
    const resultContextData = buildMergeEditorContext(file, 'mergeEditorResult', activeGroup, activeRange, reviewActionsDisabled);
    const rightContextData = buildMergeEditorContext(file, 'mergeEditorRight', activeGroup, activeRange, reviewActionsDisabled);
    const activeResultRange = activeGroup ? layout.resultTextRanges.get(activeGroup.id) : undefined;

    return (
        <section className={styles.resolver} aria-label={t('Conflict Resolver')} tabIndex={0} onKeyDown={handleKeyDown}>
            <div className={styles.header}>
                <div className={`${styles.actions} ${visibleContent && visibleContent.kind !== 'text' ? styles.specialHeaderActions : ''}`}>
                    {visibleContent && visibleContent.kind !== 'text' && <span className={styles.specialPath}>{file.path}</span>}
                    <button className={styles.iconButton} type="button" onClick={goToPreviousConflict} disabled={controlsDisabled || !previousPendingGroup} title={t('Previous Conflict')} aria-label={t('Previous Conflict')}>
                        <span className="codicon codicon-arrow-up" aria-hidden="true"></span>
                    </button>
                    <button className={styles.iconButton} type="button" onClick={goToNextConflict} disabled={controlsDisabled || !nextPendingGroup} title={t('Next Conflict')} aria-label={t('Next Conflict')}>
                        <span className="codicon codicon-arrow-down" aria-hidden="true"></span>
                    </button>
                    <span className={styles.toolbarSeparator}></span>
                    <div className={styles.toolbarSelectControl}>
                        <select
                            className={styles.toolbarSelect}
                            value={whitespaceMode}
                            onChange={event => void changeWhitespaceMode(event.currentTarget.value as WhitespaceCompareMode)}
                            disabled={controlsDisabled || !visibleContent || visibleContent.isBinary}
                            aria-label={t('Whitespace comparison')}
                        >
                            <option value="none">{t('Do not ignore')}</option>
                            <option value="ignore">{t('Ignore whitespaces')}</option>
                            <option value="trim">{t('Trim whitespaces')}</option>
                        </select>
                        <span className={`codicon codicon-chevron-down ${styles.toolbarSelectChevron}`} aria-hidden="true"></span>
                    </div>
                    <div className={styles.toolbarSelectControl}>
                        <select
                            className={styles.toolbarSelect}
                            value={highlightMode}
                            onChange={event => setHighlightMode(event.currentTarget.value as MergeHighlightMode)}
                            disabled={controlsDisabled || !visibleContent || visibleContent.isBinary}
                            aria-label={t('Highlighting mode')}
                        >
                            <option value="words">{t('Highlight words')}</option>
                            <option value="lines">{t('Highlight lines')}</option>
                        </select>
                        <span className={`codicon codicon-chevron-down ${styles.toolbarSelectChevron}`} aria-hidden="true"></span>
                    </div>
                    {activeGroup && activeRange && isMergeReviewRangePending(activeRange) && (
                        <>
                            <span className={styles.toolbarSeparator}></span>
                            <button className={styles.compactButton} type="button" onClick={() => applyGroupDecision(activeGroup, 'both', 'manual')} disabled={controlsDisabled}>
                                {t('Mark as Reviewed')}
                            </button>
                        </>
                    )}
                </div>
                <div className={styles.statusText}>{statusLabel}</div>
            </div>

            {(!visibleContent || visibleContent.kind === 'text') && (
                <div className={styles.paneHeaderGrid}>
                    <div className={styles.integratedPaneHeader}>
                        <span>{t('Changes from {{name}}', { name: currentBranchLabel })}</span>
                    </div>
                    <div className={`${styles.integratedPaneHeader} ${styles.resultHeader}`}>
                        <span>{t('Result')}</span>
                        <span className={styles.resultPath}>{file.path}</span>
                    </div>
                    <div className={`${styles.integratedPaneHeader} ${styles.rightHeader}`}>
                        <span>{t('Changes from {{name}}', { name: incomingBranchLabel })}</span>
                    </div>
                </div>
            )}

            <div className={styles.content}>
                {isContentLoading && <div className={styles.message}>{t('Loading...')}</div>}
                {error && <div className={`${styles.message} ${styles.error}`}>{error.message}</div>}
                {visibleContent?.kind === 'binary' && (
                    <div className={styles.specialConflictState}>
                        <span className={`codicon codicon-file-binary ${styles.specialConflictIcon}`} aria-hidden="true"></span>
                        <div className={styles.specialConflictTitle}>{t('Binary file conflict')}</div>
                        <div className={styles.specialConflictDescription}>{t('Choose one complete version of the file. Binary content cannot be merged inline.')}</div>
                        <div className={styles.specialConflictActions}>
                            <button className={styles.button} type="button" onClick={() => void acceptFileSide('ours')} disabled={saving || isContentLoading || !visibleContent}>
                                <span className="codicon codicon-arrow-left" aria-hidden="true"></span>
                                {t('Accept Current Change')}
                            </button>
                            <button className={styles.button} type="button" onClick={() => void acceptFileSide('theirs')} disabled={saving || isContentLoading || !visibleContent}>
                                <span className="codicon codicon-arrow-right" aria-hidden="true"></span>
                                {t('Accept Incoming Change')}
                            </button>
                            <button className={styles.button} type="button" onClick={() => void rpc.openFile(file)} disabled={saving || isContentLoading}>
                                <span className="codicon codicon-go-to-file" aria-hidden="true"></span>
                                {t('Open File')}
                            </button>
                        </div>
                    </div>
                )}
                {visibleContent?.kind === 'submodule' && (
                    <div className={styles.specialConflictState}>
                        <span className={`codicon codicon-repo ${styles.specialConflictIcon}`} aria-hidden="true"></span>
                        <div className={styles.specialConflictTitle}>{t('Submodule conflict')}</div>
                        <div className={styles.specialConflictDescription}>{t('Resolve the submodule to the commit you want, then stage the submodule path in the parent repository.')}</div>
                        <div className={styles.commitChoices}>
                            <div className={styles.commitChoice}>
                                <span>{t('Current commit')}</span>
                                <code title={visibleContent.current.objectId}>{getShortObjectId(visibleContent.current.objectId)}</code>
                            </div>
                            <div className={styles.commitChoice}>
                                <span>{t('Incoming commit')}</span>
                                <code title={visibleContent.incoming.objectId}>{getShortObjectId(visibleContent.incoming.objectId)}</code>
                            </div>
                        </div>
                        <div className={styles.specialConflictActions}>
                            <button className={styles.button} type="button" onClick={() => void rpc.openFile(file)} disabled={saving || isContentLoading}>
                                <span className="codicon codicon-folder-opened" aria-hidden="true"></span>
                                {t('Open Submodule')}
                            </button>
                        </div>
                    </div>
                )}
                {visibleContent?.kind === 'unsupported' && (
                    <div className={styles.specialConflictState}>
                        <span className={`codicon codicon-warning ${styles.specialConflictIcon}`} aria-hidden="true"></span>
                        <div className={styles.specialConflictTitle}>{t('Unsupported conflict')}</div>
                        <div className={styles.specialConflictDescription}>{t('This Git entry type cannot be resolved in Intelli Git. Resolve and stage it with Git, then refresh the view.')}</div>
                    </div>
                )}
                {visibleContent && visibleContent.kind === 'text' && resultDraft !== null && (
                    <ThreeWayMergeEditor
                        filePath={file.path}
                        leftText={visibleContent.current.content}
                        resultText={resultText}
                        rightText={visibleContent.incoming.content}
                        leftDecorations={leftDecorations}
                        resultDecorations={resultDecorations}
                        rightDecorations={rightDecorations}
                        leftViewZones={layout.leftViewZones}
                        resultViewZones={layout.resultViewZones}
                        rightViewZones={layout.rightViewZones}
                        leftRevealLine={activeGroup ? Math.max(1, activeGroup.leftStart + 1) : undefined}
                        resultRevealLine={activeResultRange?.startLine}
                        rightRevealLine={activeGroup ? Math.max(1, activeGroup.rightStart + 1) : undefined}
                        blockActions={blockActions}
                        leftContextData={leftContextData}
                        resultContextData={resultContextData}
                        rightContextData={rightContextData}
                        resultDisabled={saving || isContentLoading}
                        onResultChange={handleResultChange}
                        onLeftLineClick={lineNumber => selectConflictBySideLine('left', lineNumber)}
                        onResultLineClick={selectConflictByResultLine}
                        onRightLineClick={lineNumber => selectConflictBySideLine('right', lineNumber)}
                    />
                )}
            </div>
            <div className={styles.footer}>
                <div className={styles.footerLeft}>
                    {visibleContent?.kind === 'text' && (
                        <>
                            <button className={styles.footerButton} type="button" onClick={() => void acceptFileSide('ours')} disabled={saving || isContentLoading}>
                                {acceptLeftFileLabel}
                            </button>
                            <button className={styles.footerButton} type="button" onClick={() => void acceptFileSide('theirs')} disabled={saving || isContentLoading}>
                                {acceptRightFileLabel}
                            </button>
                        </>
                    )}
                </div>
                <div className={styles.footerRight}>
                    <button className={styles.footerButton} type="button" onClick={onClose} disabled={saving}>
                        {t('Cancel')}
                    </button>
                    {(!visibleContent || visibleContent.kind === 'text') && (
                        <button className={`${styles.footerButton} ${styles.applyButton}`} type="button" onClick={() => void saveResolution()} disabled={completeDisabled}>
                            {t('Apply')}
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
}

export function ConflictResolverPage() {
    const { t } = useTranslation();
    const initialSession = useMemo(() => getInitialConflictSession(), []);
    const [file, setFile] = useState<RepositoryFileReference | null>(initialSession?.file ?? null);

    useEffect(() => {
        if (file) {
            void rpc.updateConflictResolverTitle(file);
        }
    }, [file]);

    useEffect(() => rpcEvents.revealConflictResolverFile.subscribe(next => {
        const nextFile = { path: next.path, repoPath: next.repoPath };
        setFile(current => current && isSameFileReference(current, nextFile) ? current : nextFile);
    }), []);

    if (!file) {
        return <div className={styles.message}>{t('No conflict file selected.')}</div>;
    }

    return (
        <ConflictResolver
            key={getFileReferenceKey(file)}
            file={file}
            onClose={() => void rpc.closeWebView()}
        />
    );
}
