import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './CommitForm.module.css';

interface CommitFormProps {
    message: string;
    amend: boolean;
    addedCount?: number;
    modifiedCount?: number;
    deletedCount?: number;
    onMessageChange: (msg: string) => void;
    onAmendChange: (amend: boolean) => void;
    onCommit: (push: boolean) => void;
    isGenerating?: boolean;
    onGenerate?: () => void;
}

export const CommitForm: React.FC<CommitFormProps> = ({
    message,
    amend,
    addedCount = 0,
    modifiedCount = 0,
    deletedCount = 0,
    onMessageChange,
    onAmendChange,
    onCommit,
    isGenerating = false,
    onGenerate
}) => {
    const { t } = useTranslation();

    return (
        <div className={styles.commitSection}>
            <div className={styles.commitToolbar}>
                <div className={styles.commitToolbarLeft}>
                    <label className={styles.amendLabel}>
                        <input
                            type="checkbox"
                            checked={amend}
                            onChange={(e) => onAmendChange(e.target.checked)}
                            className={styles.amendInput}
                        />
                        <span>{t('commitForm.amend')}</span>
                    </label>

                    {onGenerate && (
                        <button
                            className={`${styles.iconBtn} ${styles.generateBtn}`}
                            onClick={onGenerate}
                            disabled={isGenerating}
                            title={t('commitForm.generate')}
                        >
                            <i className={`codicon ${isGenerating ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`}></i>
                        </button>
                    )}
                </div>

                {(addedCount > 0 || modifiedCount > 0 || deletedCount > 0) && (
                    <div className={styles.stats}>
                        {addedCount > 0 && <span className={styles.statAdded}>{t('commitForm.stats.added', { count: addedCount })}</span>}
                        {modifiedCount > 0 && <span className={styles.statModified}>{t('commitForm.stats.modified', { count: modifiedCount })}</span>}
                        {deletedCount > 0 && <span className={styles.statDeleted}>{t('commitForm.stats.deleted', { count: deletedCount })}</span>}
                    </div>
                )}
            </div>

            <textarea
                value={message}
                onChange={(e) => onMessageChange(e.target.value)}
                placeholder={t('commitForm.placeholder')}
                rows={4}
                className={styles.textarea}
            />

            <div className={styles.footerActions}>
                <div className={styles.actionsLeft}>
                    <button
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={() => onCommit(false)}
                    >
                        {t('commitForm.actions.commit')}
                    </button>
                    <button
                        className={`${styles.btn} ${styles.btnSecondary}`}
                        onClick={() => onCommit(true)}
                    >
                        {t('commitForm.actions.commitAndPush')}
                    </button>
                </div>
                <div className={styles.actionsRight}>
                    <button className={styles.iconBtn} title={t('commitForm.settings')}>
                        <i className="codicon codicon-settings-gear"></i>
                    </button>
                </div>
            </div>
        </div>
    );
};
