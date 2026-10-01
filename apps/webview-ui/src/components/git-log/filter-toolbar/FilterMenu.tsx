import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import styles from './FilterToolbar.module.css';

export interface FilterMenuItem {
    id: string;
    label: React.ReactNode;
    onSelect: () => void;
    checked?: boolean;
    disabled?: boolean;
}

interface FilterMenuProps {
    label: string | React.ReactNode;
    active: boolean;
    onClear: () => void;
    showMenu: boolean;
    setShowMenu: (show: boolean) => void;
    showPopup: boolean;
    setShowPopup: (show: boolean) => void;
    dropdownItems: FilterMenuItem[];
    popupContent?: React.ReactNode;
    className?: string;
    ariaLabel?: string;
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
    className,
    ariaLabel,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const itemRefs = useRef(new Map<string, HTMLDivElement>());
    const menuId = useId();
    const popupId = useId();
    const [focusedIndex, setFocusedIndex] = useState(0);

    const enabledItems = dropdownItems.filter((item) => !item.disabled);

    const closeMenu = useCallback(() => {
        setShowMenu(false);
        setShowPopup(false);
        buttonRef.current?.focus();
    }, [setShowMenu, setShowPopup]);

    const openMenu = (focusLast = false) => {
        setShowPopup(false);
        setShowMenu(true);
        const checkedIndex = dropdownItems.findIndex((item) => item.checked && !item.disabled);
        if (checkedIndex >= 0) {
            setFocusedIndex(checkedIndex);
        } else if (focusLast) {
            setFocusedIndex(Math.max(0, dropdownItems.length - 1));
        } else {
            setFocusedIndex(0);
        }
    };

    const selectItem = (item: FilterMenuItem) => {
        if (item.disabled) return;
        item.onSelect();
    };

    const focusItemAt = (index: number) => {
        if (enabledItems.length === 0) return;

        const enabledIndex = enabledItems.findIndex((item) => item.id === dropdownItems[index]?.id);
        const nextEnabledIndex = enabledIndex >= 0 ? enabledIndex : 0;
        const item = enabledItems[nextEnabledIndex];
        const nextIndex = dropdownItems.findIndex((candidate) => candidate.id === item.id);
        setFocusedIndex(nextIndex);
    };

    const moveFocus = (delta: number) => {
        if (enabledItems.length === 0) return;

        const currentItem = dropdownItems[focusedIndex];
        const currentEnabledIndex = enabledItems.findIndex((item) => item.id === currentItem?.id);
        const nextEnabledIndex = (currentEnabledIndex + delta + enabledItems.length) % enabledItems.length;
        const nextItem = enabledItems[nextEnabledIndex];
        setFocusedIndex(dropdownItems.findIndex((item) => item.id === nextItem.id));
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setShowMenu(false);
                setShowPopup(false);
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeMenu();
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
    }, [closeMenu, showMenu, showPopup, setShowMenu, setShowPopup]);

    useEffect(() => {
        if (!showMenu) return;

        const item = dropdownItems[focusedIndex];
        if (!item) return;

        itemRefs.current.get(item.id)?.focus();
    }, [dropdownItems, focusedIndex, showMenu]);

    const handleButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            openMenu();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu(true);
        }
    };

    const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                moveFocus(1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                moveFocus(-1);
                break;
            case 'Home':
                event.preventDefault();
                focusItemAt(0);
                break;
            case 'End':
                event.preventDefault();
                focusItemAt(dropdownItems.length - 1);
                break;
            case 'Enter':
            case ' ': {
                event.preventDefault();
                const item = dropdownItems[focusedIndex];
                if (item) {
                    selectItem(item);
                }
                break;
            }
            case 'Escape':
                event.preventDefault();
                closeMenu();
                break;
            case 'Tab':
                setShowMenu(false);
                setShowPopup(false);
                break;
            default:
                break;
        }
    };

    return (
        <div className={`${styles.dropdownContainer} ${className || ''}`} ref={containerRef}>
            <button
                ref={buttonRef}
                className={`${styles.filterButton} ${active ? styles.active : ''}`}
                onClick={() => {
                    if (showMenu) {
                        setShowMenu(false);
                    } else {
                        openMenu();
                    }
                }}
                onKeyDown={handleButtonKeyDown}
                aria-haspopup="menu"
                aria-expanded={showMenu}
                aria-controls={showMenu ? menuId : undefined}
                aria-label={ariaLabel}
            >
                <span className={styles.buttonLabel}>{label}</span>
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
                <div
                    id={menuId}
                    className={styles.dropdownMenu}
                    role="menu"
                    aria-label={ariaLabel}
                    onKeyDown={handleMenuKeyDown}
                >
                    {dropdownItems.map((item, index) => (
                        <div
                            key={item.id}
                            ref={(element) => {
                                if (element) {
                                    itemRefs.current.set(item.id, element);
                                } else {
                                    itemRefs.current.delete(item.id);
                                }
                            }}
                            className={`${styles.dropdownItem} ${index === focusedIndex ? styles.focusedDropdownItem : ''} ${item.disabled ? styles.disabledDropdownItem : ''}`}
                            role="menuitemcheckbox"
                            aria-checked={!!item.checked}
                            aria-disabled={item.disabled || undefined}
                            tabIndex={index === focusedIndex && !item.disabled ? 0 : -1}
                            onMouseEnter={() => {
                                if (!item.disabled) {
                                    setFocusedIndex(index);
                                }
                            }}
                            onClick={() => selectItem(item)}
                        >
                            <span className={styles.dropdownItemLabel}>{item.label}</span>
                            <span className={`codicon codicon-check ${styles.dropdownItemCheck}`} aria-hidden="true" />
                        </div>
                    ))}
                </div>
            )}

            {showPopup && popupContent && (
                <div id={popupId} className={styles.popup} role="dialog" aria-label={ariaLabel}>
                    {popupContent}
                </div>
            )}
        </div>
    );
};
