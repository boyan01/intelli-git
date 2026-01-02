import { useState, useEffect } from 'react';
import type { CommitInfo } from '@shared/messages';
import { rpc } from '@/lib/rpc_client';
import { CommitsPanel } from './CommitsPanel';
import { PushCommitDetails } from './PushCommitDetails';
import { useTranslation } from 'react-i18next';
import styles from './PushView.module.css';

export function PushView() {
    const { t } = useTranslation();

    const [commits, setCommits] = useState<CommitInfo[]>([]);
    const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
    const [pushTags, setPushTags] = useState(false);
    const [isPushing, setIsPushing] = useState(false);
    const [isForcePushExpanded, setIsForcePushExpanded] = useState(false);

    // State for granular data flow
    const [localBranch, setLocalBranch] = useState<string>('');
    const [remotes, setRemotes] = useState<string[]>([]);
    const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
    const [selectedRemote, setSelectedRemote] = useState<string>('');
    const [selectedRemoteBranch, setSelectedRemoteBranch] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);

    // 1. Initial Load
    useEffect(() => {
        const loadInitData = async () => {
            try {
                const data = await rpc.call('getPushInitState');
                setLocalBranch(data.localBranch);
                setRemotes(data.remotes);

                // Set default remote
                if (data.remotes.length > 0) {
                    setSelectedRemote(data.remotes[0]);
                }
                setIsLoading(false);
            } catch (error) {
                console.error('Failed to load push init state:', error);
                setIsLoading(false);
            }
        };
        loadInitData();
    }, []);

    // 2. Fetch Remote Branches when Remote selection changes
    useEffect(() => {
        if (!selectedRemote) return;

        const loadRemoteBranches = async () => {
            try {
                const branches = await rpc.call('getRemoteBranches', selectedRemote);
                setRemoteBranches(branches);

                // Auto-select branch logic
                if (branches.includes(localBranch)) {
                    setSelectedRemoteBranch(localBranch);
                } else if (branches.length > 0) {
                    setSelectedRemoteBranch(branches[0]);
                } else {
                    setSelectedRemoteBranch('');
                }
            } catch (error) {
                console.error('Failed to load remote branches:', error);
            }
        };

        loadRemoteBranches();
    }, [selectedRemote, localBranch]);

    // 3. Fetch Commits when Remote or Branch changes
    useEffect(() => {
        if (!selectedRemote || !selectedRemoteBranch) return;

        const loadCommits = async () => {
            try {
                const data = await rpc.call('getPushCommits', {
                    remote: selectedRemote,
                    branch: selectedRemoteBranch
                });
                setCommits(data.commits);

                if (data.commits.length > 0) {
                    // Check if previously selected commit is still valid
                    if (!selectedCommitHash || !data.commits.find(c => c.hash === selectedCommitHash)) {
                        setSelectedCommitHash(data.commits[0].hash);
                    }
                } else {
                    setSelectedCommitHash(null);
                }
            } catch (error) {
                console.error('Failed to load push commits:', error);
            }
        };

        loadCommits();
    }, [selectedRemote, selectedRemoteBranch]);

    const handlePush = async (force: boolean) => {
        setIsPushing(true);
        try {
            await rpc.call('push', {
                force,
                pushTags,
                remote: selectedRemote,
                branch: selectedRemoteBranch
            });
            // Refresh logic: just re-fetch commits for current selection
            const data = await rpc.call('getPushCommits', {
                remote: selectedRemote,
                branch: selectedRemoteBranch
            });
            setCommits(data.commits);
            setIsPushing(false);
        } catch (e) {
            console.error('Push failed', e);
            setIsPushing(false);
        }
    };

    const handleSelectCommit = async (_: number, hash: string) => {
        setSelectedCommitHash(hash);
    };

    const handleCancel = () => {
        rpc.call('cancel');
    };

    if (isLoading) {
        return <div className={styles.loadingOverlay}><div className={styles.loadingSpinner}></div></div>;
    }

    const selectedCommit = commits.find(c => c.hash === selectedCommitHash) || null;

    return (
        <div className={styles.pushPanel}>
            <div className={styles.pushHeader}>
                <h2>{t('pushView.title')}</h2>
                <button className={styles.headerCloseBtn} onClick={handleCancel} title={t('pushView.close')}>
                    <i className="codicon codicon-close"></i>
                </button>
            </div>

            <div className={styles.pushMain}>
                {/* Left: Commits Panel */}
                <CommitsPanel
                    commits={commits}
                    localBranch={localBranch}
                    currentRemote={selectedRemote}
                    currentRemoteBranch={selectedRemoteBranch}
                    remotes={remotes}
                    remoteBranches={remoteBranches}
                    selectedCommitHash={selectedCommitHash}
                    onSelectCommit={handleSelectCommit}
                    onRemoteChange={setSelectedRemote}
                    onRemoteBranchChange={setSelectedRemoteBranch}
                />

                {/* Right: Files + Details */}
                <PushCommitDetails commit={selectedCommit} />
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
                    <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleCancel}>{t('pushView.cancel')}</button>
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
