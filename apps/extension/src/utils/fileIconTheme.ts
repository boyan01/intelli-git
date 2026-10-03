import type { FileIconDefinition, FileIconFont, FileIconTheme } from '@shared/messages';

export type IconThemeColorKind = 'light' | 'dark' | 'highContrast';

export interface LanguageContribution {
    id: string;
    extensions?: string[];
    filenames?: string[];
}

interface RawIconDefinition {
    iconPath?: unknown;
    fontCharacter?: unknown;
    fontColor?: unknown;
    fontSize?: unknown;
    fontId?: unknown;
}

interface RawFont {
    id?: unknown;
    src?: unknown;
    weight?: unknown;
    style?: unknown;
    size?: unknown;
}

interface RawAssociations {
    file?: unknown;
    fileNames?: unknown;
    fileExtensions?: unknown;
    languageIds?: unknown;
    folder?: unknown;
    folderExpanded?: unknown;
    folderNames?: unknown;
    folderNamesExpanded?: unknown;
}

interface RawIconTheme extends RawAssociations {
    iconDefinitions?: unknown;
    fonts?: unknown;
    light?: unknown;
    highContrast?: unknown;
}

export interface BuildFileIconThemeOptions {
    id: string;
    document: unknown;
    colorKind: IconThemeColorKind;
    languages: LanguageContribution[];
    /** Resolves a path from the theme document (relative to the document) to a URI string. */
    resolveResource: (relativePath: string) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeExtensionKey(key: string): string {
    return key.replace(/^\.+/, '').toLowerCase();
}

function mergeAssociationMap(
    target: Record<string, string>,
    source: unknown,
    normalizeKey: (key: string) => string
): void {
    if (!isRecord(source)) {
        return;
    }
    for (const [key, value] of Object.entries(source)) {
        const iconId = asString(value);
        const normalizedKey = normalizeKey(key);
        if (iconId && normalizedKey) {
            target[normalizedKey] = iconId;
        }
    }
}

function toCssFamilyToken(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Decodes CSS-style escapes such as "\\E001" used by font based icon themes.
 */
export function decodeFontCharacter(value: string): string {
    return value.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_match, hex: string) => {
        const codePoint = Number.parseInt(hex, 16);
        return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
    });
}

/**
 * Parses JSON that may contain comments and trailing commas, which VS Code accepts in icon theme files.
 */
export function parseJsonWithComments(text: string): unknown {
    let result = '';
    let inString = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            result += ch;
            if (ch === '\\') {
                result += text[i + 1] ?? '';
                i++;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            result += ch;
        } else if (ch === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') {
                i++;
            }
            result += '\n';
        } else if (ch === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end === -1 ? text.length : end + 1;
        } else if (ch === '}' || ch === ']') {
            result = result.replace(/,\s*$/, '') + ch;
        } else {
            result += ch;
        }
    }

    return JSON.parse(result.replace(/^\uFEFF/, ''));
}

/**
 * Flattens a VS Code file icon theme document into the lookup tables used by the webview.
 * Mirrors the precedence VS Code applies: file name, file extension, language id, default file.
 */
export function buildFileIconTheme(options: BuildFileIconThemeOptions): FileIconTheme {
    const { id, document, colorKind, languages, resolveResource } = options;
    if (!isRecord(document)) {
        throw new Error(`Invalid file icon theme document: ${id}`);
    }
    const raw = document as RawIconTheme;

    const layers: unknown[] = [raw];
    if (colorKind === 'light') {
        layers.push(raw.light);
    } else if (colorKind === 'highContrast') {
        layers.push(raw.highContrast);
    }

    let file: string | undefined;
    const fileNames: Record<string, string> = {};
    const fileExtensions: Record<string, string> = {};
    const languageIds: Record<string, string> = {};
    let folder: string | undefined;
    let folderExpanded: string | undefined;
    const folderNames: Record<string, string> = {};
    const folderNamesExpanded: Record<string, string> = {};
    for (const layer of layers) {
        if (!isRecord(layer)) {
            continue;
        }
        const associations = layer as RawAssociations;
        file = asString(associations.file) ?? file;
        folder = asString(associations.folder) ?? folder;
        folderExpanded = asString(associations.folderExpanded) ?? folderExpanded;
        mergeAssociationMap(folderNames, associations.folderNames, (key) => key.toLowerCase());
        mergeAssociationMap(folderNamesExpanded, associations.folderNamesExpanded, (key) => key.toLowerCase());
        mergeAssociationMap(fileNames, associations.fileNames, (key) => key.toLowerCase());
        mergeAssociationMap(fileExtensions, associations.fileExtensions, normalizeExtensionKey);
        mergeAssociationMap(languageIds, associations.languageIds, (key) => key);
    }

    const fontsById = new Map<string, { font: FileIconFont; size?: string }>();
    const fonts: FileIconFont[] = [];
    if (Array.isArray(raw.fonts)) {
        for (const rawFont of raw.fonts as RawFont[]) {
            const fontId = isRecord(rawFont) ? asString(rawFont.id) : undefined;
            if (!fontId || !Array.isArray(rawFont.src)) {
                continue;
            }
            const sources = (rawFont.src as unknown[]).flatMap((source) => {
                const sourcePath = isRecord(source) ? asString(source.path) : undefined;
                if (!sourcePath) {
                    return [];
                }
                const format = isRecord(source) ? asString(source.format) : undefined;
                return [{ uri: resolveResource(sourcePath), ...(format ? { format } : {}) }];
            });
            if (sources.length === 0) {
                continue;
            }
            const font: FileIconFont = {
                family: `intelli-git-icon-${toCssFamilyToken(id)}-${toCssFamilyToken(fontId)}`,
                sources,
                weight: asString(rawFont.weight),
                style: asString(rawFont.style),
            };
            fonts.push(font);
            fontsById.set(fontId, { font, size: asString(rawFont.size) });
        }
    }
    const defaultFont = fontsById.values().next().value;

    const rawDefinitions = isRecord(raw.iconDefinitions) ? raw.iconDefinitions : {};
    const iconDefinitions: Record<string, FileIconDefinition> = {};
    const resolveDefinition = (iconId: string | undefined): boolean => {
        if (!iconId) {
            return false;
        }
        if (iconDefinitions[iconId]) {
            return true;
        }
        const rawDefinition = rawDefinitions[iconId];
        if (!isRecord(rawDefinition)) {
            return false;
        }
        const definition = rawDefinition as RawIconDefinition;
        const iconPath = asString(definition.iconPath);
        if (iconPath) {
            iconDefinitions[iconId] = { iconUri: resolveResource(iconPath) };
            return true;
        }
        const fontCharacter = asString(definition.fontCharacter);
        if (fontCharacter) {
            const fontId = asString(definition.fontId);
            const font = (fontId ? fontsById.get(fontId) : undefined) ?? defaultFont;
            iconDefinitions[iconId] = {
                fontCharacter: decodeFontCharacter(fontCharacter),
                fontColor: asString(definition.fontColor),
                fontSize: asString(definition.fontSize) ?? font?.size,
                fontFamily: font?.font.family,
            };
            return true;
        }
        return false;
    };

    const keepResolvable = (associations: Record<string, string>): Record<string, string> =>
        Object.fromEntries(Object.entries(associations).filter(([, iconId]) => resolveDefinition(iconId)));

    const resolvedLanguageIds = keepResolvable(languageIds);
    const languageFileNames: Record<string, string> = {};
    const languageExtensions: Record<string, string> = {};
    for (const language of languages) {
        if (!resolvedLanguageIds[language.id]) {
            continue;
        }
        for (const fileName of language.filenames ?? []) {
            const key = typeof fileName === 'string' ? fileName.toLowerCase() : '';
            if (key && !languageFileNames[key]) {
                languageFileNames[key] = language.id;
            }
        }
        for (const extension of language.extensions ?? []) {
            const key = typeof extension === 'string' ? normalizeExtensionKey(extension) : '';
            if (key && !languageExtensions[key]) {
                languageExtensions[key] = language.id;
            }
        }
    }

    return {
        id,
        iconDefinitions,
        fonts,
        file: resolveDefinition(file) ? file : undefined,
        fileNames: keepResolvable(fileNames),
        fileExtensions: keepResolvable(fileExtensions),
        languageIds: resolvedLanguageIds,
        languageFileNames,
        languageExtensions,
        folder: resolveDefinition(folder) ? folder : undefined,
        folderExpanded: resolveDefinition(folderExpanded) ? folderExpanded : undefined,
        folderNames: keepResolvable(folderNames),
        folderNamesExpanded: keepResolvable(folderNamesExpanded),
    };
}

/**
 * Returns a copy of the theme with every resource URI rewritten (for example through `webview.asWebviewUri`).
 */
export function mapFileIconThemeResources(theme: FileIconTheme, mapUri: (uri: string) => string): FileIconTheme {
    return {
        ...theme,
        iconDefinitions: Object.fromEntries(
            Object.entries(theme.iconDefinitions).map(([iconId, definition]) => [
                iconId,
                definition.iconUri ? { ...definition, iconUri: mapUri(definition.iconUri) } : definition,
            ])
        ),
        fonts: theme.fonts.map((font) => ({
            ...font,
            sources: font.sources.map((source) => ({ ...source, uri: mapUri(source.uri) })),
        })),
    };
}
