import * as vscode from 'vscode';
import type { FileIconTheme } from '@shared/messages';
import { logger } from '../utils/logger';
import {
    buildFileIconTheme,
    mapFileIconThemeResources,
    parseJsonWithComments,
    type IconThemeColorKind,
    type LanguageContribution,
} from '../utils/fileIconTheme';

const DEFAULT_ICON_THEME_ID = 'vs-seti';

interface IconThemeContribution {
    id: string;
    path: string;
    extensionUri: vscode.Uri;
}

const EMPTY_THEME: FileIconTheme = {
    id: '',
    iconDefinitions: {},
    fonts: [],
    fileNames: {},
    fileExtensions: {},
    languageIds: {},
    languageFileNames: {},
    languageExtensions: {},
    folderNames: {},
    folderNamesExpanded: {},
};

function getColorKind(kind: vscode.ColorThemeKind): IconThemeColorKind {
    switch (kind) {
        case vscode.ColorThemeKind.Light:
            return 'light';
        case vscode.ColorThemeKind.HighContrast:
        case vscode.ColorThemeKind.HighContrastLight:
            return 'highContrast';
        default:
            return 'dark';
    }
}

function getContributes(extension: vscode.Extension<unknown>): Record<string, unknown> {
    const contributes = (extension.packageJSON as { contributes?: unknown } | undefined)?.contributes;
    return typeof contributes === 'object' && contributes !== null ? (contributes as Record<string, unknown>) : {};
}

/**
 * Resolves the user's active VS Code file icon theme so webviews can render the same file icons
 * as the Explorer. Webviews cannot access the workbench icon theme directly.
 */
export class FileIconThemeService implements vscode.Disposable {
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChange = this.changeEmitter.event;
    private readonly disposables: vscode.Disposable[] = [];
    private colorKind = getColorKind(vscode.window.activeColorTheme.kind);
    private themePromise?: Promise<FileIconTheme | null>;
    /** Last theme sent to webviews; `null` means file icons are disabled, `undefined` means none yet. */
    private appliedThemeId?: string | null;

    constructor() {
        this.disposables.push(
            this.changeEmitter,
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('workbench.iconTheme')) {
                    this.invalidate();
                }
            }),
            vscode.window.onDidChangeActiveColorTheme((colorTheme) => {
                const nextKind = getColorKind(colorTheme.kind);
                if (nextKind !== this.colorKind) {
                    this.colorKind = nextKind;
                    this.invalidate();
                }
            }),
            vscode.extensions.onDidChange(() => this.invalidate())
        );
    }

    /**
     * Folders that must be readable by webviews to load icon theme images and fonts.
     */
    public getLocalResourceRoots(): vscode.Uri[] {
        const roots = new Map<string, vscode.Uri>();
        for (const contribution of this.getIconThemeContributions()) {
            roots.set(contribution.extensionUri.toString(), contribution.extensionUri);
        }
        return Array.from(roots.values());
    }

    /**
     * Returns the active theme with resource URIs mapped for the given webview.
     * Returns an empty theme when file icons are disabled and null when the theme cannot be resolved.
     */
    public async getTheme(webview: vscode.Webview): Promise<FileIconTheme | null> {
        this.themePromise ??= this.loadTheme();
        const theme = await this.themePromise;
        if (!theme) {
            return null;
        }
        return mapFileIconThemeResources(theme, (uri) => webview.asWebviewUri(vscode.Uri.parse(uri)).toString());
    }

    private invalidate(): void {
        this.themePromise = undefined;
        this.changeEmitter.fire();
    }

    private getIconThemeContributions(): IconThemeContribution[] {
        return vscode.extensions.all.flatMap((extension) => {
            const iconThemes = getContributes(extension).iconThemes;
            if (!Array.isArray(iconThemes)) {
                return [];
            }
            return iconThemes.flatMap((iconTheme: unknown) => {
                const { id, path } = (iconTheme ?? {}) as { id?: unknown; path?: unknown };
                return typeof id === 'string' && typeof path === 'string'
                    ? [{ id, path, extensionUri: extension.extensionUri }]
                    : [];
            });
        });
    }

    private getLanguageContributions(): LanguageContribution[] {
        return vscode.extensions.all.flatMap((extension) => {
            const languages = getContributes(extension).languages;
            if (!Array.isArray(languages)) {
                return [];
            }
            return languages.flatMap((language: unknown) => {
                const { id, extensions, filenames } = (language ?? {}) as Record<string, unknown>;
                if (typeof id !== 'string') {
                    return [];
                }
                return [
                    {
                        id,
                        extensions: Array.isArray(extensions) ? extensions : undefined,
                        filenames: Array.isArray(filenames) ? filenames : undefined,
                    },
                ];
            });
        });
    }

    private async loadTheme(): Promise<FileIconTheme | null> {
        const configuredId = vscode.workspace.getConfiguration('workbench').get<string | null>('iconTheme');
        if (configuredId === null) {
            this.appliedThemeId = null;
            return EMPTY_THEME;
        }

        const contributions = this.getIconThemeContributions();
        const findContribution = (id: string) => contributions.find((candidate) => candidate.id === id);
        let contribution = configuredId ? findContribution(configuredId) : undefined;
        if (!contribution) {
            // Like VS Code, keep the applied theme when the configured one is unknown;
            // only the initial load falls back to the default theme.
            if (this.appliedThemeId === null) {
                return EMPTY_THEME;
            }
            contribution =
                (this.appliedThemeId ? findContribution(this.appliedThemeId) : undefined) ??
                findContribution(DEFAULT_ICON_THEME_ID);
        }
        if (!contribution) {
            logger.warn(`File icon theme "${configuredId}" was not found; using bundled file icons.`);
            return null;
        }
        this.appliedThemeId = contribution.id;

        try {
            const documentUri = vscode.Uri.joinPath(contribution.extensionUri, contribution.path);
            const documentDir = vscode.Uri.joinPath(documentUri, '..');
            const content = await vscode.workspace.fs.readFile(documentUri);
            return buildFileIconTheme({
                id: contribution.id,
                document: parseJsonWithComments(new TextDecoder().decode(content)),
                colorKind: this.colorKind,
                languages: this.getLanguageContributions(),
                resolveResource: (relativePath) => vscode.Uri.joinPath(documentDir, relativePath).toString(),
            });
        } catch (error) {
            logger.warn(`Failed to load file icon theme "${contribution.id}"; using bundled file icons.`, error);
            return null;
        }
    }

    public dispose(): void {
        this.disposables.forEach((disposable) => disposable.dispose());
        this.disposables.length = 0;
    }
}
