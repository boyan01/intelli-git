import { useState, useEffect } from 'react';
import type { CommitDetails } from '@shared/messages';
import { rpc } from '@/lib/rpc_client';
import { CommitsList } from './CommitsList';
import { PushCommitDetails } from './PushCommitDetails';
import { PushFooter } from './PushFooter';
import { SplitPane } from '../common/SplitPane';
import styles from './PushTab.module.css';

export function PushTab() {

    const [commits, setCommits] = useState<CommitDetails[]>([]);
    const [selectedCommitHashes, setSelectedCommitHashes] = useState<string[]>([]);
    const [pushTags, setPushTags] = useState(false);
    const [isPushing, setIsPushing] = useState(false);

    const [localBranch, setLocalBranch] = useState<string>('');
    const [remotes, setRemotes] = useState<string[]>([]);
    const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
    const [selectedRemote, setSelectedRemote] = useState<string>('');
    const [selectedRemoteBranch, setSelectedRemoteBranch] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadInitData = async () => {
            try {
                const data = await rpc.getPushInitState();
                setLocalBranch(data.localBranch);
                setRemotes(data.remotes);

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

    useEffect(() => {
        if (!selectedRemote) return;

        const loadRemoteBranches = async () => {
            try {
                const branches = await rpc.getRemoteBranches(selectedRemote);
                setRemoteBranches(branches);

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
        } catch (e) {
            console.error('Push failed', e);
        } finally {
            setIsPushing(false);
        }
    };

    if (isLoading) {
        return <div className={styles.loadingOverlay}><div className={styles.loadingSpinner}></div></div>;
    }

    return (
        <div className={styles.pushContainer}>
            <SplitPane
                direction="vertical"
                defaultRatio={0.5}
                minSize={100}
                className={styles.splitContainer}
                first={
                    <CommitsList
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

            <PushFooter
                pushTags={pushTags}
                onPushTagsChange={setPushTags}
                onPush={() => handlePush(false)}
                onForcePush={() => handlePush(true)}
                isPushing={isPushing}
            />

            {isPushing && (
                <div className={styles.loadingOverlay}>
                    <div className={styles.loadingSpinner}></div>
                </div>
            )}
        </div>
    );
}
