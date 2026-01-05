import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { CommitDetails, RefInfo } from '../../../../shared/messages';
import { rpc } from '../../lib/rpc_client';
import { SplitPane } from '../common/SplitPane';
import { BaseFileTree } from '../file-tree/BaseFileTree';
import type { BaseFileTreeRef } from '../file-tree/BaseFileTree';
// RefLabels is no longer used for containing branches, but keeping import if needed elsewhere or removal later
// import { RefLabels } from './RefLabels'; 
import { useTranslation } from 'react-i18next';
import styles from './CommitDetailsPanel.module.css';

interface CommitDetailsPanelProps {
    commitHash: string | null;
}

export const CommitDetailsPanel: React.FC<CommitDetailsPanelProps> = ({ commitHash }) => {
    const { t } = useTranslation();
    const [details, setDetails] = useState<CommitDetails | null>(null);
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
    const treeRef = useRef<BaseFileTreeRef>(null);

    useEffect(() => {
        if (!commitHash) {
            setDetails(null);
            return;
        }

        const fetchDetails = async () => {
            setLoading(true);
            try {
                const result = await rpc.getCommitDetails(commitHash);
                setDetails(result);
            } catch (error) {
                console.error('Failed to load commit details', error);
                setDetails(null);
            } finally {
                setLoading(false);
            }
        };

        fetchDetails();
    }, [commitHash]);

    const handleFileDoubleClick = async (path: string) => {
        if (!details) return;

        const file = details.files.find(f => f.path === path);
        if (!file) return;

        const parentHash = details.parentHashes.length > 0 ? details.parentHashes[0] : '';
        const currentHash = details.hash;

        let leftRef = parentHash;
        let rightRef = currentHash;

        if (file.status.startsWith('A')) {
            leftRef = '';
        } else if (file.status.startsWith('D')) {
            rightRef = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // Empty tree hash
        }

        await rpc.openCommitDiff({
            path: file.path,
            leftRef,
            rightRef
        });
    };

    const fileItems = useMemo(() => {
        if (!details) return [];
        return details.files.map(f => ({
            path: f.path,
            status: f.status,
            staged: false
        }));
    }, [details]);

    const containingBranchesRefs = useMemo<RefInfo[]>(() => {
        if (!details || !details.containingBranches) return [];
        return details.containingBranches.map(b => ({
            name: b,
            type: b.includes('/') ? 'remote' : 'local'
        }));
    }, [details]);

    const messageParts = useMemo(() => {
        if (!details) return { subject: '', body: '' };
        const lines = details.fullMessage.split('\n');
        const subject = lines[0];
        const body = lines.slice(1).join('\n').trim();
        return { subject, body };
    }, [details]);

    const formattedDate = useMemo(() => {
        if (!details || !details.date) return '';
        return new Date(details.date).toLocaleString();
    }, [details]);

    if (!commitHash) {
        return <div className={styles.empty}>{t('commitDetails.selectCommit', 'Select a commit to view details')}</div>;
    }

    if (!details) {
        if (loading) return null;
        return <div className={styles.empty}>{t('commitDetails.noDetails', 'No details available')}</div>;
    }

    const firstPane = (
        <div className={styles.filesViewContainer}>
            <div className={styles.filesToolbar}>
                <div className={styles.toolbarActions}>
                    <button
                        className={`${styles.iconBtn} ${viewMode === 'list' ? styles.active : ''}`}
                        title={t('toolbar.viewMode', 'Toggle View Mode')}
                        onClick={() => setViewMode(v => v === 'tree' ? 'list' : 'tree')}
                    >
                        <i className={`codicon codicon-${viewMode === 'tree' ? 'list-tree' : 'list-flat'}`} />
                    </button>
                    <button
                        className={styles.iconBtn}
                        title={t('toolbar.expandAll', 'Expand All')}
                        onClick={() => treeRef.current?.expandAll()}
                    >
                        <i className="codicon codicon-expand-all" />
                    </button>
                    <button
                        className={styles.iconBtn}
                        title={t('toolbar.collapseAll', 'Collapse All')}
                        onClick={() => treeRef.current?.collapseAll()}
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
                    onFileDoubleClick={handleFileDoubleClick}
                    selectedFiles={new Set()}
                    activeFile={null}
                    onToggleFile={() => { }}
                    onFileClick={() => { }}
                />
            </div>
        </div>
    );

    const secondPane = (
        <div className={styles.detailsContainer}>
            <div className={styles.detailsContent}>
                <div className={styles.detailMessage}>
                    <div className={styles.subject}>{messageParts.subject}</div>
                    {messageParts.body && <div className={styles.body}>{messageParts.body}</div>}
                </div>
                <div className={styles.detailMeta}>
                    <div className={styles.metaRow}>
                        {details.authorName}{' <'}
                        <a href={`mailto:${details.authorEmail}`} className={styles.emailLink}>
                            {details.authorEmail}
                        </a>
                        {'>, '}
                        {formattedDate}
                    </div>
                    <div className={styles.metaHash}>
                        {details.hash}
                    </div>
                    {containingBranchesRefs.length > 0 && (
                        <div className={styles.metaRow}>
                            <div className={styles.metaLabel}>{t('commitDetails.branches', 'Branches')}:</div>
                            {containingBranchesRefs.map(ref => (
                                <div key={ref.name} className={styles.branchItem}>{ref.name}</div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div className={styles.container}>
            <SplitPane
                direction="vertical"
                first={firstPane}
                second={secondPane}
                defaultRatio={0.68}
                className={styles.splitPane}
            />
        </div>
    );
};
