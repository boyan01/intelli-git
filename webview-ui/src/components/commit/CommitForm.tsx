import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './CommitForm.module.css';
import { rpc } from '../../lib/rpc_client';

interface CommitOptions {
    push: boolean;
    signOff: boolean;
}

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
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [options, setOptions] = useState<CommitOptions>({
        push: false,
        signOff: false
    });
    const dropdownRef = useRef<HTMLDivElement>(null);

    const toggleOption = (key: keyof CommitOptions) => {
        setOptions(prev => ({ ...prev, [key]: !prev[key] }));
    };

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

    const handleCommit = async () => {
        setError(null);
        const files = Array.from(selectedFiles);
        if (files.length === 0 && !amend) {
            return;
        }
        try {
            await rpc.commit({
                message: options.signOff ? `${message}\n\nSigned-off-by: ` : message,
                files: files,
                amend: amend,
                push: options.push
            });
            onMessageChange('');
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            setError(t('Commit failed: {{message}}', { message: errMsg }));
        }
    };

    const getButtonState = () => {
        if (amend && options.push) {
            return {
                text: t('Amend & Push'),
                variant: 'primary' as const,
                icon: 'codicon-repo-push'
            };
        }
        if (amend) {
            return {
                text: t('Amend'),
                variant: 'secondary' as const,
                icon: 'codicon-edit'
            };
        }
        if (options.push) {
            return {
                text: t('Commit & Push'),
                variant: 'primary' as const,
                icon: 'codicon-repo-push'
            };
        }
        return {
            text: t('Commit'),
            variant: 'primary' as const,
            icon: 'codicon-check'
        };
    };

    const btnState = getButtonState();
    const isDisabled = (selectedFiles.size === 0 && !amend) || !message.trim();

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
                        <span>{t('Amend')}</span>
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
                <div
                    className={styles.splitButton}
                    ref={dropdownRef}
                    onBlur={(e) => {
                        if (!dropdownRef.current?.contains(e.relatedTarget as Node)) {
                            setIsDropdownOpen(false);
                        }
                    }}
                >
                    <button
                        className={`${styles.mainBtn} ${styles[btnState.variant]}`}
                        onClick={handleCommit}
                        disabled={isDisabled}
                    >
                        <i className={`codicon ${btnState.icon}`} />
                        <span>{btnState.text}</span>
                    </button>

                    <button
                        className={`${styles.optionsBtn} ${styles[btnState.variant]} ${isDisabled ? styles.optionsBtnDisabled : ''}`}
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        aria-label={t('Commit Options')}
                    >
                        <i className={`codicon codicon-chevron-up ${styles.chevron} ${isDropdownOpen ? styles.chevronOpen : ''}`} />
                    </button>

                    {isDropdownOpen && (
                        <div className={styles.dropdown}>
                            <div className={styles.dropdownHeader}>
                                {t('Commit Options')}
                            </div>

                            <button
                                className={styles.dropdownItem}
                                onClick={() => toggleOption('push')}
                            >
                                <div className={styles.itemContent}>
                                    <i className="codicon codicon-repo-push" />
                                    <span>{t('Push after Commit')}</span>
                                </div>
                                <span className={styles.checkIcon}>
                                    {options.push && <i className="codicon codicon-check" />}
                                </span>
                            </button>

                            <button
                                className={styles.dropdownItem}
                                onClick={() => toggleOption('signOff')}
                            >
                                <div className={styles.itemContent}>
                                    <i className="codicon codicon-verified" />
                                    <span>{t('Sign Off')}</span>
                                </div>
                                <span className={styles.checkIcon}>
                                    {options.signOff && <i className="codicon codicon-check" />}
                                </span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
