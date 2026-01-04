import React, { useState, useEffect } from 'react';
import styles from './DateFilter.module.css';
import { FilterMenu } from './FilterMenu';
import { useTranslation } from 'react-i18next';

interface DateFilterProps {
    onChange: (dates: { since?: string; until?: string }) => void;
}

export const DateFilter: React.FC<DateFilterProps> = ({ onChange }) => {
    const { t } = useTranslation();
    const [filterType, setFilterType] = useState<'all' | '24h' | '7d' | 'custom'>('all');
    const [customSince, setCustomSince] = useState('');
    const [customUntil, setCustomUntil] = useState('');
    const [showMenu, setShowMenu] = useState(false);
    const [showPopup, setShowPopup] = useState(false);

    // Validation state
    const [sinceError, setSinceError] = useState(false);
    const [untilError, setUntilError] = useState(false);

    useEffect(() => {
        if (filterType === 'all') {
            onChange({ since: undefined, until: undefined });
        } else if (filterType === '24h') {
            onChange({ since: '24 hours ago', until: undefined });
        } else if (filterType === '7d') {
            onChange({ since: '7 days ago', until: undefined });
        }
        // Custom is handled manually on Apply
    }, [filterType, onChange]);

    const handleSelect = (type: 'all' | '24h' | '7d' | 'custom') => {
        if (type === 'custom') {
            setShowMenu(false);
            setShowPopup(true);
        } else {
            setFilterType(type);
            setShowMenu(false);
        }
    };

    const validateDate = (dateStr: string): boolean => {
        if (!dateStr) return true; // empty is valid (optional)
        // Check if it's a valid date using Date.parse
        const timestamp = Date.parse(dateStr);
        if (!isNaN(timestamp)) return true;
        // Also allow relative dates (simple check, git supports many)
        // e.g. "yesterday", "2 weeks ago"
        // It's hard to strict validate fully without git, but let's basic check
        if (dateStr.match(/ago|yesterday|msg|days?|weeks?|months?|years?/i)) return true;
        return false;
    };

    const handleCustomApply = () => {
        const isSinceValid = validateDate(customSince);
        const isUntilValid = validateDate(customUntil);

        setSinceError(!isSinceValid);
        setUntilError(!isUntilValid);

        if (isSinceValid && isUntilValid) {
            setFilterType('custom');
            setShowPopup(false);
            onChange({
                since: customSince || undefined,
                until: customUntil || undefined
            });
        }
    };

    const getLabel = () => {
        switch (filterType) {
            case '24h': return t('filter.date.24h');
            case '7d': return t('filter.date.7d');
            case 'custom':
                if (customSince && customUntil) return `${customSince} - ${customUntil}`;
                if (customSince) return t('filter.date.since', { 0: customSince }); // i18next interpolation uses {{key}} or just {0} if configured, standard i18next defaults. 
                // Wait, useTranslation replacement usually uses keys. { "since": "Since {{date}}" }
                // My JSON has "Since {0}". Extension uses {0}. i18next default is {{key}}.
                // I should check if I configured i18next to use {0} or if I should assume standard.
                // Standard i18next uses {{val}}.
                // Extension vscode.l10n uses {0}.
                // To support both, I might need different strings or a formatter.
                // OR simpler: `t('filter.date.since').replace('{0}', customSince)` for now as a quick fix, 
                // OR better, update JSON to use {{val}} for webview? But we want SHARED json.
                // Shared JSON means one format. VS Code uses {0}. Webview i18next uses {{val}}.
                // I can configure i18next to use {0} interpolation?
                // Yes, `interpolation: { format: ... }` or a custom replace.
                // Or I can just manual replace.
                if (customUntil) return t('filter.date.until').replace('{0}', customUntil);
                return t('filter.date.custom');
            default: return t('filter.date.label');
        }
    };

    const dropdownItems = (
        <>
            <div className={styles.dropdownItem} onClick={() => handleSelect('custom')}>{t('filter.date.placeholder')}</div>
            <div className={styles.dropdownItem} onClick={() => handleSelect('24h')}>{t('filter.date.24h')}</div>
            <div className={styles.dropdownItem} onClick={() => handleSelect('7d')}>{t('filter.date.7d')}</div>
        </>
    );

    const popupContent = (
        <>
            <div className={styles.inputGroup}>
                <span className={styles.inputLabel}>{t('filter.date.inputSince')}</span>
                <input
                    className={`${styles.dateInput} ${sinceError ? styles.invalid : ''}`}
                    placeholder={t('filter.date.example')}
                    value={customSince}
                    onChange={e => {
                        setCustomSince(e.target.value);
                        if (sinceError) setSinceError(false);
                    }}
                />
            </div>
            <div className={styles.inputGroup}>
                <span className={styles.inputLabel}>{t('filter.date.inputUntil')}</span>
                <input
                    className={`${styles.dateInput} ${untilError ? styles.invalid : ''}`}
                    placeholder={t('filter.date.example')}
                    value={customUntil}
                    onChange={e => {
                        setCustomUntil(e.target.value);
                        if (untilError) setUntilError(false);
                    }}
                />
            </div>
            <div className={styles.popupButtonRow}>
                <button className={styles.primaryButton} onClick={handleCustomApply}>{t('common.apply')}</button>
            </div>
        </>
    );

    return (
        <FilterMenu
            label={getLabel()}
            active={filterType !== 'all'}
            onClear={() => {
                setFilterType('all');
                setCustomSince('');
                setCustomUntil('');
            }}
            showMenu={showMenu}
            setShowMenu={setShowMenu}
            showPopup={showPopup}
            setShowPopup={setShowPopup}
            dropdownItems={dropdownItems}
            popupContent={popupContent}
        />
    );
};
