import React, { useState, useEffect } from 'react';
import styles from './DateFilter.module.css';
import { FilterMenu } from './FilterMenu';

interface DateFilterProps {
    onChange: (dates: { since?: string; until?: string }) => void;
}

export const DateFilter: React.FC<DateFilterProps> = ({ onChange }) => {
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
            case '24h': return '过去 24 小时';
            case '7d': return '过去 7 天';
            case 'custom':
                if (customSince && customUntil) return `${customSince} - ${customUntil}`;
                if (customSince) return `Since ${customSince}`;
                if (customUntil) return `Until ${customUntil}`;
                return '自定义日期';
            default: return '日期';
        }
    };

    const dropdownItems = (
        <>
            <div className={styles.dropdownItem} onClick={() => handleSelect('custom')}>选择...</div>
            <div className={styles.dropdownItem} onClick={() => handleSelect('24h')}>过去 24 小时</div>
            <div className={styles.dropdownItem} onClick={() => handleSelect('7d')}>过去 7 天</div>
        </>
    );

    const popupContent = (
        <>
            <div className={styles.inputGroup}>
                <span className={styles.inputLabel}>Since (之后)</span>
                <input
                    className={`${styles.dateInput} ${sinceError ? styles.invalid : ''}`}
                    placeholder="如: 2023-01-01"
                    value={customSince}
                    onChange={e => {
                        setCustomSince(e.target.value);
                        if (sinceError) setSinceError(false);
                    }}
                />
            </div>
            <div className={styles.inputGroup}>
                <span className={styles.inputLabel}>Until (之前)</span>
                <input
                    className={`${styles.dateInput} ${untilError ? styles.invalid : ''}`}
                    placeholder="如: 2023-01-31"
                    value={customUntil}
                    onChange={e => {
                        setCustomUntil(e.target.value);
                        if (untilError) setUntilError(false);
                    }}
                />
            </div>
            <div className={styles.popupButtonRow}>
                <button className={styles.primaryButton} onClick={handleCustomApply}>应用</button>
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
