import React, { useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { rpc } from '@/lib/rpc_client';
import { BaseFileTree } from '../file-tree/BaseFileTree';
import type { BaseFileTreeRef } from '../file-tree/BaseFileTree';
import { ViewModeToggle } from '../common/ViewModeToggle';
import type { CommitDetails, FileStatus } from '@shared/messages';
import styles from './PushTab.module.css';

interface PushChangesViewProps {
    commits: CommitDetails[];
    changesViewMode: 'tree' | 'list';
    setChangesViewMode: (mode: 'tree' | 'list') => void;
    activeFile?: { path: string; commitHash?: string } | null;
}

export const PushChangesView: React.FC<PushChangesViewProps> = ({
    commits,
    changesViewMode,
    setChangesViewMode,
    activeFile
}) => {
    const { t } = useTranslation();
    const treeRef = useRef<BaseFileTreeRef>(null);

    const handleOpenFile = useCallback((path: string, preserveFocus: boolean) => {
        if (commits.length === 0) return;

        const firstCommit = commits[commits.length - 1];
        const lastCommit = commits[0];

        const firstParent = firstCommit.parentHashes.length > 0
            ? firstCommit.parentHashes[0]
            : '';

        rpc.openCommitDiff({
            path,
            leftRef: firstParent,
            rightRef: lastCommit.hash,
            preserveFocus
        });
    }, [commits]);

    // Memoize aggregated files
    const allFiles = useMemo(() => {
        const fileMap = new Map<string, FileStatus>();
        commits.forEach(commit => {
            commit.files.forEach(f => {
                fileMap.set(f.path, { 
                    path: f.path, 
                    displayPath: f.displayPath,
                    status: f.status, 
                    staged: false 
                });
            });
        });
        return Array.from(fileMap.values());
    }, [commits]);

    return (
        <div className={styles.changesSection}>
            <div className={styles.changesHeader}>
                <span className={styles.changesDescription}>
                    {t('Aggregated changes from all {{count}} pending commits.', { count: commits.length })}
                </span>
            </div>
            <div className={styles.filesHeader}>
                <span className={styles.filesCount}>
                    {t('{{count}} files', { count: allFiles.length })}
                </span>
                <div className={styles.filesActions}>
                    <ViewModeToggle viewMode={changesViewMode} onChange={setChangesViewMode} />
                    <button
                        className={styles.iconBtn}
                        onClick={() => treeRef.current?.expandAll()}
                        title={t('Expand All')}
                    >
                        <i className="codicon codicon-expand-all" />
                    </button>
                    <button
                        className={styles.iconBtn}
                        onClick={() => treeRef.current?.collapseAll()}
                        title={t('Collapse All')}
                    >
                        <i className="codicon codicon-collapse-all" />
                    </button>
                </div>
            </div>
            <div className={styles.filesTreeWrapper}>
                <BaseFileTree
                    ref={treeRef}
                    items={allFiles}
                    viewMode={changesViewMode}
                    readonly={true}
                    onFileClick={(path) => handleOpenFile(path, true)}
                    selectedFiles={new Set()}
                    activeFile={activeFile?.path ?? null}
                    onToggleFile={() => { }}
                    onFileDoubleClick={(path) => handleOpenFile(path, false)}
                    stickyHeaders={true}
                />
            </div>
        </div>
    );
};
