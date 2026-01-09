import React, { useCallback, useRef } from 'react';
import type { ChangelistGroup } from '@shared/messages';
import { BaseFileTree } from '../file-tree/BaseFileTree';
import type { BaseFileTreeRef } from '../file-tree/BaseFileTree';
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
}

export interface ChangelistTreeRef {
    expandAll: () => void;
    collapseAll: () => void;
}

export const ChangelistTree = React.forwardRef<ChangelistTreeRef, ChangelistTreeProps>(({
    group,
    viewMode,
    selectedFiles,
    isCollapsed,
    activeFile,
    onToggleFile,
    onToggleCollapse,
    readonly = false
}, ref) => {
    const treeRef = useRef<BaseFileTreeRef>(null);

    React.useImperativeHandle(ref, () => ({
        expandAll: () => treeRef.current?.expandAll(),
        collapseAll: () => treeRef.current?.collapseAll()
    }));

    const handleFileClick = useCallback((path: string) => {
        rpc.openFile({ path, preserveFocus: true });
    }, []);

    const handleFileDoubleClick = useCallback((path: string) => {
        rpc.openFile({ path, preserveFocus: false });
    }, []);

    return (
        <BaseFileTree
            ref={treeRef}
            items={group.items}
            viewMode={viewMode}
            selectedFiles={selectedFiles}
            activeFile={activeFile}
            readonly={readonly}
            rootLabel={group.name}
            isCollapsed={isCollapsed}
            onToggleCollapse={onToggleCollapse}
            onToggleFile={onToggleFile}
            onFileClick={handleFileClick}
            onFileDoubleClick={handleFileDoubleClick}
            contextMenuSection="changelistFile"
        />
    );
});
