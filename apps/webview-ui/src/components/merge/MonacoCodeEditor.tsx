import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import type { MergeEditorContext } from '@shared/webviewContext';
import { applyVsCodeMonacoTheme, getMonacoLanguageIdForPath, loadMonaco, type MonacoApi } from './monacoRuntime';
import styles from './MonacoCodeEditor.module.css';

type MonacoEditor = Monaco.editor.IStandaloneCodeEditor;
// Monaco uses this internal hook for wheel events over its own diff editor gutters.
type WheelDelegatingMonacoEditor = MonacoEditor & {
    delegateScrollFromMouseWheelEvent(event: WheelEvent): void;
};
type DecorationCollection = Monaco.editor.IEditorDecorationsCollection;
type EditorDimension = Monaco.editor.IDimension;

export const CODE_EDITOR_LINE_HEIGHT = 18;
export const CODE_EDITOR_TOP_PADDING = 6;

export type CodeOverviewRulerType = 'inserted' | 'deleted' | 'modified' | 'conflict';

export interface CodeDecoration {
    startLine: number;
    startColumn?: number;
    endLine: number;
    endColumn?: number;
    isWholeLine?: boolean;
    className?: string;
    inlineClassName?: string;
    marginClassName?: string;
    overviewRulerType?: CodeOverviewRulerType;
}

export interface CodeViewZone {
    id: string;
    afterLineNumber: number;
    heightInLines: number;
    className?: string;
}

export interface CodeEditorContentChange {
    rangeOffset: number;
    rangeLength: number;
    text: string;
}

export interface MonacoCodeEditorHandle {
    delegateScrollFromWheelEvent(event: WheelEvent): void;
}

interface MonacoCodeEditorProps {
    value: string;
    ariaLabel: string;
    filePath?: string;
    readOnly?: boolean;
    disabled?: boolean;
    className?: string;
    decorations?: CodeDecoration[];
    viewZones?: CodeViewZone[];
    contextData?: MergeEditorContext;
    revealLine?: number;
    scrollTop?: number;
    scrollLeft?: number;
    onChange?: (value: string, changes: CodeEditorContentChange[]) => void;
    onLineClick?: (lineNumber: number) => void;
    onScroll?: (scrollTop: number | undefined, scrollLeft: number | undefined) => void;
}

function getCssVar(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function getOverviewRulerColor(type: CodeOverviewRulerType): string {
    switch (type) {
        case 'inserted':
            return getCssVar('--vscode-editorGutter-addedBackground', '#72c892');
        case 'deleted':
            return getCssVar('--vscode-diffEditor-move-border', '#8b8b8b');
        case 'modified':
            return getCssVar('--vscode-editorGutter-modifiedBackground', '#0078d4');
        case 'conflict':
            return getCssVar('--vscode-editorGutter-deletedBackground', '#f28772');
    }
}

function getEditorOptions(
    model: Monaco.editor.ITextModel,
    ariaLabel: string,
    readOnly: boolean
): Monaco.editor.IStandaloneEditorConstructionOptions {
    const fontSize = Number.parseInt(getCssVar('--vscode-editor-font-size', '13'), 10) || 13;
    return {
        model,
        ariaLabel,
        automaticLayout: true,
        contextmenu: false,
        fontFamily: getCssVar('--vscode-editor-font-family', 'monospace'),
        fontSize,
        folding: false,
        glyphMargin: false,
        lineDecorationsWidth: 12,
        lineHeight: CODE_EDITOR_LINE_HEIGHT,
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        minimap: { enabled: false },
        padding: { top: CODE_EDITOR_TOP_PADDING, bottom: 6 },
        readOnly,
        scrollBeyondLastLine: false,
        theme: 'intelli-git-vscode',
        useShadowDOM: false,
    };
}

function normalizeLineEndings(value: string): string {
    return value.replace(/\r\n/g, '\n');
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

function getEditorDecorations(
    monaco: MonacoApi,
    model: Monaco.editor.ITextModel,
    decorations: CodeDecoration[] | undefined
): Monaco.editor.IModelDeltaDecoration[] {
    const lineCount = model.getLineCount();
    return (decorations ?? []).map((decoration) => {
        const startLine = Math.max(1, Math.min(decoration.startLine, lineCount));
        const endLine = Math.max(startLine, Math.min(decoration.endLine, lineCount));
        const startColumn = decoration.isWholeLine
            ? 1
            : Math.max(1, Math.min(decoration.startColumn ?? 1, model.getLineMaxColumn(startLine)));
        const endColumn = decoration.isWholeLine
            ? model.getLineMaxColumn(endLine)
            : Math.max(
                  1,
                  Math.min(decoration.endColumn ?? model.getLineMaxColumn(endLine), model.getLineMaxColumn(endLine))
              );

        return {
            range: new monaco.Range(startLine, startColumn, endLine, endColumn),
            options: {
                className: decoration.className,
                inlineClassName: decoration.inlineClassName,
                isWholeLine: decoration.isWholeLine,
                shouldFillLineOnLineBreak: decoration.isWholeLine,
                marginClassName: decoration.marginClassName,
                overviewRuler: decoration.overviewRulerType
                    ? {
                          color: getOverviewRulerColor(decoration.overviewRulerType),
                          position: monaco.editor.OverviewRulerLane.Right,
                      }
                    : undefined,
            },
        };
    });
}

function isClickableLineTarget(monaco: MonacoApi, targetType: Monaco.editor.MouseTargetType): boolean {
    return (
        targetType === monaco.editor.MouseTargetType.CONTENT_TEXT ||
        targetType === monaco.editor.MouseTargetType.CONTENT_EMPTY ||
        targetType === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
        targetType === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
    );
}

function replaceViewZones(editor: MonacoEditor, currentIds: string[], zones: CodeViewZone[] | undefined): string[] {
    const nextIds: string[] = [];
    editor.changeViewZones((accessor) => {
        currentIds.forEach((id) => accessor.removeZone(id));
        for (const zone of zones ?? []) {
            if (zone.heightInLines <= 0) {
                continue;
            }
            const domNode = document.createElement('div');
            const marginDomNode = document.createElement('div');
            if (zone.className) {
                domNode.className = zone.className;
                marginDomNode.className = zone.className;
            }
            nextIds.push(
                accessor.addZone({
                    afterLineNumber: Math.max(0, zone.afterLineNumber),
                    heightInLines: zone.heightInLines,
                    domNode,
                    marginDomNode,
                    suppressMouseDown: true,
                })
            );
        }
    });
    return nextIds;
}

export const MonacoCodeEditor = forwardRef<MonacoCodeEditorHandle, MonacoCodeEditorProps>(function MonacoCodeEditor(
    {
        value,
        ariaLabel,
        filePath,
        readOnly = false,
        disabled = false,
        className,
        decorations,
        viewZones,
        contextData,
        revealLine,
        scrollTop,
        scrollLeft,
        onChange,
        onLineClick,
        onScroll,
    },
    ref
) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<WheelDelegatingMonacoEditor | null>(null);
    const decorationsRef = useRef<DecorationCollection | null>(null);
    const viewZoneIdsRef = useRef<string[]>([]);
    const applyingExternalValueRef = useRef(false);
    const applyingExternalScrollRef = useRef(false);
    const layoutFrameRef = useRef(0);
    const latestValueRef = useRef(value);
    const latestReadOnlyRef = useRef(readOnly || disabled);
    const latestDecorationsRef = useRef(decorations);
    const latestViewZonesRef = useRef(viewZones);
    const latestRevealLineRef = useRef(revealLine);
    const onChangeRef = useRef(onChange);
    const onLineClickRef = useRef(onLineClick);
    const onScrollRef = useRef(onScroll);

    useImperativeHandle(
        ref,
        () => ({
            delegateScrollFromWheelEvent(event) {
                editorRef.current?.delegateScrollFromMouseWheelEvent(event);
            },
        }),
        []
    );

    useEffect(() => {
        latestValueRef.current = value;
        latestReadOnlyRef.current = readOnly || disabled;
        latestDecorationsRef.current = decorations;
        latestViewZonesRef.current = viewZones;
        latestRevealLineRef.current = revealLine;
        onChangeRef.current = onChange;
        onLineClickRef.current = onLineClick;
        onScrollRef.current = onScroll;
    }, [decorations, disabled, onChange, onLineClick, onScroll, readOnly, revealLine, value, viewZones]);

    useEffect(() => {
        let disposed = false;
        let editor: WheelDelegatingMonacoEditor | null = null;
        let model: Monaco.editor.ITextModel | null = null;
        let contentSubscription: Monaco.IDisposable | null = null;
        let mouseSubscription: Monaco.IDisposable | null = null;
        let scrollSubscription: Monaco.IDisposable | null = null;
        let resizeObserver: ResizeObserver | null = null;
        let monacoApi: MonacoApi | null = null;
        const host = hostRef.current;
        if (!host) {
            return;
        }
        const languageId = getMonacoLanguageIdForPath(filePath);

        const layoutEditor = (dimension?: EditorDimension | null) => {
            if (layoutFrameRef.current) {
                window.cancelAnimationFrame(layoutFrameRef.current);
            }

            layoutFrameRef.current = window.requestAnimationFrame(() => {
                layoutFrameRef.current = 0;
                const nextDimension = dimension ?? getElementDimension(host);
                if (!editor || !nextDimension) {
                    return;
                }
                editor.layout(nextDimension);
            });
        };

        const createEditor = (monaco: MonacoApi, languageId: string | undefined, dimension: EditorDimension) => {
            if (disposed || editor) {
                return;
            }

            applyVsCodeMonacoTheme(monaco);
            const nextModel = monaco.editor.createModel(latestValueRef.current, languageId);
            const nextEditor = monaco.editor.create(
                host,
                getEditorOptions(nextModel, ariaLabel, latestReadOnlyRef.current)
            ) as WheelDelegatingMonacoEditor;
            model = nextModel;
            editor = nextEditor;
            editorRef.current = nextEditor;
            decorationsRef.current = nextEditor.createDecorationsCollection(
                getEditorDecorations(monaco, nextModel, latestDecorationsRef.current)
            );
            viewZoneIdsRef.current = replaceViewZones(nextEditor, [], latestViewZonesRef.current);
            nextEditor.layout(dimension);
            if (latestRevealLineRef.current !== undefined) {
                nextEditor.revealLineInCenter(latestRevealLineRef.current);
            }
            onScrollRef.current?.(nextEditor.getScrollTop(), nextEditor.getScrollLeft());

            contentSubscription = nextEditor.onDidChangeModelContent((event) => {
                if (!applyingExternalValueRef.current) {
                    onChangeRef.current?.(
                        nextEditor.getValue(),
                        event.changes.map((change) => ({
                            rangeOffset: change.rangeOffset,
                            rangeLength: change.rangeLength,
                            text: change.text,
                        }))
                    );
                }
            });
            mouseSubscription = nextEditor.onMouseDown((event) => {
                if (!isClickableLineTarget(monaco, event.target.type)) {
                    return;
                }
                const lineNumber = event.target.position?.lineNumber;
                if (lineNumber !== undefined) {
                    onLineClickRef.current?.(lineNumber);
                }
            });
            scrollSubscription = nextEditor.onDidScrollChange((event) => {
                if (!applyingExternalScrollRef.current && (event.scrollTopChanged || event.scrollLeftChanged)) {
                    onScrollRef.current?.(
                        event.scrollTopChanged ? event.scrollTop : undefined,
                        event.scrollLeftChanged ? event.scrollLeft : undefined
                    );
                }
            });
        };

        resizeObserver = new ResizeObserver(() => {
            if (disposed) {
                return;
            }

            const dimension = getElementDimension(host);
            if (!dimension) {
                return;
            }
            if (editor) {
                layoutEditor(dimension);
            } else if (monacoApi) {
                createEditor(monacoApi, languageId, dimension);
            }
        });
        resizeObserver.observe(host);

        void loadMonaco()
            .then((monaco) => {
                if (disposed) {
                    return;
                }

                monacoApi = monaco;
                const dimension = getElementDimension(host);
                if (dimension) {
                    createEditor(monaco, languageId, dimension);
                }
            })
            .catch((error) => {
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
            scrollSubscription?.dispose();
            mouseSubscription?.dispose();
            contentSubscription?.dispose();
            decorationsRef.current?.clear();
            decorationsRef.current = null;
            viewZoneIdsRef.current = [];
            editorRef.current = null;
            editor?.dispose();
            model?.dispose();
        };
    }, [ariaLabel, filePath]);

    useEffect(() => {
        editorRef.current?.updateOptions({
            readOnly: readOnly || disabled,
        });
    }, [disabled, readOnly]);

    useEffect(() => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (!editor || !model) {
            return;
        }
        if (normalizeLineEndings(model.getValue()) === normalizeLineEndings(value)) {
            return;
        }

        applyingExternalValueRef.current = true;
        try {
            model.setValue(value);
        } finally {
            applyingExternalValueRef.current = false;
        }
    }, [value]);

    useEffect(() => {
        let cancelled = false;
        void loadMonaco().then((monaco) => {
            if (cancelled) {
                return;
            }
            const model = editorRef.current?.getModel();
            if (model) {
                const nextDecorations = getEditorDecorations(monaco, model, decorations);
                decorationsRef.current?.clear();
                decorationsRef.current?.set(nextDecorations);
                editorRef.current?.render(true);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [decorations, value]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        viewZoneIdsRef.current = replaceViewZones(editor, viewZoneIdsRef.current, viewZones);
        editor.render(true);
    }, [viewZones]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor || revealLine === undefined) {
            return;
        }
        editor.revealLineInCenter(revealLine);
    }, [revealLine]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const nextPosition: Monaco.editor.INewScrollPosition = {};
        if (scrollTop !== undefined && editor.getScrollTop() !== scrollTop) {
            nextPosition.scrollTop = scrollTop;
        }
        if (scrollLeft !== undefined && editor.getScrollLeft() !== scrollLeft) {
            nextPosition.scrollLeft = scrollLeft;
        }
        if (nextPosition.scrollTop === undefined && nextPosition.scrollLeft === undefined) {
            return;
        }
        applyingExternalScrollRef.current = true;
        try {
            editor.setScrollPosition(nextPosition);
        } finally {
            applyingExternalScrollRef.current = false;
        }
    }, [scrollLeft, scrollTop]);

    return (
        <div
            ref={hostRef}
            className={`${styles.editorHost} ${className ?? ''}`}
            data-editable={!readOnly && !disabled ? 'true' : 'false'}
            {...(contextData ? { 'data-vscode-context': JSON.stringify(contextData) } : {})}
        />
    );
});
