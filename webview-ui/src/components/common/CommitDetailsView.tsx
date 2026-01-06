import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { CommitDetails, CommitFile, RefInfo, FileStatus } from '../../../../shared/messages';
import { rpc } from '../../lib/rpc_client';
import { SplitPane } from './SplitPane';
import { BaseFileTree } from '../file-tree/BaseFileTree';
import type { BaseFileTreeRef } from '../file-tree/BaseFileTree';
import { useTranslation } from 'react-i18next';
import styles from './CommitDetailsView.module.css';

export interface CommitDetailsViewProps {
    selectedHashes: string[];
    commit?: CommitDetails;
    showToggleDetails?: boolean;
    showBranches?: boolean;
    onFileInteraction?: () => void;
    onClose?: () => void;
    isPinned?: boolean;
    onPin?: () => void;
}

export const CommitDetailsView: React.FC<CommitDetailsViewProps> = ({
    selectedHashes,
    commit,
    showToggleDetails = false,
    showBranches = false,
    onFileInteraction,
    onClose,
    isPinned = false,
    onPin
}) => {
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

    const handleFileClick = (path: string) => {
        onFileInteraction?.();
        if (selectedHashes.length === 0) return;

        if (selectedHashes.length === 1 && commit) {
            const file = commit.files.find(f => f.path === path);
            if (!file) return;

            const parentHash = commit.parentHashes.length > 0 ? commit.parentHashes[0] : '';
            let leftRef = parentHash;
            let rightRef = commit.hash;

            if (file.status.startsWith('A')) {
                leftRef = '';
            } else if (file.status.startsWith('D')) {
                rightRef = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
            }

            rpc.openCommitDiff({ path, leftRef, rightRef });
        } else {
            // Multi-select: diff oldest^ to newest
            const sortedHashes = [...selectedHashes];
            const leftRef = `${sortedHashes[0]}^`;
            const rightRef = sortedHashes[sortedHashes.length - 1];
            rpc.openCommitDiff({ path, leftRef, rightRef });
        }
    };

    const fileItems: FileStatus[] = useMemo(() => {
        return files.map(f => ({
            path: f.path,
            status: f.status,
            staged: false
        }));
    }, [files]);

    const containingBranchesRefs = useMemo<RefInfo[]>(() => {
        if (!commit || !showBranches || commit.containingBranches.length === 0) return [];
        return commit.containingBranches.map(b => ({
            name: b,
            type: b.includes('/') ? 'remote' : 'local'
        }));
    }, [commit, showBranches]);

    const formattedDate = useMemo(() => {
        if (!commit || !commit.date) return '';
        return new Date(commit.date).toLocaleString();
    }, [commit]);

    if (selectedHashes.length === 0) {
        return <div className={styles.empty}>{t('commitDetails.selectCommit', 'Select a commit to view details')}</div>;
    }

    const filesView = (
        <div className={styles.filesViewContainer}>
            <div className={styles.filesToolbar}>
                <div className={styles.toolbarLeft}>
                    {onPin && (
                        <button
                            className={`${styles.iconBtn} ${isPinned ? styles.active : ''}`}
                            onClick={onPin}
                        >
                            <i className={`codicon codicon-${isPinned ? 'pinned' : 'pin'}`} />
                        </button>
                    )}
                </div>
                <div className={styles.toolbarActions}>
                    <button
                        className={`${styles.iconBtn} ${viewMode === 'list' ? styles.active : ''}`}
                        onClick={() => setViewMode(v => v === 'tree' ? 'list' : 'tree')}
                    >
                        <i className={`codicon codicon-${viewMode === 'tree' ? 'list-tree' : 'list-flat'}`} />
                    </button>
                    {showToggleDetails && (
                        <button
                            className={`${styles.iconBtn} ${showDetails ? styles.active : ''}`}
                            onClick={() => setShowDetails(prev => !prev)}
                        >
                            <i className={`codicon codicon-${showDetails ? 'layout-panel' : 'layout-panel-off'}`} />
                        </button>
                    )}
                    <button
                        className={styles.iconBtn}
                        onClick={() => treeRef.current?.expandAll()}
                    >
                        <i className="codicon codicon-expand-all" />
                    </button>
                    <button
                        className={styles.iconBtn}
                        onClick={() => treeRef.current?.collapseAll()}
                    >
                        <i className="codicon codicon-collapse-all" />
                    </button>
                    {isPinned && onClose && (
                        <button
                            className={styles.iconBtn}
                            onClick={onClose}
                        >
                            <i className="codicon codicon-close" />
                        </button>
                    )}
                </div>
            </div>
            <div className={styles.filesTreeWrapper}>
                <BaseFileTree
                    ref={treeRef}
                    items={fileItems}
                    viewMode={viewMode}
                    readonly={true}
                    onFileClick={handleFileClick}
                    selectedFiles={new Set()}
                    activeFile={null}
                    onToggleFile={() => { }}
                    onFileDoubleClick={handleFileClick}
                />
            </div>
        </div>
    );

    const detailsView = commit && (
        <div className={styles.detailsContainer}>
            <div className={styles.detailsContent}>
                <div className={styles.detailMessage}>
                    <div className={styles.subject}>{commit.subject}</div>
                    {commit.body && <div className={styles.body}>{commit.body}</div>}
                </div>
                <div className={styles.detailMeta}>
                    <div className={styles.metaRow}>
                        {commit.authorName}{' <'}
                        <a href={`mailto:${commit.authorEmail}`} className={styles.emailLink}>
                            {commit.authorEmail}
                        </a>
                        {'>, '}
                        {formattedDate}
                    </div>
                    <div className={styles.metaHash}>
                        {commit.hash}
                    </div>
                    {containingBranchesRefs.length > 0 && (
                        <div className={styles.metaRow}>
                            <span className={styles.metaLabel}>{t('commitDetails.branches', 'Branches')}:</span>
                            {containingBranchesRefs.map(ref => (
                                <div key={ref.name} className={styles.branchItem}>{ref.name}</div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    // Multi-select or no details: show files only
    if (selectedHashes.length > 1 || !commit || (showToggleDetails && !showDetails)) {
        return <div className={styles.container}>{filesView}</div>;
    }

    return (
        <div className={styles.container}>
            <SplitPane
                direction="vertical"
                first={filesView}
                second={detailsView}
                defaultRatio={0.65}
                minSize={80}
            />
        </div>
    );
};
