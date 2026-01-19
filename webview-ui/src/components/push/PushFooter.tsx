import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PushFooter.module.css';
import { rpc } from '@/lib/rpc_client';

export interface PushOptions {
    force: boolean;
    tags: boolean;
    noVerify: boolean;
}

export type PushStatus = 'idle' | 'pushing' | 'success' | 'error';

export interface PushFooterProps {
    commitCount: number;
    selectedRemote: string;
    selectedRemoteBranch: string;
    onPushComplete: () => void;
}

export const PushFooter: React.FC<PushFooterProps> = ({
    commitCount,
    selectedRemote,
    selectedRemoteBranch,
    onPushComplete,
}) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [pushStatus, setPushStatus] = useState<PushStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [options, setOptions] = useState<PushOptions>({
        force: false,
        tags: false,
        noVerify: false
    });
    const dropdownRef = useRef<HTMLDivElement>(null);

    const toggleOption = (key: keyof PushOptions) => {
        setOptions(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handlePush = async () => {
        if (!selectedRemote || !selectedRemoteBranch) return;

        setError(null);
        setPushStatus('pushing');
        try {
            await rpc.push({
                force: options.force,
                pushTags: options.tags,
                noVerify: options.noVerify,
                remote: selectedRemote,
                branch: selectedRemoteBranch
            });
            setPushStatus('success');
            onPushComplete();

            // Reset to idle after 2 seconds
            setTimeout(() => setPushStatus('idle'), 2000);
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            setError(errMsg);
            setPushStatus('error');
        }
    };

    const onDismissError = () => setError(null);

    const getButtonState = () => {
        if (pushStatus === 'success') {
            return {
                text: t('Push Completed'),
                variant: 'success' as const,
                icon: 'codicon-check'
            };
        }
        if (options.force) {
            return {
                text: t('Force Push'),
                variant: 'danger' as const,
                icon: 'codicon-warning'
            };
        }
        if (options.tags) {
            return {
                text: t('Push with Tags'),
                variant: 'primary' as const,
                icon: 'codicon-tag'
            };
        }
        return {
            text: t('Push {{count}} Commits', { count: commitCount }),
            variant: 'primary' as const,
            icon: 'codicon-repo-push'
        };
    };

    const btnState = getButtonState();
    const isPushing = pushStatus === 'pushing';
    const isDisabled = isPushing || pushStatus === 'success' || commitCount === 0;

    return (
        <div className={styles.footer}>
            {error && (
                <div className={styles.errorMessage}>
                    <i className="codicon codicon-warning" />
                    <span>{error}</span>
                    <button
                        className={styles.dismissBtn}
                        onClick={onDismissError}
                        title={t('Dismiss')}
                    >
                        <i className="codicon codicon-close" />
                    </button>
                </div>
            )}
            <div
                className={styles.splitButton}
                ref={dropdownRef}
                onBlur={(e) => {
                    // Only close if focus moves outside the entire container
                    if (!dropdownRef.current?.contains(e.relatedTarget as Node)) {
                        setIsOpen(false);
                    }
                }}
            >
                {/* Main action button */}
                <button
                    className={`${styles.mainBtn} ${styles[btnState.variant]}`}
                    onClick={handlePush}
                    disabled={isDisabled}
                >
                    <i className={`codicon ${isPushing ? 'codicon-sync codicon-modifier-spin' : btnState.icon}`} />
                    <span>{isPushing ? t('Pushing...') : btnState.text}</span>
                </button>

                {/* Options trigger button */}
                <button
                    className={`${styles.optionsBtn} ${styles[btnState.variant]}`}
                    onClick={() => setIsOpen(!isOpen)}
                    disabled={isPushing}
                    aria-label={t('Push Options')}
                >
                    <i className={`codicon codicon-chevron-up ${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`} />
                </button>

                {/* Dropdown menu */}
                {isOpen && (
                    <div className={styles.dropdown}>
                        <div className={styles.dropdownHeader}>
                            {t('Push Options')}
                        </div>

                        {/* Option: Push Tags */}
                        <button
                            className={styles.dropdownItem}
                            onClick={() => toggleOption('tags')}
                        >
                            <div className={styles.itemContent}>
                                <i className="codicon codicon-tag" />
                                <span>{t('Include Tags')}</span>
                            </div>
                            {options.tags && <i className="codicon codicon-check" />}
                        </button>

                        {/* Option: No Verify */}
                        <button
                            className={styles.dropdownItem}
                            onClick={() => toggleOption('noVerify')}
                        >
                            <div className={styles.itemContent}>
                                <span className={styles.ciLabel}>CI</span>
                                <span>{t('Skip CI Verification')}</span>
                            </div>
                            {options.noVerify && <i className="codicon codicon-check" />}
                        </button>

                        <div className={styles.dropdownDivider} />

                        {/* Option: Force Push (Danger Zone) */}
                        <button
                            className={`${styles.dropdownItem} ${options.force ? styles.dangerItem : ''}`}
                            onClick={() => toggleOption('force')}
                        >
                            <div className={styles.itemContent}>
                                <i className={`codicon codicon-warning ${options.force ? styles.dangerIcon : ''}`} />
                                <span>{t('Force Push')}</span>
                            </div>
                            {options.force && <i className={`codicon codicon-check ${styles.dangerIcon}`} />}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
