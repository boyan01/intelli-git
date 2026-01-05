import React from 'react';
import styles from './BranchStatus.module.css';

interface BranchStatusProps {
    current?: string;
    ahead?: number;
    behind?: number;
}

export const BranchStatus: React.FC<BranchStatusProps> = ({ current, ahead, behind }) => {
    return (
        <div className={styles.container}>
            {current && (
                <>
                    <i className={`codicon codicon-repo-forked ${styles.icon}`} />
                    <span className={styles.name} title={current}>{current}</span>
                </>
            )}

            {(ahead || 0) > 0 && (
                <div className={`${styles.statusItem} ${styles.ahead}`}>
                    <i className={`codicon codicon-arrow-up ${styles.statusIcon}`} />
                    <span className={styles.count}>{ahead}</span>
                </div>
            )}

            {(behind || 0) > 0 && (
                <div className={`${styles.statusItem} ${styles.behind}`}>
                    <i className={`codicon codicon-arrow-down ${styles.statusIcon}`} />
                    <span className={styles.count}>{behind}</span>
                </div>
            )}
        </div>
    );
};
