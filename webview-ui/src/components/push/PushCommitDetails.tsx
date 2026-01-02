import { useState, useEffect, useRef } from 'react';
import type { CommitInfo, CommitFile, FileStatus } from '@shared/messages';
import { rpc } from '@/lib/rpc_client';
import { BaseFileTree } from '../file-tree/BaseFileTree';
import type { BaseFileTreeRef } from '../file-tree/BaseFileTree';
import { SplitPane } from '../common/SplitPane';
import { useTranslation } from 'react-i18next';
import styles from './PushCommitDetails.module.css';
import { logger } from '@/lib/log';


export interface PushCommitDetailsProps {
    selectedHashes: string[];
    commit?: CommitInfo | null;
    allCommits: CommitInfo[];
}

export function PushCommitDetails({ selectedHashes, commit, allCommits }: PushCommitDetailsProps) {
    const { t } = useTranslation();
    const [files, setFiles] = useState<CommitFile[]>([]);
    const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
    const [showDetails, setShowDetails] = useState(true);
    const treeRef = useRef<BaseFileTreeRef>(null);

    useEffect(() => {
        const fetchFiles = async () => {
            if (selectedHashes.length === 0) {
                setFiles([]);
                return;
            }
            try {
                const fetchedFiles = await rpc.getMultiCommitFiles(selectedHashes);
                setFiles(fetchedFiles);
            } catch (error) {
                console.error('Failed to fetch commit files:', error);
                setFiles([]);
            }
        };

        fetchFiles();
    }, [selectedHashes]);

    const handleFileClick = (path: string, status?: string) => {
        logger.log('handleFileClick', path, status);
        if (!selectedHashes || selectedHashes.length === 0) return;

        // Find selected commits objects from allCommits to respect order/date
        const selectedCommits = allCommits.filter(c => selectedHashes.includes(c.hash));

        if (selectedCommits.length === 0) return;

        // Sort by date (oldest first)
        // Note: Git timestamps can be tricky, but usually date is enough.
        selectedCommits.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Oldest commit
        const oldest = selectedCommits[0];
        // Newest commit
        const newest = selectedCommits[selectedCommits.length - 1];

        // Diff: Oldest^ .. Newest
        const leftRef = `${oldest.hash}^`;
        const rightRef = newest.hash;

        rpc.openCommitDiff({ path, leftRef, rightRef });
    };

    const fileStatusList: FileStatus[] = files.map(f => ({
        path: f.path,
        status: f.status,
        staged: true
    }));

    const filesView = (
        <div className={styles.filesViewContainer}>
            <div className={styles.filesToolbar}>
                <div className="toolbar-left">
                    <span className={styles.filesCount}>
                        {t('pushView.files', { count: files.length })}
                    </span>
                </div>
                <div className={styles.toolbarActions}>
                    <button
                        className={`${styles.iconBtn} ${viewMode === 'list' ? styles.active : ''}`}
                        title={t('toolbar.viewMode')}
                        onClick={() => setViewMode(v => v === 'tree' ? 'list' : 'tree')}
                    >
                        <i className={`codicon codicon-${viewMode === 'tree' ? 'list-tree' : 'list-flat'}`} />
                    </button>
                    <button
                        className={`${styles.iconBtn} ${showDetails ? styles.active : ''}`}
                        title={t('toolbar.toggleDetails')}
                        onClick={() => setShowDetails(prev => !prev)}
                    >
                        <i className={`codicon codicon-${showDetails ? 'layout-panel' : 'layout-panel-off'}`} />
                    </button>
                    <button
                        className={styles.iconBtn}
                        title={t('toolbar.expandAll')}
                        onClick={() => treeRef.current?.expandAll()}
                    >
                        <i className="codicon codicon-expand-all" />
                    </button>
                    <button
                        className={styles.iconBtn}
                        title={t('toolbar.collapseAll')}
                        onClick={() => treeRef.current?.collapseAll()}
                    >
                        <i className="codicon codicon-collapse-all" />
                    </button>
                </div>
            </div>
            <div className={styles.filesTreeWrapper}>
                <BaseFileTree
                    ref={treeRef}
                    items={fileStatusList}
                    viewMode={viewMode}
                    readonly={true}
                    onFileClick={handleFileClick}
                />
            </div>
        </div>
    );

    const detailsView = commit && (
        <div className={styles.commitDetailsPane}>
            <div className={styles.detailsContent}>
                <div className={styles.detailMessage}>
                    {commit.subject}
                </div>
                <div className={styles.detailMeta}>
                    <div className={styles.metaRow}>
                        {commit.authorName} {commit.email ? (
                            <a
                                href={`mailto:${commit.email}`}
                                className={styles.emailLink}
                            >
                                {`<${commit.email}>`}
                            </a>
                        ) : ''},
                        {' '}
                        {new Date(commit.date).toLocaleString()}
                    </div>
                    <div className={styles.metaHash}>
                        {commit.hash}
                    </div>
                </div>
            </div>
        </div>
    );

    if (!showDetails || !commit) {
        return <div className={styles.filesPanel}>{filesView}</div>;
    }

    return (
        <SplitPane
            direction="vertical"
            first={filesView}
            second={detailsView}
            secondDefaultSize={200}
            minSize={80}
            className={styles.filesPanel}
        />
    );
}
