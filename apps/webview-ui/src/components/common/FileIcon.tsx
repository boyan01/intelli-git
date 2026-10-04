import type { FileIconDefinition } from '@shared/messages';
import { getFileIcon } from '../../lib/fileIcons';
import { useFileIconTheme } from '../../lib/fileIconTheme';
import { resolveFileIcon, resolveFolderIcon } from '../../lib/fileIconThemeResolver';
import styles from './FileIcon.module.css';

interface FileIconProps {
    /** File path used to resolve the icon; the parent folder matters for folder-qualified theme rules. */
    path: string;
    /** Class applied to the fixed-size icon container. */
    className?: string;
    /** Color override applied only to the bundled fallback icons. */
    fallbackColor?: string;
    /** Label color used to fill icons of themes that set `usesCurrentColor`. */
    labelColor?: string;
}

interface FolderIconProps {
    /** Folder path used to resolve the icon; the parent folder matters for folder-qualified theme rules. */
    path: string;
    expanded: boolean;
    /** Class applied to the fixed-size icon container. */
    className?: string;
    /** Class applied to the codicon used when no file icon theme is available. */
    fallbackClassName?: string;
    /** Label color used to fill icons of themes that set `usesCurrentColor`. */
    labelColor?: string;
}

interface ThemeIconProps {
    icon: FileIconDefinition | undefined;
    usesCurrentColor: boolean;
    labelColor?: string;
    className?: string;
}

function joinClassNames(...classNames: Array<string | undefined>): string {
    return classNames.filter(Boolean).join(' ');
}

function getBaseName(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

function ThemeIcon({ icon, usesCurrentColor, labelColor, className }: ThemeIconProps) {
    const containerClassName = joinClassNames(styles.container, className);

    if (icon?.iconUri && usesCurrentColor) {
        // Matches VS Code: the image is a mask filled with the label's current color.
        const mask = `url("${icon.iconUri}")`;
        return (
            <span className={containerClassName} style={{ color: labelColor }} aria-hidden="true">
                <span className={styles.mask} style={{ maskImage: mask, WebkitMaskImage: mask }} />
            </span>
        );
    }

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

    return null;
}

function IconPlaceholder({ className }: { className?: string }) {
    return <span className={joinClassNames(styles.container, className)} aria-hidden="true" />;
}

/**
 * Renders a file icon from the user's active VS Code file icon theme,
 * falling back to the bundled Seti icons when no icon theme is set or it cannot be resolved.
 */
export function FileIcon({ path, className, fallbackColor, labelColor }: FileIconProps) {
    const themeState = useFileIconTheme();

    if (themeState.status === 'unavailable') {
        const fallback = getFileIcon(getBaseName(path));
        return (
            <span
                className={joinClassNames(styles.container, className)}
                style={{ color: fallbackColor || fallback.color }}
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: fallback.svg }}
            />
        );
    }

    if (themeState.status === 'loading') {
        return <IconPlaceholder className={className} />;
    }

    // Like VS Code, an item without a theme icon takes no icon space.
    const { theme } = themeState;
    return (
        <ThemeIcon
            icon={resolveFileIcon(theme, path)}
            usesCurrentColor={Boolean(theme.usesCurrentColor)}
            labelColor={labelColor}
            className={className}
        />
    );
}

/**
 * Renders a folder icon from the user's active VS Code file icon theme,
 * falling back to the folder codicon when the theme cannot be resolved.
 */
export function FolderIcon({ path, expanded, className, fallbackClassName, labelColor }: FolderIconProps) {
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

    if (themeState.status === 'loading') {
        return <IconPlaceholder className={className} />;
    }

    // Like VS Code, a folder without a theme icon (for example under Seti) takes no icon space.
    const { theme } = themeState;
    return (
        <ThemeIcon
            icon={resolveFolderIcon(theme, path, expanded)}
            usesCurrentColor={Boolean(theme.usesCurrentColor)}
            labelColor={labelColor}
            className={className}
        />
    );
}
