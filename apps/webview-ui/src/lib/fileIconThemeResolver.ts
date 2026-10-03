import type { FileIconDefinition, FileIconTheme } from '@shared/messages';

const resolvedIconCache = new WeakMap<FileIconTheme, Map<string, FileIconDefinition | null>>();

function findByExtension(lookup: Record<string, string>, segments: string[]): string | undefined {
    // Longest extension wins, matching VS Code: "a.d.ts" tries "d.ts" before "ts".
    for (let i = 1; i < segments.length; i++) {
        const match = lookup[segments.slice(i).join('.')];
        if (match) {
            return match;
        }
    }
    return undefined;
}

function resolveIconId(theme: FileIconTheme, fileName: string): string | undefined {
    const name = fileName.toLowerCase();
    const segments = name.split('.');

    const nameOrExtensionIcon = theme.fileNames[name] ?? findByExtension(theme.fileExtensions, segments);
    if (nameOrExtensionIcon) {
        return nameOrExtensionIcon;
    }

    const languageId = theme.languageFileNames[name] ?? findByExtension(theme.languageExtensions, segments);
    return (languageId ? theme.languageIds[languageId] : undefined) ?? theme.file;
}

/**
 * Resolves the icon for a file base name using VS Code precedence:
 * file name, file extension, language id, then the theme's default file icon.
 */
export function resolveFileIcon(theme: FileIconTheme, fileName: string): FileIconDefinition | undefined {
    let cache = resolvedIconCache.get(theme);
    if (!cache) {
        cache = new Map();
        resolvedIconCache.set(theme, cache);
    }

    const cached = cache.get(fileName);
    if (cached !== undefined) {
        return cached ?? undefined;
    }

    const iconId = resolveIconId(theme, fileName);
    const definition = iconId ? theme.iconDefinitions[iconId] : undefined;
    cache.set(fileName, definition ?? null);
    return definition;
}

/**
 * Resolves the icon for a folder base name using VS Code precedence:
 * expanded folder name, folder name, then the theme's default (expanded) folder icon.
 */
export function resolveFolderIcon(
    theme: FileIconTheme,
    folderName: string,
    expanded: boolean
): FileIconDefinition | undefined {
    const name = folderName.toLowerCase();
    const iconId = expanded
        ? (theme.folderNamesExpanded[name] ?? theme.folderNames[name] ?? theme.folderExpanded ?? theme.folder)
        : (theme.folderNames[name] ?? theme.folder);
    return iconId ? theme.iconDefinitions[iconId] : undefined;
}
