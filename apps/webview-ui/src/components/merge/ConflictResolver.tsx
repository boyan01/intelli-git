import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConflictFileContent, RepositoryFileReference } from '@shared/messages';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import type { CodeLineDecoration } from './MonacoCodeEditor';
import {
    buildThreeWayMergeDocumentFromSides,
    buildThreeWayMergePaneDocument,
    getUnresolvedThreeWayConflictIds,
    parseConflictBlocks,
    type ConflictResolutionChoice,
    type ConflictResolutionMap,
    type ConflictResolutionState,
    type MergePaneRange,
    type NonConflictingChangeMode,
    type ThreeWayMergePart,
    type WhitespaceCompareMode
} from './conflictModel';
import { ThreeWayMergeEditor } from './ThreeWayMergeEditor';
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

function isSameFileReference(left: RepositoryFileReference, right: RepositoryFileReference): boolean {
    return left.path === right.path && (left.repoPath || '') === (right.repoPath || '');
}

function getFileReferenceKey(file: RepositoryFileReference): string {
    return `${file.repoPath || ''}\u0000${file.path}`;
}

function findUnresolvedConflictIndex(
    conflictParts: Array<Extract<ThreeWayMergePart, { type: 'conflict' }>>,
    activeIndex: number,
    direction: 1 | -1,
    resolvedConflicts: ConflictResolutionState
): number {
    for (let index = activeIndex + direction; index >= 0 && index < conflictParts.length; index += direction) {
        if (!Object.prototype.hasOwnProperty.call(resolvedConflicts, conflictParts[index].id)) {
            return index;
        }
    }

    return -1;
}

function getInitialConflictSession(): ConflictResolverInitialSession | null {
    const state = window.initialState as ConflictResolverInitialState | null | undefined;
    const file = state?.conflictFile;
    if (!file?.path) {
        return null;
    }

    const conflictFile = {
        path: file.path,
        repoPath: file.repoPath
    };

    return {
        file: conflictFile
    };
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

function buildConflictDecorations(
    ranges: MergePaneRange[],
    activeConflictId: string | undefined,
    resolvedConflicts: ConflictResolutionState
): CodeLineDecoration[] {
    return ranges.map(range => {
        const resolved = Object.prototype.hasOwnProperty.call(resolvedConflicts, range.id);
        const state = range.id === activeConflictId ? 'active' : resolved ? 'resolved' : 'unresolved';
        const className = `intelli-git-merge-conflict-${state}`;
        const overviewRulerColor = state === 'active'
            ? 'rgba(55, 148, 255, 0.9)'
            : state === 'resolved'
                ? 'rgba(115, 201, 145, 0.7)'
                : 'rgba(244, 76, 76, 0.8)';
        return {
            startLine: range.startLine,
            endLine: range.endLine,
            className,
            linesDecorationsClassName: `${className}-gutter`,
            lineNumberClassName: state === 'active' ? `${className}-line-number` : undefined,
            overviewRulerColor
        };
    });
}

function findConflictIndexByLine(
    conflictParts: Array<Extract<ThreeWayMergePart, { type: 'conflict' }>>,
    ranges: MergePaneRange[],
    lineNumber: number
): number {
    const range = ranges.find(candidate => lineNumber >= candidate.startLine && lineNumber <= candidate.endLine);
    if (!range) {
        return -1;
    }
    return conflictParts.findIndex(part => part.id === range.id);
}

export function ConflictResolver({
    file,
    onClose
}: ConflictResolverProps) {
    const { t } = useTranslation();
    const autoFullResultFileKey = useRef<string | null>(null);
    const [content, setContent] = useState<ConflictFileContent | null>(null);
    const [drafts, setDrafts] = useState<ConflictResolutionMap>({});
    const [resolvedConflicts, setResolvedConflicts] = useState<ConflictResolutionState>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [activeConflictIndex, setActiveConflictIndex] = useState(0);
    const [fullResultDraft, setFullResultDraft] = useState<string | null>(null);
    const [nonConflictingMode, setNonConflictingMode] = useState<NonConflictingChangeMode>('all');
    const [whitespaceMode, setWhitespaceMode] = useState<WhitespaceCompareMode>('strict');
    const [highlightWords, setHighlightWords] = useState(true);
    const visibleContent = content && isSameFileReference(content, file) ? content : null;
    const isContentLoading = loading || Boolean(content && !visibleContent);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setContent(null);
        setDrafts({});
        setResolvedConflicts({});
        setFullResultDraft(null);
        autoFullResultFileKey.current = null;
        setNonConflictingMode('all');
        setWhitespaceMode('strict');
        setHighlightWords(true);

        rpc.getConflictFileContent(file)
            .then(next => {
                if (cancelled) {
                    return;
                }
                setContent(next);
                setActiveConflictIndex(0);
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

    const documentParts = useMemo(
        () => visibleContent && !visibleContent.isBinary
            ? buildThreeWayMergeDocumentFromSides(visibleContent.base, visibleContent.current, visibleContent.incoming, whitespaceMode)
            : [],
        [visibleContent, whitespaceMode]
    );
    const conflictParts = useMemo(
        () => documentParts.filter((part): part is Extract<ThreeWayMergePart, { type: 'conflict' }> => part.type === 'conflict'),
        [documentParts]
    );
    const unresolvedIds = useMemo(
        () => getUnresolvedThreeWayConflictIds(documentParts, resolvedConflicts),
        [documentParts, resolvedConflicts]
    );
    const activeConflict = conflictParts[activeConflictIndex];
    const activeConflictId = activeConflict?.id;
    const paneDocument = useMemo(
        () => buildThreeWayMergePaneDocument(documentParts, drafts, nonConflictingMode),
        [documentParts, drafts, nonConflictingMode]
    );
    const resultText = fullResultDraft ?? paneDocument.resultText;
    const activeLeftConflictLine = paneDocument.leftConflictRanges.find(range => range.id === activeConflictId)?.startLine;
    const activeResultConflictLine = paneDocument.resultConflictRanges.find(range => range.id === activeConflictId)?.startLine;
    const activeRightConflictLine = paneDocument.rightConflictRanges.find(range => range.id === activeConflictId)?.startLine;
    const leftConflictDecorations = useMemo(
        () => buildConflictDecorations(paneDocument.leftConflictRanges, activeConflictId, resolvedConflicts),
        [activeConflictId, paneDocument.leftConflictRanges, resolvedConflicts]
    );
    const resultConflictDecorations = useMemo(
        () => buildConflictDecorations(paneDocument.resultConflictRanges, activeConflictId, resolvedConflicts),
        [activeConflictId, paneDocument.resultConflictRanges, resolvedConflicts]
    );
    const rightConflictDecorations = useMemo(
        () => buildConflictDecorations(paneDocument.rightConflictRanges, activeConflictId, resolvedConflicts),
        [activeConflictId, paneDocument.rightConflictRanges, resolvedConflicts]
    );
    const hasSelectableNonConflictingChanges = useMemo(() => documentParts.some(part => (
        part.type === 'text' && (part.kind === 'current' || part.kind === 'incoming')
    )), [documentParts]);
    const currentBranchLabel = visibleContent?.currentLabel || t('Left');
    const incomingBranchLabel = visibleContent?.incomingLabel || t('Right');
    const previousUnresolvedConflictIndex = findUnresolvedConflictIndex(conflictParts, activeConflictIndex, -1, resolvedConflicts);
    const nextUnresolvedConflictIndex = findUnresolvedConflictIndex(conflictParts, activeConflictIndex, 1, resolvedConflicts);
    const fullResultMarkerCount = fullResultDraft === null ? 0 : parseConflictBlocks(fullResultDraft).length;
    const fullResultHasMarkers = fullResultMarkerCount > 0;
    const acceptLeftFileLabel = visibleContent && !visibleContent.current.exists
        ? t('Accept Left (delete file)')
        : t('Accept Left');
    const acceptRightFileLabel = visibleContent && !visibleContent.incoming.exists
        ? t('Accept Right (delete file)')
        : t('Accept Right');
    const completeDisabled = saving || isContentLoading || !visibleContent || visibleContent.isBinary || (
        fullResultDraft === null
            ? unresolvedIds.length > 0
            : fullResultHasMarkers
    );
    const unresolvedLabel = fullResultDraft === null
        ? (unresolvedIds.length > 0
            ? t('{{count}} unresolved', { count: unresolvedIds.length })
            : t('No conflicts remaining'))
        : (fullResultMarkerCount > 0
            ? t('{{count}} unresolved', { count: fullResultMarkerCount })
            : t('No conflicts remaining'));

    const selectConflictByLine = useCallback((ranges: MergePaneRange[], lineNumber: number) => {
        const nextIndex = findConflictIndexByLine(conflictParts, ranges, lineNumber);
        if (nextIndex !== -1) {
            setActiveConflictIndex(nextIndex);
        }
    }, [conflictParts]);

    useEffect(() => {
        setActiveConflictIndex(current => {
            if (conflictParts.length === 0) {
                return 0;
            }
            return Math.min(current, conflictParts.length - 1);
        });
    }, [conflictParts.length]);

    useEffect(() => {
        const nextDrafts: ConflictResolutionMap = {};
        for (const part of conflictParts) {
            nextDrafts[part.id] = part.baseText;
        }
        setDrafts(nextDrafts);
        setResolvedConflicts({});
    }, [conflictParts]);

    useEffect(() => {
        const fileKey = getFileReferenceKey(file);
        if (!visibleContent || visibleContent.isBinary || conflictParts.length === 0 || autoFullResultFileKey.current === fileKey) {
            return;
        }

        autoFullResultFileKey.current = fileKey;

        if (!visibleContent.current.exists || !visibleContent.incoming.exists) {
            return;
        }

        if (parseConflictBlocks(visibleContent.result).length === 0) {
            setFullResultDraft(visibleContent.result);
        }
    }, [conflictParts.length, file, visibleContent]);

    const completeAction = useCallback(() => {
        rpcEvents.refresh.emit();
        onClose();
    }, [onClose]);

    const acceptFileSide = useCallback(async (side: 'ours' | 'theirs') => {
        setSaving(true);
        try {
            await rpc.resolveConflict({ ...file, side });
            completeAction();
        } catch (e) {
            setError(e instanceof Error ? e : new Error(String(e)));
        } finally {
            setSaving(false);
        }
    }, [completeAction, file]);

    const setConflictResolution = useCallback((id: string, value: string) => {
        setDrafts(current => ({
            ...current,
            [id]: value
        }));
        setResolvedConflicts(current => ({
            ...current,
            [id]: true
        }));
        setError(null);
    }, []);

    const getBlockResolutionText = useCallback((part: Extract<ThreeWayMergePart, { type: 'conflict' }>, choice: ConflictResolutionChoice) => {
        if (choice === 'base') {
            return part.baseText;
        }
        if (choice === 'current') {
            return part.currentText;
        }
        if (choice === 'incoming') {
            return part.incomingText;
        }
        return part.currentText + part.incomingText;
    }, []);

    const acceptBlockResolution = useCallback((part: Extract<ThreeWayMergePart, { type: 'conflict' }>, choice: ConflictResolutionChoice) => {
        setConflictResolution(part.id, getBlockResolutionText(part, choice));

        const currentIndex = conflictParts.findIndex(candidate => candidate.id === part.id);
        const nextIndex = conflictParts.findIndex((candidate, index) => (
            index > currentIndex &&
            candidate.id !== part.id &&
            !Object.prototype.hasOwnProperty.call(resolvedConflicts, candidate.id)
        ));
        const wrappedIndex = conflictParts.findIndex((candidate, index) => (
            index < currentIndex &&
            candidate.id !== part.id &&
            !Object.prototype.hasOwnProperty.call(resolvedConflicts, candidate.id)
        ));
        const targetIndex = nextIndex !== -1 ? nextIndex : wrappedIndex;
        if (targetIndex !== -1) {
            setActiveConflictIndex(targetIndex);
        }
    }, [conflictParts, getBlockResolutionText, resolvedConflicts, setConflictResolution]);

    const goToConflict = useCallback((index: number) => {
        const boundedIndex = Math.max(0, Math.min(index, conflictParts.length - 1));
        setActiveConflictIndex(boundedIndex);
    }, [conflictParts]);

    const goToPreviousConflict = useCallback(() => {
        if (previousUnresolvedConflictIndex !== -1) {
            goToConflict(previousUnresolvedConflictIndex);
        }
    }, [goToConflict, previousUnresolvedConflictIndex]);

    const goToNextConflict = useCallback(() => {
        if (nextUnresolvedConflictIndex !== -1) {
            goToConflict(nextUnresolvedConflictIndex);
        }
    }, [goToConflict, nextUnresolvedConflictIndex]);

    const stopFullResultEdit = useCallback(() => {
        setFullResultDraft(null);
        setError(null);
    }, []);

    const saveResolution = useCallback(async () => {
        let result = fullResultDraft ?? paneDocument.resultText;
        if (fullResultDraft === null) {
            const missingIds = getUnresolvedThreeWayConflictIds(documentParts, resolvedConflicts);
            if (missingIds.length > 0) {
                setError(new Error(t('Resolve all conflict blocks before completing the merge.')));
                return;
            }
        }

        // Clean out all the virtual alignment zero-width lines
        result = result.replace(/\u200B\r?\n?/g, '');

        if (parseConflictBlocks(result).length > 0) {
            setError(new Error(t('The final result still contains conflict markers.')));
            return;
        }

        setSaving(true);
        try {
            await rpc.saveConflictResolution({ ...file, content: result });
            completeAction();
        } catch (e) {
            setError(e instanceof Error ? e : new Error(String(e)));
        } finally {
            setSaving(false);
        }
    }, [completeAction, documentParts, file, fullResultDraft, paneDocument.resultText, resolvedConflicts, t]);

    const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
        const editableTarget = isEditableKeyboardTarget(event.target);

        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            if (!completeDisabled) {
                event.preventDefault();
                event.stopPropagation();
                void saveResolution();
            }
            return;
        }

        if (editableTarget || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
            return;
        }

        let handled = true;
        if (event.key === 'ArrowUp') {
            if (!saving && !isContentLoading && fullResultDraft === null && previousUnresolvedConflictIndex !== -1) {
                goToPreviousConflict();
            }
        } else if (event.key === 'ArrowDown') {
            if (!saving && !isContentLoading && fullResultDraft === null && nextUnresolvedConflictIndex !== -1) {
                goToNextConflict();
            }
        } else {
            handled = false;
        }

        if (handled) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, [
        completeDisabled,
        fullResultDraft,
        goToNextConflict,
        goToPreviousConflict,
        isContentLoading,
        nextUnresolvedConflictIndex,
        previousUnresolvedConflictIndex,
        saveResolution,
        saving
    ]);

    const blockActionDisabled = saving || isContentLoading || fullResultDraft !== null;
    const blockActions = fullResultDraft === null && visibleContent && !visibleContent.isBinary
        ? conflictParts.flatMap(part => {
            const range = paneDocument.resultConflictRanges.find(candidate => candidate.id === part.id);
            if (!range) {
                return [];
            }

            return [{
                id: part.id,
                resultLine: range.startLine,
                acceptBaseDisabled: blockActionDisabled,
                acceptLeftDisabled: blockActionDisabled || !visibleContent.current.exists,
                acceptRightDisabled: blockActionDisabled || !visibleContent.incoming.exists,
                onAcceptBase: () => acceptBlockResolution(part, 'base'),
                onAcceptLeft: () => acceptBlockResolution(part, 'current'),
                onAcceptRight: () => acceptBlockResolution(part, 'incoming')
            }];
        })
        : [];

    return (
        <section className={styles.resolver} aria-label={t('Conflict Resolver')} tabIndex={0} onKeyDown={handleKeyDown}>
            <div className={styles.header}>
                <div className={styles.actions}>
                    <button className={styles.iconButton} type="button" onClick={goToPreviousConflict} disabled={saving || isContentLoading || fullResultDraft !== null || previousUnresolvedConflictIndex === -1} title={t('Previous Conflict')} aria-label={t('Previous Conflict')}>
                        <span className="codicon codicon-arrow-up" aria-hidden="true"></span>
                    </button>
                    <button className={styles.iconButton} type="button" onClick={goToNextConflict} disabled={saving || isContentLoading || fullResultDraft !== null || nextUnresolvedConflictIndex === -1} title={t('Next Conflict')} aria-label={t('Next Conflict')}>
                        <span className="codicon codicon-arrow-down" aria-hidden="true"></span>
                    </button>
                    <span className={styles.toolbarSeparator}></span>
                    {hasSelectableNonConflictingChanges && fullResultDraft === null && (
                        <>
                            <div className={styles.nonConflictControls} role="group" aria-label={t('Apply non-conflicting changes:')}>
                                <span className={styles.toolbarLabel}>{t('Apply non-conflicting changes:')}</span>
                                <button
                                    className={`${styles.segmentButton} ${nonConflictingMode === 'current' ? styles.activeSegmentButton : ''}`}
                                    type="button"
                                    onClick={() => setNonConflictingMode('current')}
                                    disabled={saving || isContentLoading}
                                    aria-pressed={nonConflictingMode === 'current'}
                                >
                                    {t('Left')}
                                </button>
                                <button
                                    className={`${styles.segmentButton} ${nonConflictingMode === 'all' ? styles.activeSegmentButton : ''}`}
                                    type="button"
                                    onClick={() => setNonConflictingMode('all')}
                                    disabled={saving || isContentLoading}
                                    aria-pressed={nonConflictingMode === 'all'}
                                >
                                    {t('All')}
                                </button>
                                <button
                                    className={`${styles.segmentButton} ${nonConflictingMode === 'incoming' ? styles.activeSegmentButton : ''}`}
                                    type="button"
                                    onClick={() => setNonConflictingMode('incoming')}
                                    disabled={saving || isContentLoading}
                                    aria-pressed={nonConflictingMode === 'incoming'}
                                >
                                    {t('Right')}
                                </button>
                            </div>
                            <span className={styles.toolbarSeparator}></span>
                        </>
                    )}
                    <button
                        className={`${styles.compactButton} ${whitespaceMode === 'ignore' ? styles.activeToggleButton : ''}`}
                        type="button"
                        onClick={() => setWhitespaceMode(current => current === 'ignore' ? 'strict' : 'ignore')}
                        disabled={!visibleContent || visibleContent.isBinary || fullResultDraft !== null}
                        aria-pressed={whitespaceMode === 'ignore'}
                    >
                        {t('Ignore')}
                    </button>
                    <button
                        className={`${styles.compactButton} ${highlightWords ? styles.activeToggleButton : ''}`}
                        type="button"
                        onClick={() => setHighlightWords(current => !current)}
                        disabled={!visibleContent || visibleContent.isBinary || fullResultDraft !== null}
                        aria-pressed={highlightWords}
                    >
                        {t('Highlight words')}
                    </button>
                    <span className={styles.toolbarSeparator}></span>
                    {fullResultDraft !== null && (
                        <button className={styles.compactButton} type="button" onClick={stopFullResultEdit} disabled={!visibleContent || visibleContent.isBinary}>
                            {t('Show Merge Blocks')}
                        </button>
                    )}
                </div>
                <div className={styles.statusText}>{unresolvedLabel}</div>
            </div>

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

            <div className={styles.content}>
                {isContentLoading && <div className={styles.message}>{t('Loading...')}</div>}
                {error && <div className={`${styles.message} ${styles.error}`}>{error.message}</div>}
                {visibleContent?.isBinary && (
                    <div className={styles.binaryState}>
                        <div className={styles.message}>{t('Binary conflict files cannot be edited in Intelli Git yet.')}</div>
                        <div className={styles.binaryActions}>
                            <button className={styles.button} type="button" onClick={() => void acceptFileSide('ours')} disabled={saving || isContentLoading}>
                                <span className="codicon codicon-arrow-left" aria-hidden="true"></span>
                                {t('Accept Current Change')}
                            </button>
                            <button className={styles.button} type="button" onClick={() => void acceptFileSide('theirs')} disabled={saving || isContentLoading}>
                                <span className="codicon codicon-arrow-right" aria-hidden="true"></span>
                                {t('Accept Incoming Change')}
                            </button>
                        </div>
                    </div>
                )}
                {visibleContent && !visibleContent.isBinary && (
                    <>
                        <ThreeWayMergeEditor
                            leftText={paneDocument.leftText}
                            resultText={resultText}
                            rightText={paneDocument.rightText}
                            leftExists={visibleContent.current.exists}
                            rightExists={visibleContent.incoming.exists}
                            activeLeftConflictLine={activeLeftConflictLine}
                            activeResultConflictLine={activeResultConflictLine}
                            activeRightConflictLine={activeRightConflictLine}
                            leftLineDecorations={leftConflictDecorations}
                            resultLineDecorations={fullResultDraft === null ? resultConflictDecorations : undefined}
                            rightLineDecorations={rightConflictDecorations}
                            blockActions={blockActions}
                            resultDisabled={saving || isContentLoading}
                            onLeftLineClick={lineNumber => selectConflictByLine(paneDocument.leftConflictRanges, lineNumber)}
                            onResultLineClick={lineNumber => selectConflictByLine(paneDocument.resultConflictRanges, lineNumber)}
                            onRightLineClick={lineNumber => selectConflictByLine(paneDocument.rightConflictRanges, lineNumber)}
                            onResultChange={value => {
                                setFullResultDraft(value);
                                setError(null);
                            }}
                        />
                    </>
                )}
            </div>
            <div className={styles.footer}>
                <div className={styles.footerLeft}>
                    <button className={styles.footerButton} type="button" onClick={() => void acceptFileSide('ours')} disabled={saving || isContentLoading}>
                        {acceptLeftFileLabel}
                    </button>
                    <button className={styles.footerButton} type="button" onClick={() => void acceptFileSide('theirs')} disabled={saving || isContentLoading}>
                        {acceptRightFileLabel}
                    </button>
                </div>
                <div className={styles.footerRight}>
                    <button className={styles.footerButton} type="button" onClick={onClose} disabled={saving}>
                        {t('Cancel')}
                    </button>
                    <button className={`${styles.footerButton} ${styles.applyButton}`} type="button" onClick={() => void saveResolution()} disabled={completeDisabled}>
                        {t('Apply')}
                    </button>
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

    useEffect(() => {
        return rpcEvents.revealConflictResolverFile.subscribe(next => {
            const conflictFile = {
                path: next.path,
                repoPath: next.repoPath
            };
            setFile(conflictFile);
        });
    }, []);

    if (!file) {
        return (
            <div className={styles.message}>
                {t('No conflict file selected.')}
            </div>
        );
    }

    return (
        <ConflictResolver
            key={getFileReferenceKey(file)}
            file={file}
            onClose={() => void rpc.closeWebView()}
        />
    );
}
