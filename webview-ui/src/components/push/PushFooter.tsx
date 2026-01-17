import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PushTab.module.css';

interface PushFooterProps {
    pushTags: boolean;
    onPushTagsChange: (checked: boolean) => void;
    onPush: () => void;
    onForcePush: () => void;
    isPushing: boolean;
}

export function PushFooter({
    pushTags,
    onPushTagsChange,
    onPush,
    onForcePush,
    isPushing
}: PushFooterProps) {
    const { t } = useTranslation();
    const [isForcePushExpanded, setIsForcePushExpanded] = useState(false);

    return (
        <div className={styles.pushFooter}>
            <div className={styles.footerLeft}>
                <div className={styles.pushTagsGroup}>
                    <label>
                        <input
                            type="checkbox"
                            checked={pushTags}
                            onChange={e => onPushTagsChange(e.target.checked)}
                        />
                        {t('Push Tags')}
                    </label>
                </div>
            </div>
            <div className={styles.footerRight}>
                <div className={styles.btnSplit} style={{ position: 'relative' }}>
                    <button
                        className={`${styles.btn} ${styles.btnPrimary} ${styles.btnMain}`}
                        onClick={onPush}
                        disabled={isPushing}
                    >
                        {t('Push')}
                    </button>
                    <button
                        className={`${styles.btn} ${styles.btnPrimary} ${styles.btnDropdown}`}
                        onClick={() => setIsForcePushExpanded(!isForcePushExpanded)}
                        disabled={isPushing}
                    >
                        <i className="codicon codicon-chevron-down"></i>
                    </button>
                    {isForcePushExpanded && (
                        <div className={styles.dropdownMenu} style={{ display: 'block', bottom: '100%', top: 'auto' }}>
                            <div className={styles.dropdownItem} onClick={() => {
                                onForcePush();
                                setIsForcePushExpanded(false);
                            }}>
                                <i className="codicon codicon-warning icon"></i>
                                <span>{t('Force Push')}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
