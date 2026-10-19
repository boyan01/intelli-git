import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

export type MonacoApi = typeof Monaco;

let monacoLoadPromise: Promise<MonacoApi> | null = null;

const fileNameLanguages = new Map<string, string>([
    ['dockerfile', 'dockerfile'],
    ['containerfile', 'dockerfile'],
    ['package.json', 'json'],
    ['package-lock.json', 'json'],
    ['tsconfig.json', 'json'],
    ['jsconfig.json', 'json'],
    ['go.mod', 'go'],
    ['go.sum', 'go'],
    ['gemfile', 'ruby'],
    ['rakefile', 'ruby'],
    ['podfile', 'ruby'],
]);

const extensionLanguages = new Map<string, string>([
    ['.bat', 'bat'],
    ['.c', 'cpp'],
    ['.cc', 'cpp'],
    ['.cjs', 'javascript'],
    ['.cpp', 'cpp'],
    ['.cs', 'csharp'],
    ['.css', 'css'],
    ['.cts', 'typescript'],
    ['.dart', 'dart'],
    ['.env', 'ini'],
    ['.go', 'go'],
    ['.graphql', 'graphql'],
    ['.gql', 'graphql'],
    ['.h', 'cpp'],
    ['.hcl', 'hcl'],
    ['.hpp', 'cpp'],
    ['.html', 'html'],
    ['.htm', 'html'],
    ['.hxx', 'cpp'],
    ['.ini', 'ini'],
    ['.java', 'java'],
    ['.js', 'javascript'],
    ['.json', 'json'],
    ['.jsx', 'javascript'],
    ['.kt', 'kotlin'],
    ['.kts', 'kotlin'],
    ['.less', 'less'],
    ['.lua', 'lua'],
    ['.m', 'objective-c'],
    ['.md', 'markdown'],
    ['.mdx', 'markdown'],
    ['.mjs', 'javascript'],
    ['.mm', 'objective-c'],
    ['.mts', 'typescript'],
    ['.php', 'php'],
    ['.plist', 'xml'],
    ['.pl', 'perl'],
    ['.pm', 'perl'],
    ['.proto', 'protobuf'],
    ['.ps1', 'powershell'],
    ['.py', 'python'],
    ['.rb', 'ruby'],
    ['.rs', 'rust'],
    ['.scss', 'scss'],
    ['.sh', 'shell'],
    ['.sql', 'sql'],
    ['.swift', 'swift'],
    ['.tf', 'hcl'],
    ['.ts', 'typescript'],
    ['.tsx', 'typescript'],
    ['.vue', 'html'],
    ['.xml', 'xml'],
    ['.yaml', 'yaml'],
    ['.yml', 'yaml'],
    ['.zsh', 'shell'],
]);

function normalizeFilePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').toLowerCase();
}

export function getMonacoLanguageIdForPath(filePath: string | undefined): string | undefined {
    if (!filePath) {
        return undefined;
    }

    const normalizedPath = normalizeFilePath(filePath);
    const fileName = normalizedPath.split('/').pop() ?? normalizedPath;
    const languageFromName = fileNameLanguages.get(fileName);
    if (languageFromName) {
        return languageFromName;
    }

    const extension = fileName.includes('.') ? `.${fileName.split('.').pop()}` : '';
    return extensionLanguages.get(extension);
}

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

export async function loadMonaco(): Promise<MonacoApi> {
    monacoLoadPromise ??= import('monaco-editor/esm/vs/editor/editor.main').then(async () => {
        const monaco = await import('monaco-editor/esm/vs/editor/editor.api');
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
            'editor.lineHighlightBorder': getCssVar('--vscode-editor-lineHighlightBorder', '#00000000'),
        },
    });
    monaco.editor.setTheme('intelli-git-vscode');
}
