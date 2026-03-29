import React, { useEffect, useRef } from 'react';
import styles from './FilterToolbar.module.css'; // Reuse existing styles or move to shared

interface FilterMenuProps {
    label: string | React.ReactNode;
    active: boolean;
    onClear: () => void;
    showMenu: boolean;
    setShowMenu: (show: boolean) => void;
    showPopup: boolean;
    setShowPopup: (show: boolean) => void;
    dropdownItems: React.ReactNode;
    popupContent?: React.ReactNode;
    className?: string;
}

export const FilterMenu: React.FC<FilterMenuProps> = ({
    label,
    active,
    onClear,
    showMenu,
    setShowMenu,
    showPopup,
    setShowPopup,
    dropdownItems,
    popupContent,
    className
}) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setShowMenu(false);
                setShowPopup(false);
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setShowMenu(false);
                setShowPopup(false);
            }
        };

        if (showMenu || showPopup) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [showMenu, showPopup, setShowMenu, setShowPopup]);

    return (
        <div className={`${styles.dropdownContainer} ${className || ''}`} ref={containerRef}>
            <button
                className={`${styles.filterButton} ${active ? styles.active : ''}`}
                onClick={() => setShowMenu(!showMenu)}
            >
                <span className={styles.buttonLabel}>
                    {label}
                </span>
                {active ? (
                    <span
                        className={`codicon codicon-close ${styles.icon} ${styles.iconMedium}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onClear();
                        }}
                    />
                ) : (
                    <span className={`codicon codicon-chevron-down ${styles.icon} ${styles.iconSmall}`} />
                )}
            </button>

            {showMenu && (
                <div className={styles.dropdownMenu}>
                    {dropdownItems}
                </div>
            )}

            {showPopup && popupContent && (
                <div className={styles.popup}>
                    {popupContent}
                </div>
            )}
        </div>
    );
};
