import { useState, useEffect, useCallback } from 'react';
import type { CommitInfo, CommitFile, PushConfig, PushViewMessage, PushViewExtMessage, FileStatus } from '@shared/messages';
import { SimpleFileTree } from '../file-tree/SimpleFileTree';
import { CommitsPanel } from './CommitsPanel';
import { vscode } from '../../lib/vscode';
import { useTranslation } from 'react-i18next';
import styles from './PushView.module.css';

export function PushView() {
    const { t } = useTranslation();
    const postMessage = useCallback((message: PushViewMessage) => {
        vscode.postMessage(message);
    }, []);

    const [commits, setCommits] = useState<CommitInfo[]>([]);
    const [files, setFiles] = useState<CommitFile[]>([]);
    const [config, setConfig] = useState<PushConfig | null>(null);
    const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
    const [pushTags, setPushTags] = useState(false);
    const [isPushing, setIsPushing] = useState(false);
    const [isForcePushExpanded, setIsForcePushExpanded] = useState(false);

    useEffect(() => {
        const handleMessage = (event: MessageEvent<PushViewExtMessage>) => {
            const message = event.data;
            switch (message.type) {
                case 'update':
                    setCommits(message.commits);
                    setFiles(message.files);
                    setConfig(message.config);
                    if (message.commits.length > 0 && !selectedCommitHash) {
                        setSelectedCommitHash(message.commits[0].hash);
                    }
                    break;
                case 'updateFiles':
                    setFiles(message.files);
                    break;
                case 'pushComplete':
                    setIsPushing(false);
                    break;
                case 'pushError':
                    setIsPushing(false);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', handleMessage);
    }, [selectedCommitHash, postMessage]);

    const handlePush = (force: boolean) => {
        setIsPushing(true);
        postMessage({ type: 'push', force, pushTags });
    };

    const handleSelectCommit = (index: number, hash: string) => {
        setSelectedCommitHash(hash);
        postMessage({ type: 'selectCommit', index });
    };

    const handleRemoteChange = (remote: string) => {
        postMessage({ type: 'changeRemote', remote });
    };

    const handleRemoteBranchChange = (branch: string) => {
        postMessage({ type: 'changeRemoteBranch', branch });
    };

    if (!config) {
        return <div className={styles.loadingOverlay}><div className={styles.loadingSpinner}></div></div>;
    }

    const selectedCommit = commits.find(c => c.hash === selectedCommitHash);

    const fileStatusList: FileStatus[] = files.map(f => ({
        path: f.path,
        status: f.status,
        staged: true
    }));

    return (
        <div className={styles.pushPanel}>
            <div className={styles.pushHeader}>
                <h2>{t('pushView.title')}</h2>
                <button className={styles.headerCloseBtn} onClick={() => postMessage({ type: 'cancel' })} title={t('pushView.close')}>
                    <i className="codicon codicon-close"></i>
                </button>
            </div>

            <div className={styles.pushMain}>
                {/* Left: Commits Panel */}
                <CommitsPanel
                    commits={commits}
                    config={config}
                    selectedCommitHash={selectedCommitHash}
                    onSelectCommit={handleSelectCommit}
                    onRemoteChange={handleRemoteChange}
                    onRemoteBranchChange={handleRemoteBranchChange}
                />

                {/* Right: Files + Details */}
                <div className={styles.filesPanel}>
                    {/* Top: File List */}
                    <div className={styles.filesViewContainer}>
                        <div className={styles.filesToolbar}>
                            <div className="toolbar-left">
                                <span className={styles.filesCount}>{t('pushView.files', { count: files.length })}</span>
                            </div>
                        </div>
                        <div className={styles.filesTreeWrapper}>
                            <SimpleFileTree
                                files={fileStatusList}
                                viewMode="tree"
                            />
                        </div>
                    </div>

                    {/* Bottom: Commit Details */}
                    {selectedCommit && (
                        <div className={styles.commitDetailsPane}>
                            <div className={styles.detailsHeader}>{t('pushView.commitDetails.title')}</div>
                            <div className={styles.detailsContent}>
                                <div className={styles.detailRow}>
                                    <span className={styles.label}>{t('pushView.commitDetails.author')}</span>
                                    <span className={styles.value}>{selectedCommit.authorName}</span>
                                </div>
                                <div className={styles.detailRow}>
                                    <span className={styles.label}>{t('pushView.commitDetails.hash')}</span>
                                    <span className={styles.value}>{selectedCommit.hash}</span>
                                </div>
                                <div className={styles.detailRow}>
                                    <span className={styles.label}>{t('pushView.commitDetails.date')}</span>
                                    <span className={styles.value}>{selectedCommit.date}</span>
                                </div>
                                <div className={styles.detailMessage}>
                                    {selectedCommit.subject}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className={styles.pushFooter}>
                <div className={styles.footerLeft}>
                    <div className={styles.pushTagsGroup}>
                        <label>
                            <input
                                type="checkbox"
                                checked={pushTags}
                                onChange={e => setPushTags(e.target.checked)}
                            />
                            {t('pushView.pushTags')}
                        </label>
                    </div>
                </div>
                <div className={styles.footerRight}>
                    <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => postMessage({ type: 'cancel' })}>{t('pushView.cancel')}</button>
                    <div className={styles.btnSplit} style={{ position: 'relative' }}>
                        <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnMain}`} onClick={() => handlePush(false)}>{t('pushView.push')}</button>
                        <button
                            className={`${styles.btn} ${styles.btnPrimary} ${styles.btnDropdown}`}
                            onClick={() => setIsForcePushExpanded(!isForcePushExpanded)}
                        >
                            <i className="codicon codicon-chevron-down"></i>
                        </button>
                        {isForcePushExpanded && (
                            <div className={styles.dropdownMenu} style={{ display: 'block', bottom: '100%', top: 'auto' }}>
                                <div className={styles.dropdownItem} onClick={() => {
                                    handlePush(true);
                                    setIsForcePushExpanded(false);
                                }}>
                                    <i className="codicon codicon-warning icon"></i>
                                    <span>{t('pushView.forcePush')}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isPushing && (
                <div className={styles.loadingOverlay}>
                    <div className={styles.loadingSpinner}></div>
                </div>
            )}
        </div>
    );
}
