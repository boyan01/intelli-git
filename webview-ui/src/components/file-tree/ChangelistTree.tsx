import React, { useState, useCallback, useRef } from 'react';
import type { ChangelistGroup } from '@shared/messages';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '../common/ContextMenu';
import type { ContextMenuItem } from '../common/ContextMenu';
import { BaseFileTree } from './BaseFileTree';
import type { BaseFileTreeRef } from './BaseFileTree';
import styles from './BaseFileTree.module.css';
import { rpc } from '@/lib/rpc_client';

export interface ChangelistTreeProps {
    group: ChangelistGroup;
    viewMode: 'tree' | 'list';
    selectedFiles: Set<string>;
    isCollapsed: boolean;
    activeFile?: string | null;
    onToggleFile: (path: string, checked: boolean) => void;
    onToggleCollapse: () => void;
    readonly?: boolean;
    onRollback?: (files: string[]) => void;
    onStash?: (files: string[]) => void;
    onDelete?: (files: string[]) => void;
    onMoveToChangelist?: (files: string[]) => void;
}

export interface ChangelistTreeRef {
    expandAll: () => void;
    collapseAll: () => void;
}

interface ContextMenuState {
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
}

export const ChangelistTree = React.forwardRef<ChangelistTreeRef, ChangelistTreeProps>(({
    group,
    viewMode,
    selectedFiles,
    isCollapsed,
    activeFile,
    onToggleFile,
    onToggleCollapse,
    readonly = false,
    onRollback,
    onStash,
    onDelete,
    onMoveToChangelist
}, ref) => {
    const { t } = useTranslation();
    const treeRef = useRef<BaseFileTreeRef>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({
        visible: false,
        x: 0,
        y: 0,
        items: []
    });

    React.useImperativeHandle(ref, () => ({
        expandAll: () => treeRef.current?.expandAll(),
        collapseAll: () => treeRef.current?.collapseAll()
    }));

    const closeContextMenu = useCallback(() => {
        setContextMenu(prev => ({ ...prev, visible: false }));
    }, []);

    const handleFileClick = useCallback((path: string) => {
        rpc.openFile({ path });
    }, []);

    const buildFileContextMenu = useCallback((path: string): ContextMenuItem[] => {
        return [
            {
                icon: 'go-to-file',
                label: t('Open File'),
                onClick: () => handleFileClick(path)
            },
            { separator: true, label: '', onClick: () => { } },
            {
                icon: 'discard',
                label: t('Rollback'),
                onClick: () => onRollback?.([path])
            },
            {
                icon: 'archive',
                label: t('Stash'),
                onClick: () => onStash?.([path])
            },
            { separator: true, label: '', onClick: () => { } },
            {
                icon: 'trash',
                label: t('Delete from Disk'),
                onClick: () => onDelete?.([path])
            },
            {
                icon: 'new-folder',
                label: t('Move to Changelist...'),
                onClick: () => onMoveToChangelist?.([path])
            }
        ];
    }, [handleFileClick, onRollback, onStash, onDelete, onMoveToChangelist, t]);

    const buildFolderContextMenu = useCallback((filePaths: string[]): ContextMenuItem[] => {
        return [
            {
                icon: 'check-all',
                label: t('Select All'),
                onClick: () => filePaths.forEach(p => onToggleFile(p, true))
            },
            {
                icon: 'close-all',
                label: t('Deselect All'),
                onClick: () => filePaths.forEach(p => onToggleFile(p, false))
            },
            { separator: true, label: '', onClick: () => { } },
            {
                icon: 'discard',
                label: t('Rollback All'),
                onClick: () => onRollback?.(filePaths)
            },
            {
                icon: 'archive',
                label: t('Stash All'),
                onClick: () => onStash?.(filePaths)
            }
        ];
    }, [onToggleFile, onRollback, onStash, t]);

    const handleFileContextMenu = useCallback((e: React.MouseEvent, path: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: buildFileContextMenu(path)
        });
    }, [buildFileContextMenu]);

    const handleFolderContextMenu = useCallback((e: React.MouseEvent, filePaths: string[]) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            items: buildFolderContextMenu(filePaths)
        });
    }, [buildFolderContextMenu]);

    const handleGroupToggle = useCallback((checked: boolean) => {
        if (readonly) return;
        group.items.forEach(f => onToggleFile(f.path, checked));
    }, [readonly, group.items, onToggleFile]);

    const allSelected = group.items.length > 0 && group.items.every(f => selectedFiles.has(f.path));
    const partialSelected = !allSelected && group.items.some(f => selectedFiles.has(f.path));

    const renderTree = () => (
        <BaseFileTree
            ref={treeRef}
            items={group.items}
            viewMode={viewMode}
            selectedFiles={selectedFiles}
            activeFile={activeFile}
            readonly={readonly}
            onToggleFile={onToggleFile}
            onFileClick={handleFileClick}
            onFileContextMenu={handleFileContextMenu}
            onFolderContextMenu={handleFolderContextMenu}
        />
    );

    // Normal mode: render with header
    return (
        <>
            <div className={styles.changelistTree}>
                <div
                    className={styles.folderHeader}
                    onClick={onToggleCollapse}
                >
                    <span
                        className={`codicon codicon-chevron-right ${styles.icon} ${styles.arrow}`}
                        style={{ transform: isCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.1s' }}
                    ></span>
                    {!readonly && group.items.length > 0 && (
                        <input
                            type="checkbox"
                            className={styles.checkbox}
                            checked={allSelected}
                            ref={input => { if (input) input.indeterminate = partialSelected; }}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleGroupToggle(e.target.checked)}
                        />
                    )}
                    <span className={styles.name}>{group.name}</span>
                    <span className={styles.fileCount}>{group.items.length}</span>
                </div>
                {!isCollapsed && (
                    <div className={styles.changelistContent}>
                        {renderTree()}
                    </div>
                )}
            </div>
            {contextMenu.visible && (
                <ContextMenu
                    items={contextMenu.items}
                    position={{ x: contextMenu.x, y: contextMenu.y }}
                    onClose={closeContextMenu}
                />
            )}
        </>
    );
});
