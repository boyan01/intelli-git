import type { FileIconDefinition } from '@shared/messages';
import { getFileIcon } from '../../lib/fileIcons';
import { useFileIconTheme } from '../../lib/fileIconTheme';
import { resolveFileIcon, resolveFolderIcon } from '../../lib/fileIconThemeResolver';
import styles from './FileIcon.module.css';

interface FileIconProps {
    /** File base name used to resolve the icon. */
    name: string;
    /** Class applied to the fixed-size icon container. */
    className?: string;
    /** Color override applied only to the bundled fallback icons. */
    fallbackColor?: string;
}

interface FolderIconProps {
    /** Folder label; compacted labels such as "src/lib" resolve by their last segment. */
    name: string;
    expanded: boolean;
    /** Class applied to the fixed-size icon container. */
    className?: string;
    /** Class applied to the codicon used when no file icon theme is available. */
    fallbackClassName?: string;
}

function joinClassNames(...classNames: Array<string | undefined>): string {
    return classNames.filter(Boolean).join(' ');
}

function ThemeIcon({ icon, className }: { icon: FileIconDefinition | undefined; className?: string }) {
    const containerClassName = joinClassNames(styles.container, className);

    if (icon?.iconUri) {
        return (
            <span className={containerClassName} aria-hidden="true">
                <img className={styles.image} src={icon.iconUri} alt="" draggable={false} />
            </span>
        );
    }

    if (icon?.fontCharacter) {
        return (
            <span className={containerClassName} aria-hidden="true">
                <span
                    className={styles.glyph}
                    style={{
                        fontFamily: icon.fontFamily ? `"${icon.fontFamily}"` : undefined,
                        fontSize: icon.fontSize,
                        color: icon.fontColor,
                    }}
                >
                    {icon.fontCharacter}
                </span>
            </span>
        );
    }

    // Loading, or the theme has no icon for this item (for example file icons are disabled).
    return <span className={containerClassName} aria-hidden="true" />;
}

/**
 * Renders a file icon from the user's active VS Code file icon theme,
 * falling back to the bundled Seti icons when the theme cannot be resolved.
 */
export function FileIcon({ name, className, fallbackColor }: FileIconProps) {
    const themeState = useFileIconTheme();

    if (themeState.status === 'unavailable') {
        const fallback = getFileIcon(name);
        return (
            <span
                className={joinClassNames(styles.container, className)}
                style={{ color: fallbackColor || fallback.color }}
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: fallback.svg }}
            />
        );
    }

    const icon = themeState.status === 'ready' ? resolveFileIcon(themeState.theme, name) : undefined;
    return <ThemeIcon icon={icon} className={className} />;
}

/**
 * Renders a folder icon from the user's active VS Code file icon theme,
 * falling back to the folder codicon when the theme cannot be resolved.
 */
export function FolderIcon({ name, expanded, className, fallbackClassName }: FolderIconProps) {
    const themeState = useFileIconTheme();

    if (themeState.status === 'unavailable') {
        return (
            <span
                className={joinClassNames(
                    'codicon',
                    expanded ? 'codicon-folder-opened' : 'codicon-folder',
                    fallbackClassName
                )}
                aria-hidden="true"
            />
        );
    }

    const folderName = name.split('/').pop() ?? name;
    const icon = themeState.status === 'ready' ? resolveFolderIcon(themeState.theme, folderName, expanded) : undefined;
    return <ThemeIcon icon={icon} className={className} />;
}
