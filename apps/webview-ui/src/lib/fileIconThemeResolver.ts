import type { FileIconDefinition, FileIconTheme } from '@shared/messages';

const resolvedIconCache = new WeakMap<FileIconTheme, Map<string, FileIconDefinition | null>>();
const globCache = new Map<string, RegExp>();

interface PathParts {
    /** Lower-cased path with "/" separators. */
    path: string;
    /** Lower-cased base name. */
    name: string;
    /** Lower-cased immediate parent folder name; VS Code only qualifies associations by this one level. */
    parent?: string;
}

function splitPath(value: string): PathParts {
    const segments = value.toLowerCase().replace(/\\/g, '/').split('/').filter(Boolean);
    const name = segments.pop() ?? '';
    return { path: [...segments, name].join('/'), name, parent: segments.pop() };
}

function lookupQualified(lookup: Record<string, string>, key: string, parent: string | undefined) {
    return (parent !== undefined ? lookup[`${parent}/${key}`] : undefined) ?? lookup[key];
}

function findByExtension(lookup: Record<string, string>, name: string, parent?: string): string | undefined {
    // A rule's specificity is its extension segment count plus one when it names a parent folder,
    // mirroring the CSS selectors VS Code generates. Longer extensions win ties.
    const segments = name.split('.');
    let best: { iconId: string; score: number } | undefined;
    for (let i = 1; i < segments.length; i++) {
        const extension = segments.slice(i).join('.');
        const segmentCount = segments.length - i;
        const qualified = parent !== undefined ? lookup[`${parent}/${extension}`] : undefined;
        if (qualified && (!best || segmentCount + 1 > best.score)) {
            best = { iconId: qualified, score: segmentCount + 1 };
        }
        const plain = lookup[extension];
        if (plain && (!best || segmentCount > best.score)) {
            best = { iconId: plain, score: segmentCount };
        }
    }
    return best?.iconId;
}

/** Converts a VS Code glob (case-insensitive) into a regular expression. */
export function globToRegExp(pattern: string): RegExp {
    const cached = globCache.get(pattern);
    if (cached) {
        return cached;
    }

    let source = '';
    let inGroup = false;
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch === '*') {
            if (pattern[i + 1] === '*') {
                const atSegmentStart = i === 0 || pattern[i - 1] === '/';
                if (atSegmentStart && pattern[i + 2] === '/') {
                    source += '(?:.*/)?';
                    i += 2;
                } else {
                    source += '.*';
                    i += 1;
                }
            } else {
                source += '[^/]*';
            }
        } else if (ch === '?') {
            source += '[^/]';
        } else if (ch === '{') {
            inGroup = true;
            source += '(?:';
        } else if (ch === '}' && inGroup) {
            inGroup = false;
            source += ')';
        } else if (ch === ',' && inGroup) {
            source += '|';
        } else if (ch === '[') {
            const end = pattern.indexOf(']', i + 1);
            if (end === -1) {
                source += '\\[';
            } else {
                const body = pattern.slice(i + 1, end).replace(/\\/g, '\\\\');
                source += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`;
                i = end;
            }
        } else {
            source += ch.replace(/[.+^$()|\\\]]/g, '\\$&');
        }
    }

    const regExp = new RegExp(`^${source}$`, 'i');
    globCache.set(pattern, regExp);
    return regExp;
}

function detectLanguage(theme: FileIconTheme, parts: PathParts): string | undefined {
    const byFileName = theme.languageFileNames[parts.name];
    if (byFileName) {
        return byFileName;
    }

    // Longest matching pattern wins; patterns are ordered last registered first, which wins ties.
    let patternMatch: { languageId: string; length: number } | undefined;
    for (const { pattern, languageId } of theme.languageFilenamePatterns) {
        if (patternMatch && pattern.length <= patternMatch.length) {
            continue;
        }
        const target = pattern.includes('/') ? parts.path : parts.name;
        if (globToRegExp(pattern).test(target)) {
            patternMatch = { languageId, length: pattern.length };
        }
    }
    return patternMatch?.languageId ?? findByExtension(theme.languageExtensions, parts.name);
}

function resolveIconId(theme: FileIconTheme, filePath: string): string | undefined {
    const parts = splitPath(filePath);

    const nameOrExtensionIcon =
        lookupQualified(theme.fileNames, parts.name, parts.parent) ??
        findByExtension(theme.fileExtensions, parts.name, parts.parent);
    if (nameOrExtensionIcon) {
        return nameOrExtensionIcon;
    }

    const languageId = Object.keys(theme.languageIds).length > 0 ? detectLanguage(theme, parts) : undefined;
    return (languageId ? theme.languageIds[languageId] : undefined) ?? theme.file;
}

/**
 * Resolves the icon for a file path (relative paths are enough) using VS Code precedence:
 * file name, file extension, language id, then the theme's default file icon.
 * Rules qualified by the parent folder, such as "system/win.ini", beat unqualified rules of the same kind.
 */
export function resolveFileIcon(theme: FileIconTheme, filePath: string): FileIconDefinition | undefined {
    let cache = resolvedIconCache.get(theme);
    if (!cache) {
        cache = new Map();
        resolvedIconCache.set(theme, cache);
    }

    const cached = cache.get(filePath);
    if (cached !== undefined) {
        return cached ?? undefined;
    }

    const iconId = resolveIconId(theme, filePath);
    const definition = iconId ? theme.iconDefinitions[iconId] : undefined;
    cache.set(filePath, definition ?? null);
    return definition;
}

/**
 * Resolves the icon for a folder path using VS Code precedence:
 * expanded folder name, folder name, then the theme's default (expanded) folder icon.
 * Rules qualified by the parent folder, such as ".github/workflows", beat unqualified rules.
 */
export function resolveFolderIcon(
    theme: FileIconTheme,
    folderPath: string,
    expanded: boolean
): FileIconDefinition | undefined {
    const { name, parent } = splitPath(folderPath);
    const iconId = expanded
        ? (lookupQualified(theme.folderNamesExpanded, name, parent) ??
          lookupQualified(theme.folderNames, name, parent) ??
          theme.folderExpanded ??
          theme.folder)
        : (lookupQualified(theme.folderNames, name, parent) ?? theme.folder);
    return iconId ? theme.iconDefinitions[iconId] : undefined;
}

/** Themes such as Seti draw no folder icons; their trees follow the compact VS Code Explorer layout. */
export function hasFolderIcons(theme: FileIconTheme): boolean {
    return Boolean(
        theme.folder ||
        theme.folderExpanded ||
        Object.keys(theme.folderNames).length > 0 ||
        Object.keys(theme.folderNamesExpanded).length > 0
    );
}
