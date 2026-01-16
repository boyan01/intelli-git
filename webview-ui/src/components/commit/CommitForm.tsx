import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './CommitForm.module.css';
import { rpc } from '../../lib/rpc_client';

interface CommitFormProps {
    message: string;
    amend: boolean;
    selectedFiles: Set<string>;
    addedCount?: number;
    modifiedCount?: number;
    deletedCount?: number;
    onMessageChange: (msg: string) => void;
    onAmendChange: (amend: boolean) => void;
}

export const CommitForm: React.FC<CommitFormProps> = ({
    message,
    amend,
    selectedFiles,
    addedCount = 0,
    modifiedCount = 0,
    deletedCount = 0,
    onMessageChange,
    onAmendChange
}) => {
    const { t } = useTranslation();
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGenerateMessage = async () => {
        setError(null);
        setIsGenerating(true);
        try {
            const msg = await rpc.generateCommitMessage(Array.from(selectedFiles));
            onMessageChange(msg);
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            setError(t('Generate failed: {{message}}', { message: errMsg }));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCommit = async (push: boolean) => {
        setError(null);
        const files = Array.from(selectedFiles);
        if (files.length === 0 && !amend) {
            return;
        }
        try {
            await rpc.commit({
                message: message,
                files: files,
                amend: amend,
                push: push
            });
            onMessageChange('');
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            setError(t('Commit failed: {{message}}', { message: errMsg }));
        }
    };

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
                        <span>{t('Amend(M)')}</span>
                    </label>

                    <button
                        className={`${styles.iconBtn} ${styles.generateBtn}`}
                        onClick={handleGenerateMessage}
                        disabled={isGenerating || selectedFiles.size === 0}
                        title={t('Generate')}
                    >
                        <i className={`codicon ${isGenerating ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`}></i>
                    </button>
                </div>

                {(addedCount > 0 || modifiedCount > 0 || deletedCount > 0) && (
                    <div className={styles.stats}>
                        {addedCount > 0 && <span className={styles.statAdded}>{t('{{count}} Added', { count: addedCount })}</span>}
                        {modifiedCount > 0 && <span className={styles.statModified}>{t('{{count}} Modified', { count: modifiedCount })}</span>}
                        {deletedCount > 0 && <span className={styles.statDeleted}>{t('{{count}} Deleted', { count: deletedCount })}</span>}
                    </div>
                )}
            </div>

            <textarea
                value={message}
                onChange={(e) => onMessageChange(e.target.value)}
                placeholder={t('Commit Message')}
                rows={4}
                className={styles.textarea}
            />

            {error && (
                <div className={styles.errorMessage}>
                    <i className="codicon codicon-warning"></i>
                    <span>{error}</span>
                    <button
                        className={styles.dismissBtn}
                        onClick={() => setError(null)}
                        title={t('Dismiss')}
                    >
                        <i className="codicon codicon-close"></i>
                    </button>
                </div>
            )}

            <div className={styles.footerActions}>
                <div className={styles.actionsLeft}>
                    <button
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={() => handleCommit(false)}
                    >
                        {t('Commit(I)')}
                    </button>
                    <button
                        className={`${styles.btn} ${styles.btnSecondary}`}
                        onClick={() => handleCommit(true)}
                    >
                        {t('Commit & Push(P)...')}
                    </button>
                </div>
                <div className={styles.actionsRight}>
                    <button className={styles.iconBtn} title={t('Settings')}>
                        <i className="codicon codicon-settings-gear"></i>
                    </button>
                </div>
            </div>
        </div>
    );
};
