import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CODE_EDITOR_LINE_HEIGHT, CODE_EDITOR_TOP_PADDING, MonacoCodeEditor, type CodeLineDecoration } from './MonacoCodeEditor';
import styles from './ThreeWayMergeEditor.module.css';

interface MergeBlockAction {
    id: string;
    resultLine: number;
    acceptBaseDisabled: boolean;
    acceptLeftDisabled: boolean;
    acceptRightDisabled: boolean;
    onAcceptBase: () => void;
    onAcceptLeft: () => void;
    onAcceptRight: () => void;
}

interface ThreeWayMergeEditorProps {
    leftText: string;
    resultText: string;
    rightText: string;
    leftExists: boolean;
    rightExists: boolean;
    activeLeftConflictLine?: number;
    activeResultConflictLine?: number;
    activeRightConflictLine?: number;
    leftLineDecorations: CodeLineDecoration[];
    resultLineDecorations?: CodeLineDecoration[];
    rightLineDecorations: CodeLineDecoration[];
    blockActions: MergeBlockAction[];
    resultDisabled: boolean;
    onLeftLineClick?: (lineNumber: number) => void;
    onResultLineClick?: (lineNumber: number) => void;
    onRightLineClick?: (lineNumber: number) => void;
    onResultChange: (value: string) => void;
}

function getGutterActionTop(line: number | undefined): string {
    return `${CODE_EDITOR_TOP_PADDING + ((line ?? 1) - 1) * CODE_EDITOR_LINE_HEIGHT}px`;
}

export function ThreeWayMergeEditor({
    leftText,
    resultText,
    rightText,
    leftExists,
    rightExists,
    activeLeftConflictLine,
    activeResultConflictLine,
    activeRightConflictLine,
    leftLineDecorations,
    resultLineDecorations,
    rightLineDecorations,
    blockActions,
    resultDisabled,
    onLeftLineClick,
    onResultLineClick,
    onRightLineClick,
    onResultChange
}: ThreeWayMergeEditorProps) {
    const { t } = useTranslation();
    const [scrollTop, setScrollTop] = useState<number>(0);

    const handleScroll = useCallback((newScrollTop: number) => {
        setScrollTop(newScrollTop);
    }, []);

    return (
        <div className={styles.mergeDocument}>
            <section className={styles.mergePane} aria-label={t('Left')}>
                {!leftExists && <div className={styles.deletedSideHint}>{t('Deleted on this side. Use file-level accept to keep the deletion.')}</div>}
                <MonacoCodeEditor
                    className={styles.fullHeightEditor}
                    value={leftText}
                    lineDecorations={leftLineDecorations}
                    readOnly
                    fill
                    revealLine={activeLeftConflictLine}
                    ariaLabel={t('Left')}
                    onLineClick={onLeftLineClick}
                    scrollTop={scrollTop}
                    onScroll={handleScroll}
                />
            </section>
            <div className={styles.editorGutter}>
                {blockActions.map(action => (
                    <div
                        key={action.id}
                        className={styles.leftGutterActionGroup}
                        style={{ top: getGutterActionTop(action.resultLine) }}
                    >
                        <button
                            className={styles.gutterActionButton}
                            type="button"
                            onClick={action.onAcceptBase}
                            disabled={action.acceptBaseDisabled}
                            title={t('Accept Base')}
                            aria-label={t('Accept Base')}
                        >
                            <span className="codicon codicon-close" aria-hidden="true"></span>
                        </button>
                        <button
                            className={styles.gutterActionButton}
                            type="button"
                            onClick={action.onAcceptLeft}
                            disabled={action.acceptLeftDisabled}
                            title={t('Accept Left')}
                            aria-label={t('Accept Left')}
                        >
                            <span className="codicon codicon-arrow-right" aria-hidden="true"></span>
                        </button>
                    </div>
                ))}
            </div>
            <section className={`${styles.mergePane} ${styles.resultPane}`} aria-label={t('Result')}>
                <MonacoCodeEditor
                    className={styles.fullHeightEditor}
                    value={resultText}
                    lineDecorations={resultLineDecorations}
                    disabled={resultDisabled}
                    fill
                    revealLine={activeResultConflictLine}
                    ariaLabel={t('Result')}
                    onChange={onResultChange}
                    onLineClick={onResultLineClick}
                    scrollTop={scrollTop}
                    onScroll={handleScroll}
                />
            </section>
            <div className={styles.editorGutter}>
                {blockActions.map(action => (
                    <div
                        key={action.id}
                        className={styles.rightGutterActionGroup}
                        style={{ top: getGutterActionTop(action.resultLine) }}
                    >
                        <button
                            className={styles.gutterActionButton}
                            type="button"
                            onClick={action.onAcceptRight}
                            disabled={action.acceptRightDisabled}
                            title={t('Accept Right')}
                            aria-label={t('Accept Right')}
                        >
                            <span className="codicon codicon-arrow-left" aria-hidden="true"></span>
                        </button>
                    </div>
                ))}
            </div>
            <section className={styles.mergePane} aria-label={t('Right')}>
                {!rightExists && <div className={styles.deletedSideHint}>{t('Deleted on this side. Use file-level accept to keep the deletion.')}</div>}
                <MonacoCodeEditor
                    className={styles.fullHeightEditor}
                    value={rightText}
                    lineDecorations={rightLineDecorations}
                    readOnly
                    fill
                    revealLine={activeRightConflictLine}
                    ariaLabel={t('Right')}
                    onLineClick={onRightLineClick}
                    scrollTop={scrollTop}
                    onScroll={handleScroll}
                />
            </section>
        </div>
    );
}
