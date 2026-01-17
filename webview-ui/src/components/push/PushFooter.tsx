import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PushFooter.module.css';

export interface PushFooterProps {
    commitCount: number;
    isPushing: boolean;
    pushTags: boolean;
    onPush: (force: boolean) => void;
    onPushTagsChange: (value: boolean) => void;
}

export const PushFooter: React.FC<PushFooterProps> = ({
    commitCount,
    isPushing,
    pushTags,
    onPush,
    onPushTagsChange
}) => {
    const { t } = useTranslation();
    const [showPushOptions, setShowPushOptions] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowPushOptions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className={styles.footer} style={{ position: 'relative' }} ref={menuRef}>
            <button
                className={styles.pushBtn}
                onClick={() => onPush(false)}
                disabled={isPushing || commitCount === 0}
            >
                {isPushing ? (
                    <>
                        <i className="codicon codicon-sync codicon-modifier-spin" />
                        {' '}{t('Pushing...')}
                    </>
                ) : (
                    t('Push {{count}} Commits', { count: commitCount })
                )}
            </button>
            <button
                className={styles.pushOptionsBtn}
                onClick={() => setShowPushOptions(!showPushOptions)}
            >
                <span>{t('Push Options')}</span>
                <i className={`codicon codicon-chevron-${showPushOptions ? 'up' : 'down'}`} />
            </button>

            {showPushOptions && (
                <div className={styles.pushOptionsMenu}>
                    <div
                        className={styles.dropdownItem}
                        onClick={() => onPushTagsChange(!pushTags)}
                    >
                        <i className={`codicon ${pushTags ? 'codicon-check' : 'codicon-blank'}`} />
                        {t('Push Tags')}
                    </div>
                    <div
                        className={styles.dropdownItem}
                        onClick={() => {
                            onPush(true);
                            setShowPushOptions(false);
                        }}
                    >
                        <i className="codicon codicon-warning" />
                        {t('Force Push')}
                    </div>
                </div>
            )}
        </div>
    );
};
