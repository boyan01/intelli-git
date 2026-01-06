import { useState, useEffect } from 'react';
import type { CommitDetails } from '@shared/messages';
import { rpc } from '@/lib/rpc_client';
import { CommitsPanel } from './CommitsPanel';
import { PushCommitDetails } from './PushCommitDetails';
import { SplitPane } from '../common/SplitPane';
import { useTranslation } from 'react-i18next';
import styles from './PushView.module.css';

export function PushView() {
    const { t } = useTranslation();

    const [commits, setCommits] = useState<CommitDetails[]>([]);
    const [selectedCommitHashes, setSelectedCommitHashes] = useState<string[]>([]);
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
                const data = await rpc.getPushInitState();
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
                const branches = await rpc.getRemoteBranches(selectedRemote);
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
                const data = await rpc.getPushCommits({
                    remote: selectedRemote,
                    branch: selectedRemoteBranch
                });
                setCommits(data.commits);
                setSelectedCommitHashes([]);
            } catch (error) {
                console.error('Failed to load push commits:', error);
            }
        };

        loadCommits();
    }, [selectedRemote, selectedRemoteBranch]);

    const handlePush = async (force: boolean) => {
        setIsPushing(true);
        try {
            await rpc.push({
                force,
                pushTags,
                remote: selectedRemote,
                branch: selectedRemoteBranch
            });
            await rpc.closeWebView()
        } catch (e) {
            console.error('Push failed', e);
            setIsPushing(false);
        }
    };

    if (isLoading) {
        return <div className={styles.loadingOverlay}><div className={styles.loadingSpinner}></div></div>;
    }

    return (
        <div className={styles.pushPanel}>

            <SplitPane
                direction="horizontal"
                defaultRatio={0.5}
                minSize={150}
                className={styles.pushMain}
                first={
                    <CommitsPanel
                        commits={commits}
                        localBranch={localBranch}
                        currentRemote={selectedRemote}
                        currentRemoteBranch={selectedRemoteBranch}
                        remotes={remotes}
                        remoteBranches={remoteBranches}
                        selectedCommitHashes={selectedCommitHashes}
                        onSelectCommits={setSelectedCommitHashes}
                        onRemoteChange={setSelectedRemote}
                        onRemoteBranchChange={setSelectedRemoteBranch}
                    />
                }
                second={
                    <PushCommitDetails
                        selectedHashes={selectedCommitHashes.length === 0 ? commits.map(c => c.hash) : selectedCommitHashes}
                        commit={selectedCommitHashes.length === 1 ? commits.find(c => c.hash === selectedCommitHashes[0]) : undefined}
                    />
                }
            />

            <div className={styles.pushFooter}>
                <div className={styles.footerLeft}>
                    <div className={styles.pushTagsGroup}>
                        <label>
                            <input
                                type="checkbox"
                                checked={pushTags}
                                onChange={e => setPushTags(e.target.checked)}
                            />
                            {t('Push Tags')}
                        </label>
                    </div>
                </div>
                <div className={styles.footerRight}>
                    <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => rpc.closeWebView()}>{t('Cancel')}</button>
                    <div className={styles.btnSplit} style={{ position: 'relative' }}>
                        <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnMain}`} onClick={() => handlePush(false)}>{t('Push')}</button>
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
                                    <span>{t('Force Push')}</span>
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
