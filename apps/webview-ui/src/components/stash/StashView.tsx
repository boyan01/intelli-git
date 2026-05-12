import { useState, useEffect, useRef, useCallback } from 'react';
import type { StashItem, CommitFile, FileStatus } from '@shared/messages';
import type { StashItemContext } from '@shared/webviewContext';
import { useTranslation } from 'react-i18next';
import { useRpcData } from '../../hooks/useRpcData';
import { usePersistedState } from '../../hooks/usePersistedState';
import { rpc } from '../../lib/rpc_client';
import { SplitPane } from '../common/SplitPane';
import { ViewModeToggle } from '../common/ViewModeToggle';
import { BaseFileTree } from '../file-tree/BaseFileTree';
import type { BaseFileTreeRef } from '../file-tree/BaseFileTree';
import styles from './StashView.module.css';

export function StashView() {
    const { t } = useTranslation();
    const loadStashes = useCallback(() => rpc.getStashList(), []);
    const { data: stashes, loading } = useRpcData(loadStashes, { initialValue: [] as StashItem[] });
    const [selectedIndex, setSelectedIndex] = usePersistedState('stash.selectedIndex');
    const [viewMode, setViewMode] = usePersistedState('stash.viewMode');
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const treeRef = useRef<BaseFileTreeRef>(null);

    // Auto-select first stash when loaded
    useEffect(() => {
        if (!loading && stashes.length > 0 && selectedIndex === null) {
            setSelectedIndex(stashes[0].index);
        }
    }, [loading, stashes, selectedIndex, setSelectedIndex]);

    const loadStashFiles = useCallback(() => rpc.getStashFiles(selectedIndex!), [selectedIndex]);

    // Load files for selected stash
    const { data: files, loading: filesLoading } = useRpcData(
        loadStashFiles,
        {
            initialValue: [] as CommitFile[],
            refreshOnEvent: true
        }
    );



    const handleStashClick = useCallback((index: number) => {
        setSelectedIndex(index);
        setSelectedFile(null);
    }, [setSelectedIndex]);

    const handleExpandAll = useCallback(() => {
        treeRef.current?.expandAll();
    }, []);

    const handleCollapseAll = useCallback(() => {
        treeRef.current?.collapseAll();
    }, []);


    const handleFileClick = useCallback((path: string) => {
        setSelectedFile(path);
    }, []);

    const handleFileDoubleClick = useCallback((path: string) => {
        if (selectedIndex !== null) {
            rpc.openStashDiff({ index: selectedIndex, path }).catch(e => {
                console.error('Failed to open stash diff:', e);
            });
        }
    }, [selectedIndex]);

    const handleStashDoubleClick = useCallback((index: number) => {
        if (selectedIndex === index && selectedFile) {
            rpc.openStashDiff({ index, path: selectedFile });
        } else if (selectedIndex === index && files.length > 0) {
            // If no specific file selected, open first
            rpc.openStashDiff({ index, path: files[0].path });
            setSelectedFile(files[0].path);
        }
    }, [selectedIndex, selectedFile, files]);

    if (loading) return null;

    if (!stashes || stashes.length === 0) {
        return <div className={styles.emptyState}>{t('No stashed changes')}</div>;
    }

    const fileItems: FileStatus[] = files.map(f => ({
        path: f.path,
        displayPath: f.displayPath,
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
                                stashIndex: stash.index,
                                selectedStashFile: selectedFile,
                            } satisfies StashItemContext)}
                            onClick={() => handleStashClick(stash.index)}
                            onDoubleClick={() => handleStashDoubleClick(stash.index)}
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
                        <span className={styles.previewTitle}>{t('Stored files')}</span>
                        <div className={styles.previewActions}>
                            <button
                                className={styles.iconBtn}
                                title={t('Expand All')}
                                onClick={handleExpandAll}
                            >
                                <i className="codicon codicon-expand-all" />
                            </button>
                            <button
                                className={styles.iconBtn}
                                title={t('Collapse All')}
                                onClick={handleCollapseAll}
                            >
                                <i className="codicon codicon-collapse-all" />
                            </button>
                            <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
                        </div>
                    </div>
                    <div className={styles.previewContent}>
                        {filesLoading ? null : (
                            fileItems.length > 0 ? (
                                <BaseFileTree
                                    ref={treeRef}
                                    items={fileItems}
                                    viewMode={viewMode}
                                    activeFile={selectedFile}
                                    readonly
                                    onFileClick={handleFileClick}
                                    onFileDoubleClick={handleFileDoubleClick}
                                    stickyHeaders={true}
                                />
                            ) : (
                                <div className={styles.emptyPreview}>
                                    {selectedIndex !== null ? t('No files in this stash') : t('Select a stash to view files')}
                                </div>
                            )
                        )}
                    </div>
                </div>
            }
        />
    );
}
