import { useState, useEffect, useMemo, useRef } from 'react';
import type { CommitDetails, CommitFile, FileStatus } from '@shared/messages';
import { rpc } from '@/lib/rpc_client';
import { ViewModeToggle } from '../common/ViewModeToggle';
import { BaseFileTree } from '../file-tree/BaseFileTree';
import type { BaseFileTreeRef } from '../file-tree/BaseFileTree';
// import { ContextMenu, type ContextMenuItem } from '../common/ContextMenu';
import { useTranslation } from 'react-i18next';
import styles from './PushCommitDetails.module.css';

export interface PushCommitDetailsProps {
    selectedHashes: string[];
    commit?: CommitDetails;
}

export function PushCommitDetails({ selectedHashes, commit }: PushCommitDetailsProps) {
    const { t } = useTranslation();
    const [files, setFiles] = useState<CommitFile[]>([]);
    const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
    const [isExpanded, setIsExpanded] = useState(false);
    const [isHashHovered, setIsHashHovered] = useState(false);
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

    const formattedDate = useMemo(() => {
        if (!commit || !commit.date) return '';
        const date = new Date(commit.date);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffHours < 1) return t('Just now');
        if (diffHours < 24) return t('{{count}} hours ago', { count: diffHours });
        if (diffDays < 7) return t('{{count}} days ago', { count: diffDays });
        return date.toLocaleDateString();
    }, [commit, t]);

    const fullDate = useMemo(() => {
        if (!commit || !commit.date) return '';
        return new Date(commit.date).toLocaleString();
    }, [commit]);

    const handleCopyHash = () => {
        if (commit) {
            navigator.clipboard.writeText(commit.hash);
        }
    };



    if (selectedHashes.length === 0) {
        return <div className={styles.empty}>{t('Select a commit to view details')}</div>;
    }

    return (
        <div className={styles.container}>
            {/* Merged Header */}
            {commit && (
                <div className={styles.header}>
                    <div className={styles.headerContent}>
                        <div className={styles.titleRow}>
                            <h3 className={styles.subject} title={commit.subject}>{commit.subject}</h3>
                        </div>

                        {commit.body && (
                            <div
                                className={`${styles.description} ${isExpanded ? styles.expanded : ''}`}
                                onClick={() => setIsExpanded(!isExpanded)}
                                title={isExpanded ? t('Click to collapse') : t('Click to expand')}
                            >
                                {commit.body}
                                {!isExpanded && <span className={styles.expandHint}>...</span>}
                            </div>
                        )}

                        <div className={styles.meta}>
                            <div className={styles.metaLeft}>
                                <div
                                    className={styles.authorRow}
                                    title={t('Right click for options')}
                                    data-vscode-context={JSON.stringify({
                                        webviewSection: 'authorName',
                                        email: commit.authorEmail
                                    })}
                                >
                                    <i className={`codicon codicon-account ${styles.metaIcon}`} />
                                    <span className={styles.authorName}>{commit.authorName}</span>
                                </div>

                                <span
                                    className={styles.hashItem}
                                    onMouseEnter={() => setIsHashHovered(true)}
                                    onMouseLeave={() => setIsHashHovered(false)}
                                    onClick={handleCopyHash}
                                    title={t('Click to copy')}
                                >
                                    <span className={styles.hashSep}>#</span>
                                    <span className={styles.hashText}>{commit.hash.substring(0, 7)}</span>
                                    {isHashHovered && <i className={`codicon codicon-copy ${styles.copyIcon} ${styles.visible}`} />}
                                </span>
                            </div>

                            <div className={styles.metaRight}>
                                <i className={`codicon codicon-history ${styles.metaIcon}`} />
                                <span className={styles.dateItem} title={fullDate}>
                                    {formattedDate}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}



            {/* Files Section */}
            <div className={styles.filesSection}>
                <div className={styles.filesToolbar}>
                    <span className={styles.filesCount}>
                        {t('Changed Files')} ({files.length})
                    </span>
                    <div className={styles.toolbarActions}>
                        <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
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
        </div>
    );
}
