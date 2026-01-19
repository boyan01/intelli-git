import React, { useRef, useState, useCallback } from 'react';
import { rpc } from '@/lib/rpc_client';
import { useTranslation } from 'react-i18next';
import type { CommitDetails, FileStatus } from '@shared/messages';
import { BaseFileTree } from '../file-tree/BaseFileTree';
import type { BaseFileTreeRef } from '../file-tree/BaseFileTree';
import { ViewModeToggle } from '../common/ViewModeToggle';
import { formatRelativeDate } from '../../utils/dateUtils';
import styles from './CommitAccordionItem.module.css';

export interface CommitAccordionItemProps {
    commit: CommitDetails;
    isExpanded: boolean;
    onToggle: () => void;
    fileViewMode: 'tree' | 'list';
    onFileViewModeChange: (mode: 'tree' | 'list') => void;
    activeFile: { path: string; commitHash?: string } | null;
}

export const CommitAccordionItem: React.FC<CommitAccordionItemProps> = ({
    commit,
    isExpanded,
    onToggle,
    fileViewMode,
    onFileViewModeChange,
    activeFile
}) => {
    const { t } = useTranslation();
    const treeRef = useRef<BaseFileTreeRef>(null);
    const [showRelativeTime, setShowRelativeTime] = useState(true);

    const handleOpenFile = useCallback((path: string, preserveFocus: boolean) => {
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

        rpc.openCommitDiff({ path, leftRef, rightRef, preserveFocus });
    }, [commit]);

    // Only highlight if commitHash matches this commit's hash
    const activeFilePath = activeFile && activeFile.commitHash === commit.hash
        ? activeFile.path
        : null;

    const fileItems: FileStatus[] = commit.files ? commit.files.map(f => ({
        path: f.path,
        status: f.status,
        staged: false
    })) : [];

    return (
        <div className={styles.commitItem}>
            {/* Commit Header */}
            <div
                className={`${styles.commitHeader} ${isExpanded ? styles.commitHeaderExpanded : ''}`}
                onClick={onToggle}
                tabIndex={0}
            >
                <i className={`codicon codicon-git-commit ${styles.commitIcon} ${isExpanded ? styles.commitIconExpanded : ''}`} />
                <div className={styles.commitHeaderContent}>
                    <div className={styles.commitTitleRow}>
                        <span className={styles.commitMessage} title={commit.subject}>
                            {commit.subject}
                        </span>
                    </div>
                    {!isExpanded && (
                        <div className={styles.commitMeta}>
                            <span>{commit.authorName}</span>
                            <span className={styles.commitMetaDot}>•</span>
                            <span className={styles.commitDate}>{formatRelativeDate(commit.date)}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Commit Expanded Content */}
            {isExpanded && (
                <div className={styles.commitContent}>
                    <div className={styles.commitDetails}>
                        {commit.body && (
                            <div className={styles.commitBody}>{commit.body}</div>
                        )}
                        <div className={styles.commitDetailsMeta}>
                            <span
                                title={commit.authorEmail}
                                data-vscode-context={JSON.stringify({
                                    webviewSection: 'authorName',
                                    email: commit.authorEmail
                                })}
                            >
                                <i className="codicon codicon-person" />
                                <span className={styles.authorText}>{commit.authorName}</span>
                            </span>
                            <span>
                                <i className="codicon codicon-git-commit" />
                                #{commit.hash.substring(0, 7)}
                            </span>
                            <span
                                className={styles.commitDateToggle}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowRelativeTime(!showRelativeTime);
                                }}
                                title={new Date(commit.date).toLocaleString()}
                            >
                                <i className="codicon codicon-calendar" />
                                {showRelativeTime ? formatRelativeDate(commit.date) : new Date(commit.date).toLocaleString()}
                            </span>
                        </div>
                    </div>
                    <div className={styles.commitFiles}>
                        {/* File Tree Header */}
                        <div className={styles.filesHeader}>
                            <span className={styles.filesCount}>
                                {t('{{count}} files', { count: commit.files.length })}
                            </span>
                            <div className={styles.filesActions}>
                                <ViewModeToggle viewMode={fileViewMode} onChange={onFileViewModeChange} />
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
                        <BaseFileTree
                            ref={treeRef}
                            items={fileItems}
                            viewMode={fileViewMode}
                            readonly={true}
                            onFileClick={(path) => handleOpenFile(path, true)}
                            selectedFiles={new Set()}
                            activeFile={activeFilePath}
                            onToggleFile={() => { }}
                            onFileDoubleClick={(path) => handleOpenFile(path, false)}
                        />
                    </div>
                </div>
            )}
        </div >
    );
};
