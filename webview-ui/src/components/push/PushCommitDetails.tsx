import { useState, useEffect } from 'react';
import type { CommitInfo, CommitFile, FileStatus } from '@shared/messages';
import { rpc } from '@/lib/rpc_client';
import { SimpleFileTree } from '../file-tree/SimpleFileTree';
import { useTranslation } from 'react-i18next';
import styles from './PushCommitDetails.module.css';


export interface PushCommitDetailsProps {
    commit: CommitInfo | null;
}

export function PushCommitDetails({ commit }: PushCommitDetailsProps) {
    const { t } = useTranslation();
    const [files, setFiles] = useState<CommitFile[]>([]);

    useEffect(() => {
        const fetchFiles = async () => {
            if (!commit) {
                setFiles([]);
                return;
            }
            try {
                const fetchedFiles = await rpc.call('getCommitFiles', commit.hash);
                setFiles(fetchedFiles);
            } catch (error) {
                console.error('Failed to fetch commit files:', error);
                setFiles([]);
            }
        };

        fetchFiles();
    }, [commit?.hash]);

    const fileStatusList: FileStatus[] = files.map(f => ({
        path: f.path,
        status: f.status,
        staged: true
    }));

    return (
        <div className={styles.filesPanel}>
            {/* Top: File List */}
            <div className={styles.filesViewContainer}>
                <div className={styles.filesToolbar}>
                    <div className="toolbar-left">
                        <span className={styles.filesCount}>
                            {t('pushView.files', { count: files.length })}
                        </span>
                    </div>
                </div>
                <div className={styles.filesTreeWrapper}>
                    <SimpleFileTree
                        files={fileStatusList}
                        viewMode="tree"
                        onFileClick={(file) => rpc.call('openDiff', file.path)}
                    />
                </div>
            </div>

            {/* Bottom: Commit Details */}
            {
                commit && (

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
                )
            }
        </div >
    );
}
