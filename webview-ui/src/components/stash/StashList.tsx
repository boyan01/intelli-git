import { useState, useEffect, useCallback } from 'react';
import { logger } from '@/lib/log';
import type { StashItem } from '@shared/messages';
import { useTranslation } from 'react-i18next';
import { rpc } from '../../lib/rpc_client';
import styles from './StashList.module.css';

export function StashList() {
    const { t } = useTranslation();
    const [stashes, setStashes] = useState<StashItem[]>([]);

    const loadStashes = useCallback(async () => {
        try {
            const data = await rpc.getStashList();
            setStashes(data);
        } catch (e) {
            logger.log('Failed to load stashes:', e);
        }
    }, []);

    useEffect(() => {
        loadStashes();
    }, [loadStashes]);

    const handleAction = async (action: 'apply' | 'pop' | 'drop', stashIndex: number) => {
        try {
            if (action === 'apply') await rpc.applyStash(stashIndex);
            if (action === 'pop') await rpc.popStash(stashIndex);
            if (action === 'drop') await rpc.dropStash(stashIndex);
        } catch (e) {
            logger.log(`Stash ${action} failed:`, e);
        }
    };

    logger.log('stashList', stashes);

    if (!stashes || stashes.length === 0) {
        return <div className={styles.emptyState}>{t('stashList.empty')}</div>;
    }

    return (
        <div className={styles.stashList}>
            {stashes.map((stash) => (
                <div key={stash.index} className={styles.stashItem}>
                    <div className={styles.stashItemHeader}>
                        <span className={`codicon codicon-chevron-right ${styles.stashItemExpand}`}></span>
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                            <div className={styles.stashItemName}>{stash.message || `Stash@{${stash.index}}`}</div>
                            <div className={styles.stashItemBranch}>
                                <i className="codicon codicon-git-branch"></i>
                                <span>{stash.branch || 'HEAD'}</span>
                            </div>
                        </div>
                        <div className={styles.stashActions}>
                            <button className={styles.iconBtn} title={t('stashList.actions.pop')} onClick={() => handleAction('pop', stash.index)}>
                                <i className="codicon codicon-reply"></i>
                            </button>
                            <button className={styles.iconBtn} title={t('stashList.actions.drop')} onClick={() => handleAction('drop', stash.index)}>
                                <i className="codicon codicon-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
