import React, { useMemo } from 'react';
import styles from './BranchListPanel.module.css';

interface BranchTreeNodeProps {
    label: string;
    level: number;
    isExpanded?: boolean;
    isLeaf: boolean;
    isSelected?: boolean;
    icon?: string; // codicon class name or character
    highlightMatch?: string;
    onToggle?: () => void;
    onSelect?: () => void;
    contextMenuParams?: Record<string, any>;
}

export const BranchTreeNode: React.FC<BranchTreeNodeProps> = ({
    label,
    level,
    isExpanded,
    isLeaf,
    isSelected,
    icon,
    highlightMatch,
    onToggle,
    onSelect,
    contextMenuParams
}) => {
    // Generate data-vscode-context for context menu
    // The webview wrapper handles converting this to the event context
    const contextData = useMemo(() => {
        if (!contextMenuParams) return undefined;
        return JSON.stringify(contextMenuParams);
    }, [contextMenuParams]);

    const renderLabel = () => {
        if (!highlightMatch || !label.toLowerCase().includes(highlightMatch.toLowerCase())) {
            return label;
        }

        const parts: React.ReactNode[] = [];
        const regex = new RegExp(`(${highlightMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');

        let lastIndex = 0;
        let match;

        while ((match = regex.exec(label)) !== null) {
            if (match.index > lastIndex) {
                parts.push(label.substring(lastIndex, match.index));
            }
            parts.push(<span key={match.index} className={styles.highlight}>{match[0]}</span>);
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < label.length) {
            parts.push(label.substring(lastIndex));
        }

        return parts;
    };

    return (
        <div
            className={`${styles.treeNode} ${isSelected ? styles.selected : ''}`}
            style={{ paddingLeft: `${level * 16}px` }}
            onClick={(e) => {
                e.stopPropagation();
                if (isLeaf) {
                    onSelect?.();
                } else {
                    onToggle?.();
                }
            }}
            onContextMenu={isLeaf ? undefined : undefined} // Context menu usually on leaves (branches)
            {...(isLeaf ? { 'data-vscode-context': contextData } : {})}
        >
            <div className={styles.expandIcon} onClick={(e) => {
                e.stopPropagation();
                onToggle?.();
            }}>
                {!isLeaf && (
                    <i className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`} />
                )}
            </div>

            {icon && (
                <div className={styles.icon}>
                    <i className={`codicon codicon-${icon}`} />
                </div>
            )}

            <div className={styles.label} title={label}>
                {renderLabel()}
            </div>
        </div>
    );
};
