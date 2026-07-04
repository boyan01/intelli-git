import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/min/vs/editor/editor.main.css';

export type MonacoApi = typeof Monaco;

let monacoConfigured = false;
let monacoLoadPromise: Promise<MonacoApi> | null = null;

function getCssVar(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function getThemeBase(): Monaco.editor.BuiltinTheme {
    if (document.body.classList.contains('vscode-light')) {
        return 'vs';
    }
    if (document.body.classList.contains('vscode-high-contrast')) {
        return 'hc-black';
    }
    return 'vs-dark';
}

function configureMonacoEnvironment(EditorWorker: new () => Worker) {
    if (monacoConfigured) {
        return;
    }
    monacoConfigured = true;

    (globalThis as typeof globalThis & { MonacoEnvironment: Monaco.Environment }).MonacoEnvironment = {
        getWorker() {
            return new EditorWorker();
        }
    };
}

export async function loadMonaco(): Promise<MonacoApi> {
    monacoLoadPromise ??= Promise.all([
        import('monaco-editor/esm/vs/editor/editor.api.js'),
        import('monaco-editor/esm/vs/editor/editor.worker?worker')
    ]).then(([monaco, workerModule]) => {
        configureMonacoEnvironment(workerModule.default);
        return monaco;
    });

    return monacoLoadPromise;
}

export function applyVsCodeMonacoTheme(monaco: MonacoApi) {
    monaco.editor.defineTheme('intelli-git-vscode', {
        base: getThemeBase(),
        inherit: true,
        rules: [],
        colors: {
            'editor.background': getCssVar('--vscode-editor-background', '#1e1e1e'),
            'editor.foreground': getCssVar('--vscode-editor-foreground', '#d4d4d4'),
            'editorLineNumber.foreground': getCssVar('--vscode-editorLineNumber-foreground', '#858585'),
            'editorLineNumber.activeForeground': getCssVar('--vscode-editorLineNumber-activeForeground', '#c6c6c6'),
            'editorCursor.foreground': getCssVar('--vscode-editorCursor-foreground', '#aeafad'),
            'editor.selectionBackground': getCssVar('--vscode-editor-selectionBackground', '#264f78'),
            'editor.inactiveSelectionBackground': getCssVar('--vscode-editor-inactiveSelectionBackground', '#3a3d41'),
            'editor.lineHighlightBackground': getCssVar('--vscode-editor-lineHighlightBackground', '#2a2d2e'),
            'editor.lineHighlightBorder': getCssVar('--vscode-editor-lineHighlightBorder', '#00000000')
        }
    });
    monaco.editor.setTheme('intelli-git-vscode');
}
