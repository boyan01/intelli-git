import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './RebaseForm.module.css';

interface RebaseFormProps {
    mode: 'interactive' | 'merging';
    message: string;
    addedCount?: number;
    modifiedCount?: number;
    deletedCount?: number;
    disableContinue?: boolean;
    onMessageChange: (msg: string) => void;
    onContinue: () => void;
}

export const RebaseForm: React.FC<RebaseFormProps> = ({
    mode,
    message,
    addedCount = 0,
    modifiedCount = 0,
    deletedCount = 0,
    disableContinue = false,
    onMessageChange,
    onContinue,
}) => {
    const { t } = useTranslation();

    return (
        <div className={styles.commitSection}>
            <div className={styles.commitToolbar}>
                <div className={styles.rebaseLabel}>
                    <span className="codicon codicon-git-merge"></span>
                    <span>{mode === 'interactive' ? t('Rebase in progress') : t('Merge in progress')}</span>
                </div>
                <div className={styles.rebaseHint}>
                    {t('Resolve conflicts and stage the resolved files before continuing')}
                </div>
                {(addedCount > 0 || modifiedCount > 0 || deletedCount > 0) && (
                    <div className={styles.stats}>
                        {addedCount > 0 && (
                            <span className={styles.statAdded}>{t('{{count}} Added', { count: addedCount })}</span>
                        )}
                        {modifiedCount > 0 && (
                            <span className={styles.statModified}>
                                {t('{{count}} Modified', { count: modifiedCount })}
                            </span>
                        )}
                        {deletedCount > 0 && (
                            <span className={styles.statDeleted}>
                                {t('{{count}} Deleted', { count: deletedCount })}
                            </span>
                        )}
                    </div>
                )}
            </div>

            <textarea
                className={styles.textarea}
                value={message}
                onChange={(e) => onMessageChange(e.target.value)}
                placeholder={t('Commit Message')}
                rows={4}
            />

            <div className={styles.footerActions}>
                <div className={styles.actionsLeft}>
                    <button
                        className={`${styles.btn} ${styles.btnPrimary} ${styles.continueBtn}`}
                        onClick={onContinue}
                        disabled={disableContinue}
                        title={disableContinue ? t('Resolve conflicts before continuing') : ''}
                    >
                        <span className={`codicon codicon-play ${styles.icon}`}></span>
                        {t('Continue')}
                    </button>
                </div>
            </div>
        </div>
    );
};
