import React from 'react';
import { useTranslation } from 'react-i18next';
import { rpc } from '../../lib/rpc_client';
import styles from './VersionExpiredPanel.module.css';

export const VersionExpiredPanel: React.FC = () => {
    const { t } = useTranslation();

    return (
        <div className={styles.panel}>
            <div className={styles.icon}>⏳</div>
            <h2 className={styles.title}>
                {t('version.expired.title')}
            </h2>
            <p className={styles.description}>
                {t('version.expired.description')}
            </p>
            <div className={styles.actions}>
                <button
                    type="button"
                    className={styles.primaryAction}
                    onClick={() => void rpc.openLatestRelease()}
                >
                    {t('version.expired.installLatestRelease')}
                </button>
                <button
                    type="button"
                    className={styles.secondaryAction}
                    onClick={() => void rpc.openFeedback()}
                >
                    {t('version.expired.openFeedback')}
                </button>
                <button
                    type="button"
                    className={styles.secondaryAction}
                    onClick={() => void rpc.rebuildDevVsix()}
                >
                    {t('version.expired.rebuildDevVsix')}
                </button>
            </div>
        </div>
    );
};
