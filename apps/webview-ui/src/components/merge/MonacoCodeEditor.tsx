import { useEffect, useMemo, useRef } from 'react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { applyVsCodeMonacoTheme, loadMonaco, type MonacoApi } from './monacoRuntime';
import styles from './MonacoCodeEditor.module.css';

type MonacoEditor = Monaco.editor.IStandaloneCodeEditor;
type DecorationCollection = Monaco.editor.IEditorDecorationsCollection;
type EditorDimension = Monaco.editor.IDimension;

export interface CodeLineDecoration {
    startLine: number;
    endLine: number;
    className: string;
    linesDecorationsClassName?: string;
    marginClassName?: string;
    lineNumberClassName?: string;
    overviewRulerColor?: string;
}

interface MonacoCodeEditorProps {
    value: string;
    ariaLabel: string;
    readOnly?: boolean;
    disabled?: boolean;
    className?: string;
    minHeight?: number;
    fill?: boolean;
    revealLine?: number;
    lineDecorations?: CodeLineDecoration[];
    scrollTop?: number;
    onChange?: (value: string) => void;
    onFocus?: () => void;
    onLineClick?: (lineNumber: number) => void;
    onScroll?: (scrollTop: number) => void;
}

export const CODE_EDITOR_LINE_HEIGHT = 18;
export const CODE_EDITOR_TOP_PADDING = 6;

const VERTICAL_PADDING = 12;
const MIN_EDITOR_HEIGHT = 30;

function getCssVar(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function splitLines(text: string): string[] {
    return text.split(/\r\n|\r|\n/);
}

function getEditorHeight(value: string, minHeight: number | undefined): number {
    const lineCount = Math.max(1, splitLines(value).length);
    const contentHeight = lineCount * CODE_EDITOR_LINE_HEIGHT + VERTICAL_PADDING;
    return Math.max(minHeight ?? MIN_EDITOR_HEIGHT, contentHeight);
}

function getLineDecorations(monaco: MonacoApi, model: Monaco.editor.ITextModel, lineDecorations: CodeLineDecoration[] | undefined): Monaco.editor.IModelDeltaDecoration[] {
    const lineCount = model.getLineCount();
    return (lineDecorations ?? []).map(decoration => {
        const startLine = Math.max(1, Math.min(decoration.startLine, lineCount));
        const endLine = Math.max(startLine, Math.min(decoration.endLine, lineCount));
        return {
            range: new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
            options: {
                isWholeLine: true,
                shouldFillLineOnLineBreak: true,
                zIndex: 10,
                marginClassName: decoration.marginClassName,
                linesDecorationsClassName: decoration.linesDecorationsClassName,
                lineNumberClassName: decoration.lineNumberClassName,
                overviewRuler: decoration.overviewRulerColor
                    ? {
                        color: decoration.overviewRulerColor,
                        position: monaco.editor.OverviewRulerLane.Full
                    }
                    : undefined,
                minimap: decoration.overviewRulerColor
                    ? {
                        color: decoration.overviewRulerColor,
                        position: monaco.editor.MinimapPosition.Inline
                    }
                    : undefined,
                className: decoration.className
            }
        };
    });
}

function getElementDimension(element: HTMLElement): EditorDimension | null {
    const rect = element.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (width <= 0 || height <= 0) {
        return null;
    }
    return { width, height };
}

function isClickableLineTarget(monaco: MonacoApi, targetType: Monaco.editor.MouseTargetType): boolean {
    return targetType === monaco.editor.MouseTargetType.CONTENT_TEXT ||
        targetType === monaco.editor.MouseTargetType.CONTENT_EMPTY ||
        targetType === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
        targetType === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;
}

export function MonacoCodeEditor({
    value,
    ariaLabel,
    readOnly = false,
    disabled = false,
    className,
    minHeight,
    fill = false,
    revealLine,
    lineDecorations,
    scrollTop,
    onChange,
    onFocus,
    onLineClick,
    onScroll
}: MonacoCodeEditorProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const monacoRef = useRef<MonacoApi | null>(null);
    const editorRef = useRef<MonacoEditor | null>(null);
    const decorationsRef = useRef<DecorationCollection | null>(null);
    const cleanupRef = useRef<(() => void) | null>(null);
    const layoutFrameRef = useRef(0);
    const latestValueRef = useRef(value);
    const latestReadOnlyRef = useRef(readOnly || disabled);
    const latestFillRef = useRef(fill);
    const latestLineDecorationsRef = useRef(lineDecorations);
    const applyingExternalValueRef = useRef(false);
    const onChangeRef = useRef(onChange);
    const onFocusRef = useRef(onFocus);
    const onLineClickRef = useRef(onLineClick);
    const onScrollRef = useRef(onScroll);
    const editorHeight = useMemo(() => getEditorHeight(value, minHeight), [minHeight, value]);

    useEffect(() => {
        latestValueRef.current = value;
        latestReadOnlyRef.current = readOnly || disabled;
        latestFillRef.current = fill;
        latestLineDecorationsRef.current = lineDecorations;
        onChangeRef.current = onChange;
        onFocusRef.current = onFocus;
        onLineClickRef.current = onLineClick;
        onScrollRef.current = onScroll;
    }, [disabled, fill, lineDecorations, onChange, onFocus, onLineClick, onScroll, readOnly, value]);

    useEffect(() => {
        let disposed = false;
        const host = hostRef.current;
        if (!host) {
            return;
        }

        let model: Monaco.editor.ITextModel | null = null;
        let resizeObserver: ResizeObserver | null = null;

        const scheduleLayout = (dimension?: EditorDimension | null) => {
            if (layoutFrameRef.current) {
                window.cancelAnimationFrame(layoutFrameRef.current);
            }

            layoutFrameRef.current = window.requestAnimationFrame(() => {
                layoutFrameRef.current = 0;
                const editor = editorRef.current;
                const nextDimension = dimension ?? (host ? getElementDimension(host) : null);
                if (!editor || !nextDimension) {
                    return;
                }
                editor.layout(nextDimension);
            });
        };

        const createEditor = (monaco: MonacoApi, dimension: EditorDimension) => {
            if (disposed || editorRef.current) {
                return;
            }

            monacoRef.current = monaco;
            applyVsCodeMonacoTheme(monaco);
            model = monaco.editor.createModel(latestValueRef.current, undefined);
            const editor = monaco.editor.create(host, {
                model,
                ariaLabel,
                automaticLayout: false,
                contextmenu: true,
                cursorBlinking: 'smooth',
                folding: false,
                fontFamily: 'var(--vscode-editor-font-family)',
                fontSize: Number.parseInt(getCssVar('--vscode-editor-font-size', '13'), 10) || 13,
                lineDecorationsWidth: 12,
                lineHeight: CODE_EDITOR_LINE_HEIGHT,
                lineNumbers: 'on',
                lineNumbersMinChars: 3,
                minimap: { enabled: false },
                occurrencesHighlight: 'off',
                overviewRulerLanes: 0,
                padding: { top: CODE_EDITOR_TOP_PADDING, bottom: 6 },
                readOnly: latestReadOnlyRef.current,
                renderLineHighlight: 'none',
                renderValidationDecorations: 'off',
                roundedSelection: false,
                scrollBeyondLastLine: false,
                scrollbar: {
                    alwaysConsumeMouseWheel: false,
                    horizontal: latestFillRef.current ? 'auto' : 'hidden',
                    vertical: latestFillRef.current ? 'auto' : 'hidden'
                },
                selectOnLineNumbers: true,
                tabSize: 4,
                theme: 'intelli-git-vscode',
                wordWrap: 'off',
                wrappingIndent: 'same',
                unicodeHighlight: {
                    invisibleCharacters: false,
                    ambiguousCharacters: false
                }
            });

            editorRef.current = editor;
            decorationsRef.current = editor.createDecorationsCollection();
            decorationsRef.current.set(getLineDecorations(monaco, model, latestLineDecorationsRef.current));
            editor.layout(dimension);

            const contentSubscription = editor.onDidChangeModelContent(() => {
                if (applyingExternalValueRef.current) {
                    return;
                }
                onChangeRef.current?.(editor.getValue());
            });
            const focusSubscription = editor.onDidFocusEditorWidget(() => {
                onFocusRef.current?.();
            });
            const mouseDownSubscription = editor.onMouseDown(event => {
                if (!isClickableLineTarget(monaco, event.target.type)) {
                    return;
                }
                const lineNumber = event.target.position?.lineNumber;
                if (lineNumber !== undefined) {
                    onLineClickRef.current?.(lineNumber);
                }
            });
            const scrollSubscription = editor.onDidScrollChange(event => {
                if (event.scrollTopChanged) {
                    onScrollRef.current?.(event.scrollTop);
                }
            });

            cleanupRef.current = () => {
                scrollSubscription.dispose();
                mouseDownSubscription.dispose();
                focusSubscription.dispose();
                contentSubscription.dispose();
                decorationsRef.current?.clear();
                decorationsRef.current = null;
                editorRef.current = null;
                editor.dispose();
                model?.dispose();
                model = null;
            };
        };

        resizeObserver = new ResizeObserver(() => {
            const dimension = getElementDimension(host);
            const editor = editorRef.current;
            if (editor) {
                scheduleLayout(dimension);
                return;
            }
            const monaco = monacoRef.current;
            if (monaco && dimension) {
                createEditor(monaco, dimension);
            }
        });
        resizeObserver.observe(host);

        void loadMonaco().then(monaco => {
            if (disposed) {
                return;
            }

            monacoRef.current = monaco;
            const dimension = getElementDimension(host);
            if (dimension) {
                createEditor(monaco, dimension);
            }
        }).catch(error => {
            console.error('Failed to initialize Monaco code editor.', error);
            if (!disposed) {
                window.setTimeout(() => {
                    throw error;
                });
            }
        });

        return () => {
            disposed = true;
            if (layoutFrameRef.current) {
                window.cancelAnimationFrame(layoutFrameRef.current);
                layoutFrameRef.current = 0;
            }
            resizeObserver?.disconnect();
            cleanupRef.current?.();
            cleanupRef.current = null;
            model?.dispose();
        };
    }, [ariaLabel]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }

        editor.updateOptions({
            readOnly: readOnly || disabled,
            renderLineHighlight: 'none',
            scrollbar: {
                alwaysConsumeMouseWheel: false,
                horizontal: fill ? 'auto' : 'hidden',
                vertical: fill ? 'auto' : 'hidden'
            }
        });
    }, [disabled, fill, readOnly]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }

        const model = editor.getModel();
        if (model) {
            const normalizedCurrent = model.getValue().replace(/\r\n/g, '\n');
            const normalizedInput = value.replace(/\r\n/g, '\n');
            if (normalizedCurrent !== normalizedInput) {
                const position = editor.getPosition();
                applyingExternalValueRef.current = true;
                try {
                    model.setValue(value);
                } finally {
                    applyingExternalValueRef.current = false;
                }
                if (position) {
                    editor.setPosition(position);
                }
                const host = hostRef.current;
                const dimension = host ? getElementDimension(host) : null;
                if (dimension) {
                    editor.layout(dimension);
                }
            }
        }
    }, [value]);

    useEffect(() => {
        const monaco = monacoRef.current;
        const model = editorRef.current?.getModel();
        if (!monaco || !model) {
            return;
        }
        decorationsRef.current?.set(getLineDecorations(monaco, model, lineDecorations));
    }, [lineDecorations, value]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const host = hostRef.current;
        const dimension = host ? getElementDimension(host) : null;
        if (dimension) {
            editor.layout(dimension);
        }
    }, [editorHeight]);

    useEffect(() => {
        if (revealLine === undefined) {
            return;
        }
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const host = hostRef.current;
        const dimension = host ? getElementDimension(host) : null;
        if (dimension) {
            editor.layout(dimension);
            editor.revealLineInCenter(revealLine);
        }
    }, [revealLine]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor || scrollTop === undefined) {
            return;
        }
        if (editor.getScrollTop() !== scrollTop) {
            editor.setScrollTop(scrollTop);
        }
    }, [scrollTop]);

    if (!value && readOnly) {
        return (
            <div className={`${styles.emptyHost} ${className ?? ''}`} aria-label={ariaLabel}>
                ∅
            </div>
        );
    }

    return (
        <div
            ref={hostRef}
            className={`${styles.editorHost} ${fill ? styles.fillHost : ''} ${className ?? ''}`}
            style={fill ? undefined : { height: `${editorHeight}px` }}
        />
    );
}
