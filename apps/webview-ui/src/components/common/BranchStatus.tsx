import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rpc } from '../../lib/rpc_client';
import styles from './BranchStatus.module.css';

interface BranchStatusProps {
    current?: string;
    ahead?: number;
    behind?: number;
    onPush?: () => void;
}

export const BranchStatus: React.FC<BranchStatusProps> = ({
    current,
    ahead,
    behind,
    onPush
}) => {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const isSynced = (ahead || 0) === 0 && (behind || 0) === 0;

    return (
        <div className={styles.container}>
            {current && (
                <div
                    className={styles.section}
                    onClick={(e) => {
                        e.stopPropagation();
                        rpc.pickBranch();
                    }}
                    title={t('Switch Branch')}
                >
                    <i className={`codicon codicon-repo-forked ${styles.icon}`} />
                    <span className={styles.name}>{current}</span>
                </div>
            )}

            {(behind || 0) > 0 && (
                <div
                    className={`${styles.section} ${styles.behind}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        rpc.pull();
                    }}
                    title={t('Pull {{count}} commits from remote', { count: behind })}
                >
                    <div className={styles.statusItem}>
                        <i className={`codicon codicon-arrow-down ${styles.statusIcon}`} />
                        <span className={styles.count}>{behind}</span>
                    </div>
                </div>
            )}

            {(ahead || 0) > 0 && (
                <div
                    className={`${styles.section} ${styles.ahead}`}
                    onClick={(e) => { e.stopPropagation(); onPush?.(); }}
                    title={t('Push {{count}} commits to remote', { count: ahead })}
                >
                    <div className={styles.statusItem}>
                        <i className={`codicon codicon-arrow-up ${styles.statusIcon}`} />
                        <span className={styles.count}>{ahead}</span>
                    </div>
                </div>
            )}

            {isSynced && (
                <div
                    className={`${styles.section} ${styles.synced}`}
                    onClick={async (e) => {
                        e.stopPropagation();
                        if (isLoading) return;

                        setIsLoading(true);
                        try {
                            await rpc.fetch();
                        } catch (error) {
                            rpc.showErrorMessage(String(error));
                        } finally {
                            setIsLoading(false);
                        }
                    }}
                    title={isLoading ? t('Fetching...') : t('Fetch')}
                >
                    <i className={`codicon ${isLoading ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'} ${styles.statusIcon}`} />
                </div>
            )}
        </div>
    );
};
