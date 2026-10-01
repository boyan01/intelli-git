import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MergeEditorContext } from '@shared/webviewContext';
import {
    CODE_EDITOR_LINE_HEIGHT,
    CODE_EDITOR_TOP_PADDING,
    MonacoCodeEditor,
    type CodeDecoration,
    type CodeEditorContentChange,
    type CodeViewZone,
    type MonacoCodeEditorHandle,
} from './MonacoCodeEditor';
import type { MergeReviewDecision } from './conflictModel';
import styles from './ThreeWayMergeEditor.module.css';

export type MergeDecorationType = 'inserted' | 'deleted' | 'modified' | 'conflict';

export interface MergeBlockAction {
    id: string;
    displayRow: number;
    leftLineCount: number;
    resultLineCount: number;
    rightLineCount: number;
    decorationType: MergeDecorationType;
    hasLeftChange: boolean;
    hasRightChange: boolean;
    leftDecision: MergeReviewDecision | null;
    rightDecision: MergeReviewDecision | null;
    leftApplyAppends: boolean;
    rightApplyAppends: boolean;
    leftContextData: MergeEditorContext;
    resultContextData: MergeEditorContext;
    rightContextData: MergeEditorContext;
    disabled: boolean;
    onCancelLeft: () => void;
    onAcceptLeft: () => void;
    onAcceptRight: () => void;
    onCancelRight: () => void;
}

const MERGE_GUTTER_WIDTH = 44;
const MERGE_EDITOR_TOP_OFFSET = CODE_EDITOR_TOP_PADDING + 1;

interface MergeConnectorProps {
    action: MergeBlockAction;
    side: 'left' | 'right';
    scrollTop: number;
}

function MergeConnector({ action, side, scrollTop }: MergeConnectorProps) {
    const decision = side === 'left' ? action.leftDecision : action.rightDecision;
    const hasChange = side === 'left' ? action.hasLeftChange : action.hasRightChange;
    if (!hasChange || decision === null) {
        return null;
    }

    const sideLineCount = side === 'left' ? action.leftLineCount : action.rightLineCount;
    const startLineCount = side === 'left' ? sideLineCount : action.resultLineCount;
    const endLineCount = side === 'left' ? action.resultLineCount : sideLineCount;
    const startHeight = startLineCount * CODE_EDITOR_LINE_HEIGHT;
    const endHeight = endLineCount * CODE_EDITOR_LINE_HEIGHT;
    const connectorHeight = Math.max(CODE_EDITOR_LINE_HEIGHT, startHeight, endHeight);
    const top = MERGE_EDITOR_TOP_OFFSET + action.displayRow * CODE_EDITOR_LINE_HEIGHT - scrollTop;
    const bottomPath = `M 0 ${startHeight} L ${MERGE_GUTTER_WIDTH} ${endHeight}`;

    return (
        <svg
            className={styles.gutterConnector}
            style={{ top: `${top}px`, height: `${connectorHeight}px` }}
            viewBox={`0 0 ${MERGE_GUTTER_WIDTH} ${connectorHeight}`}
            preserveAspectRatio="none"
            data-decoration-type={action.decorationType}
            data-decision={decision}
            aria-hidden="true"
        >
            {decision === 'pending' ? (
                <polygon
                    className={styles.gutterConnectorFill}
                    points={`0,0 ${MERGE_GUTTER_WIDTH},0 ${MERGE_GUTTER_WIDTH},${endHeight} 0,${startHeight}`}
                />
            ) : (
                <>
                    <path className={styles.gutterConnectorEdge} d={`M 0 0 L ${MERGE_GUTTER_WIDTH} 0`} />
                    <path className={styles.gutterConnectorEdge} d={bottomPath} />
                </>
            )}
        </svg>
    );
}

interface ThreeWayMergeEditorProps {
    filePath: string;
    leftText: string;
    resultText: string;
    rightText: string;
    leftDecorations: CodeDecoration[];
    resultDecorations: CodeDecoration[];
    rightDecorations: CodeDecoration[];
    leftViewZones: CodeViewZone[];
    resultViewZones: CodeViewZone[];
    rightViewZones: CodeViewZone[];
    leftRevealLine?: number;
    resultRevealLine?: number;
    rightRevealLine?: number;
    blockActions: MergeBlockAction[];
    leftContextData: MergeEditorContext;
    resultContextData: MergeEditorContext;
    rightContextData: MergeEditorContext;
    resultDisabled: boolean;
    onResultChange: (value: string, changes: CodeEditorContentChange[]) => void;
    onLeftLineClick: (lineNumber: number) => void;
    onResultLineClick: (lineNumber: number) => void;
    onRightLineClick: (lineNumber: number) => void;
}

export function ThreeWayMergeEditor({
    filePath,
    leftText,
    resultText,
    rightText,
    leftDecorations,
    resultDecorations,
    rightDecorations,
    leftViewZones,
    resultViewZones,
    rightViewZones,
    leftRevealLine,
    resultRevealLine,
    rightRevealLine,
    blockActions,
    leftContextData,
    resultContextData,
    rightContextData,
    resultDisabled,
    onResultChange,
    onLeftLineClick,
    onResultLineClick,
    onRightLineClick,
}: ThreeWayMergeEditorProps) {
    const { t } = useTranslation();
    const resultEditorRef = useRef<MonacoCodeEditorHandle | null>(null);
    const leftGutterRef = useRef<HTMLDivElement | null>(null);
    const rightGutterRef = useRef<HTMLDivElement | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);
    const handleScroll = useCallback((nextScrollTop: number | undefined, nextScrollLeft: number | undefined) => {
        if (nextScrollTop !== undefined) {
            setScrollTop((current) => (current === nextScrollTop ? current : nextScrollTop));
        }
        if (nextScrollLeft !== undefined) {
            setScrollLeft((current) => (current === nextScrollLeft ? current : nextScrollLeft));
        }
    }, []);

    useEffect(() => {
        const handleGutterWheel = (event: WheelEvent) => {
            resultEditorRef.current?.delegateScrollFromWheelEvent(event);
        };
        const gutters = [leftGutterRef.current, rightGutterRef.current];
        gutters.forEach((gutter) => gutter?.addEventListener('wheel', handleGutterWheel, { passive: false }));
        return () => {
            gutters.forEach((gutter) => gutter?.removeEventListener('wheel', handleGutterWheel));
        };
    }, []);

    return (
        <div className={styles.mergeDocument}>
            <section className={styles.mergePane} aria-label={t('Left')}>
                <MonacoCodeEditor
                    className={styles.fullHeightEditor}
                    value={leftText}
                    filePath={filePath}
                    readOnly
                    decorations={leftDecorations}
                    viewZones={leftViewZones}
                    contextData={leftContextData}
                    revealLine={leftRevealLine}
                    scrollTop={scrollTop}
                    scrollLeft={scrollLeft}
                    onLineClick={onLeftLineClick}
                    onScroll={handleScroll}
                    ariaLabel={t('Left')}
                />
            </section>
            <div ref={leftGutterRef} className={styles.editorGutter}>
                {blockActions.map((action) => (
                    <MergeConnector key={action.id} action={action} side="left" scrollTop={scrollTop} />
                ))}
                {blockActions
                    .filter((action) => action.hasLeftChange && action.leftDecision === 'pending')
                    .map((action) => {
                        const acceptLabel = action.leftApplyAppends ? t('Append Left Change Below') : t('Accept Left');
                        return (
                            <div
                                key={action.id}
                                className={styles.leftGutterActionGroup}
                                style={{
                                    top: `${MERGE_EDITOR_TOP_OFFSET + action.displayRow * CODE_EDITOR_LINE_HEIGHT - scrollTop}px`,
                                    height: `${Math.max(1, action.leftLineCount, action.resultLineCount) * CODE_EDITOR_LINE_HEIGHT}px`,
                                }}
                                data-decoration-type={action.decorationType}
                                data-vscode-context={JSON.stringify(action.leftContextData)}
                            >
                                <button
                                    className={styles.gutterActionButton}
                                    type="button"
                                    onClick={action.onCancelLeft}
                                    disabled={action.disabled}
                                    title={t('Cancel Left Change')}
                                    aria-label={t('Cancel Left Change')}
                                >
                                    <span className="codicon codicon-close" aria-hidden="true"></span>
                                </button>
                                <button
                                    className={styles.gutterActionButton}
                                    type="button"
                                    onClick={action.onAcceptLeft}
                                    disabled={action.disabled}
                                    title={acceptLabel}
                                    aria-label={acceptLabel}
                                >
                                    <span
                                        className={
                                            action.leftApplyAppends
                                                ? `codicon codicon-newline ${styles.leftAppendIcon}`
                                                : 'codicon codicon-arrow-right'
                                        }
                                        aria-hidden="true"
                                    ></span>
                                </button>
                            </div>
                        );
                    })}
            </div>
            <section className={`${styles.mergePane} ${styles.resultPane}`} aria-label={t('Result')}>
                <MonacoCodeEditor
                    ref={resultEditorRef}
                    className={styles.fullHeightEditor}
                    value={resultText}
                    filePath={filePath}
                    disabled={resultDisabled}
                    decorations={resultDecorations}
                    viewZones={resultViewZones}
                    contextData={resultContextData}
                    revealLine={resultRevealLine}
                    scrollTop={scrollTop}
                    scrollLeft={scrollLeft}
                    ariaLabel={t('Result')}
                    onChange={onResultChange}
                    onLineClick={onResultLineClick}
                    onScroll={handleScroll}
                />
            </section>
            <div ref={rightGutterRef} className={styles.editorGutter}>
                {blockActions.map((action) => (
                    <MergeConnector key={action.id} action={action} side="right" scrollTop={scrollTop} />
                ))}
                {blockActions
                    .filter((action) => action.hasRightChange && action.rightDecision === 'pending')
                    .map((action) => {
                        const acceptLabel = action.rightApplyAppends
                            ? t('Append Right Change Below')
                            : t('Accept Right');
                        return (
                            <div
                                key={action.id}
                                className={styles.rightGutterActionGroup}
                                style={{
                                    top: `${MERGE_EDITOR_TOP_OFFSET + action.displayRow * CODE_EDITOR_LINE_HEIGHT - scrollTop}px`,
                                    height: `${Math.max(1, action.resultLineCount, action.rightLineCount) * CODE_EDITOR_LINE_HEIGHT}px`,
                                }}
                                data-decoration-type={action.decorationType}
                                data-vscode-context={JSON.stringify(action.rightContextData)}
                            >
                                <button
                                    className={styles.gutterActionButton}
                                    type="button"
                                    onClick={action.onAcceptRight}
                                    disabled={action.disabled}
                                    title={acceptLabel}
                                    aria-label={acceptLabel}
                                >
                                    <span
                                        className={
                                            action.rightApplyAppends
                                                ? 'codicon codicon-newline'
                                                : 'codicon codicon-arrow-left'
                                        }
                                        aria-hidden="true"
                                    ></span>
                                </button>
                                <button
                                    className={styles.gutterActionButton}
                                    type="button"
                                    onClick={action.onCancelRight}
                                    disabled={action.disabled}
                                    title={t('Cancel Right Change')}
                                    aria-label={t('Cancel Right Change')}
                                >
                                    <span className="codicon codicon-close" aria-hidden="true"></span>
                                </button>
                            </div>
                        );
                    })}
            </div>
            <section className={styles.mergePane} aria-label={t('Right')}>
                <MonacoCodeEditor
                    className={styles.fullHeightEditor}
                    value={rightText}
                    filePath={filePath}
                    readOnly
                    decorations={rightDecorations}
                    viewZones={rightViewZones}
                    contextData={rightContextData}
                    revealLine={rightRevealLine}
                    scrollTop={scrollTop}
                    scrollLeft={scrollLeft}
                    onLineClick={onRightLineClick}
                    onScroll={handleScroll}
                    ariaLabel={t('Right')}
                />
            </section>
        </div>
    );
}
