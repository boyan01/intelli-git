import { useState, useEffect, useRef, useCallback } from 'react';
import type { StashItem, CommitFile, FileStatus } from '@shared/messages';
import { useTranslation } from 'react-i18next';
import { useRpcData } from '../../hooks/useRpcData';
import { usePersistedState } from '../../hooks/usePersistedState';
import { rpc } from '../../lib/rpc_client';
import { SplitPane } from '../common/SplitPane';
import { BaseFileTree } from '../file-tree/BaseFileTree';
import type { BaseFileTreeRef } from '../file-tree/BaseFileTree';
import styles from './StashView.module.css';

export function StashView() {
    const { t } = useTranslation();
    const { data: stashes, loading } = useRpcData(() => rpc.getStashList(), { initialValue: [] as StashItem[] });
    const [selectedIndex, setSelectedIndex] = usePersistedState('stash.selectedIndex');
    const [viewMode, setViewMode] = usePersistedState('stash.viewMode');
    const [files, setFiles] = useState<CommitFile[]>([]);
    const [filesLoading, setFilesLoading] = useState(false);
    const treeRef = useRef<BaseFileTreeRef>(null);

    // Auto-select first stash when loaded
    useEffect(() => {
        if (!loading && stashes.length > 0 && selectedIndex === null) {
            setSelectedIndex(stashes[0].index);
        }
    }, [loading, stashes, selectedIndex, setSelectedIndex]);

    // Load files for selected stash
    useEffect(() => {
        if (selectedIndex !== null) {
            setFilesLoading(true);
            rpc.getStashFiles(selectedIndex)
                .then(setFiles)
                .catch(() => setFiles([]))
                .finally(() => setFilesLoading(false));
        } else {
            setFiles([]);
        }
    }, [selectedIndex]);

    const handleStashClick = useCallback((index: number) => {
        setSelectedIndex(index);
    }, [setSelectedIndex]);

    const handleExpandAll = useCallback(() => {
        treeRef.current?.expandAll();
    }, []);

    const handleCollapseAll = useCallback(() => {
        treeRef.current?.collapseAll();
    }, []);

    if (loading) return null;

    if (!stashes || stashes.length === 0) {
        return <div className={styles.emptyState}>{t('stashList.empty')}</div>;
    }

    const fileItems: FileStatus[] = files.map(f => ({
        path: f.path,
        status: f.status,
        staged: false
    }));

    return (
        <SplitPane
            direction="vertical"
            defaultRatio={0.4}
            minSize={50}
            first={
                <div className={styles.stashList}>
                    {stashes.map((stash) => (
                        <div
                            key={stash.index}
                            className={`${styles.stashItem} ${selectedIndex === stash.index ? styles.selected : ''}`}
                            data-vscode-context={JSON.stringify({
                                webviewSection: 'stashItem',
                                stashIndex: stash.index
                            })}
                            onClick={() => handleStashClick(stash.index)}
                        >
                            <span className={styles.stashItemName}>
                                {stash.message || `Stash@{${stash.index}}`}
                            </span>
                            <span className={styles.stashItemBranch}>
                                <i className="codicon codicon-git-branch" />
                                {stash.branch || 'HEAD'}
                            </span>
                        </div>
                    ))}
                </div>
            }
            second={
                <div className={styles.previewSection}>
                    <div className={styles.previewHeader}>
                        <span className={styles.previewTitle}>{t('stashList.preview.title')}</span>
                        <div className={styles.previewActions}>
                            <button
                                className={styles.iconBtn}
                                title={t('stashList.preview.expandAll')}
                                onClick={handleExpandAll}
                            >
                                <i className="codicon codicon-expand-all" />
                            </button>
                            <button
                                className={styles.iconBtn}
                                title={t('stashList.preview.collapseAll')}
                                onClick={handleCollapseAll}
                            >
                                <i className="codicon codicon-collapse-all" />
                            </button>
                            <button
                                className={`${styles.iconBtn} ${viewMode === 'tree' ? styles.active : ''}`}
                                title={t('stashList.preview.treeView')}
                                onClick={() => setViewMode('tree')}
                            >
                                <i className="codicon codicon-list-tree" />
                            </button>
                            <button
                                className={`${styles.iconBtn} ${viewMode === 'list' ? styles.active : ''}`}
                                title={t('stashList.preview.listView')}
                                onClick={() => setViewMode('list')}
                            >
                                <i className="codicon codicon-list-flat" />
                            </button>
                        </div>
                    </div>
                    <div className={styles.previewContent}>
                        {filesLoading ? null : (
                            fileItems.length > 0 ? (
                                <BaseFileTree
                                    ref={treeRef}
                                    items={fileItems}
                                    viewMode={viewMode}
                                    readonly
                                />
                            ) : (
                                <div className={styles.emptyPreview}>
                                    {selectedIndex !== null ? t('stashList.preview.noFiles') : t('stashList.preview.selectStash')}
                                </div>
                            )
                        )}
                    </div>
                </div>
            }
        />
    );
}
