import { logger } from '@/lib/log';
import type { StashItem } from '@shared/messages';
import { useTranslation } from 'react-i18next';
import styles from './StashList.module.css';

interface StashListProps {
    stashes: StashItem[];
    onAction: (action: 'apply' | 'pop' | 'drop', stashIndex: number) => void;
}

export const StashList: React.FC<StashListProps> = ({ stashes, onAction }) => {
    const { t } = useTranslation();

    logger.log("stashLis1t", stashes);

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
                            <button className={styles.iconBtn} title={t('stashList.actions.pop')} onClick={() => onAction('pop', stash.index)}>
                                <i className="codicon codicon-reply"></i>
                            </button>
                            <button className={styles.iconBtn} title={t('stashList.actions.drop')} onClick={() => onAction('drop', stash.index)}>
                                <i className="codicon codicon-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};
