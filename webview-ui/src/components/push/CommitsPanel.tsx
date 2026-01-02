import type { CommitInfo, PushConfig } from '@shared/messages';
import styles from './CommitsPanel.module.css';

interface CommitsPanelProps {
    commits: CommitInfo[];
    config: PushConfig;
    selectedCommitHash: string | null;
    onSelectCommit: (index: number, hash: string) => void;
    onRemoteChange: (remote: string) => void;
    onRemoteBranchChange: (branch: string) => void;
}

export function CommitsPanel({
    commits,
    config,
    selectedCommitHash,
    onSelectCommit,
    onRemoteChange,
    onRemoteBranchChange
}: CommitsPanelProps) {
    const handleRemoteChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        onRemoteChange(e.target.value);
    };

    const handleRemoteBranchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onRemoteBranchChange(e.target.value);
    };

    return (
        <div className={styles.commitsPanel}>
            <div className={styles.commitsHeader}>
                <div className={styles.branchFlow}>
                    <span className={styles.localBranch}>{config.currentBranch}</span>
                    <span className={styles.arrow}>→</span>
                    <div className={styles.remoteSelector}>
                        <select
                            className={styles.branchSelect}
                            value={config.remote}
                            onChange={handleRemoteChange}
                        >
                            {config.remotes.map(r => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                        <span className={styles.separator}>:</span>
                        <div className={styles.branchInputWrapper}>
                            <input
                                type="text"
                                className={styles.branchInput}
                                defaultValue={config.remoteBranch}
                                onBlur={handleRemoteBranchChange}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRemoteBranchChange(e as any);
                                }}
                                placeholder="branch name"
                            />
                        </div>
                    </div>
                </div>
            </div>
            <div className={styles.commitsList}>
                {commits.map((commit, index) => (
                    <div
                        key={commit.hash}
                        className={`${styles.commitItem} ${selectedCommitHash === commit.hash ? styles.selected : ''}`}
                        onClick={() => onSelectCommit(index, commit.hash)}
                    >
                        <span className={styles.commitHash}>{commit.shortHash}</span>
                        <div className={styles.commitMessage} title={commit.subject}>{commit.subject}</div>
                        <div className={styles.commitMeta}>
                            <span className={styles.commitDate}>{commit.date}</span>
                            <span className={styles.commitAuthor}>{commit.authorName}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

