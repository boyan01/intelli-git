import React, { useState, useEffect, useRef } from 'react';
import sharedStyles from './DateFilter.module.css';
import styles from './UserFilter.module.css';
import { FilterMenu, type FilterMenuItem } from './FilterMenu';
import { rpc } from '../../../lib/rpc_client';
import { useTranslation } from 'react-i18next';

interface AuthorInputPopupProps {
    initialValue: string;
    onApply: (value: string) => void;
    allAuthors: string[];
}

const AuthorInputPopup: React.FC<AuthorInputPopupProps> = ({ initialValue, onApply, allAuthors }) => {
    const { t } = useTranslation();
    const [value, setValue] = useState(initialValue);
    const [activeIndex, setActiveIndex] = useState(0);
    const [suggestionPos, setSuggestionPos] = useState({ top: 0, left: 0 });
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const lines = value.split('\n');
    const lastLine = lines[lines.length - 1].trim().toLowerCase();
    const currentLineInput = lastLine;

    const suggestions = lastLine ? allAuthors.filter((a) => a.toLowerCase().includes(lastLine)) : [];

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const getCaretPosition = () => {
        const textarea = inputRef.current;
        if (!textarea) return { top: 0, left: 0 };

        const computed = window.getComputedStyle(textarea);
        const lineHeight = parseInt(computed.lineHeight) || 16;
        const paddingTop = parseInt(computed.paddingTop) || 0;
        const paddingLeft = parseInt(computed.paddingLeft) || 0;

        const textBeforeCaret = value.substring(0, textarea.selectionStart);
        const linesBeforeCaret = textBeforeCaret.split('\n');
        const currentLineNumber = linesBeforeCaret.length - 1;

        return {
            top: paddingTop + (currentLineNumber + 1) * lineHeight,
            left: paddingLeft,
        };
    };

    const updateCaretPosition = () => {
        const pos = getCaretPosition();
        setSuggestionPos(pos);
    };

    const selectSuggestion = (author: string) => {
        const lines = value.split('\n');
        lines[lines.length - 1] = author;
        setValue(lines.join('\n') + '\n');
        inputRef.current?.focus();
    };

    const handleApply = () => {
        onApply(value);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        const hasSuggestions = currentLineInput && suggestions.length > 0;

        if (e.key === 'Enter') {
            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                handleApply();
            } else if (hasSuggestions) {
                e.preventDefault();
                selectSuggestion(suggestions[activeIndex]);
            }
        } else if (e.key === 'ArrowDown' && hasSuggestions) {
            e.preventDefault();
            setActiveIndex((prev) => (prev + 1) % suggestions.length);
        } else if (e.key === 'ArrowUp' && hasSuggestions) {
            e.preventDefault();
            setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setValue(e.target.value);
        setActiveIndex(0);
        requestAnimationFrame(updateCaretPosition);
    };

    const showSuggestions = currentLineInput && suggestions.length > 0;

    return (
        <div className={`${sharedStyles.inputGroup} ${styles.popupContainer}`}>
            <div className={styles.inputWrapper}>
                <textarea
                    ref={inputRef}
                    className={`${sharedStyles.dateInput} ${styles.textarea}`}
                    value={value}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onKeyUp={updateCaretPosition}
                    onClick={updateCaretPosition}
                />
                {showSuggestions && (
                    <div className={styles.suggestionList} style={{ top: suggestionPos.top, left: suggestionPos.left }}>
                        {suggestions.slice(0, 8).map((author, idx) => (
                            <div
                                key={author}
                                className={`${styles.suggestionItem} ${idx === activeIndex ? styles.active : ''}`}
                                onMouseDown={() => selectSuggestion(author)}
                            >
                                {author}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <div className={sharedStyles.popupButtonRow}>
                <span className={styles.hint}>{t('Press Enter to apply, Ctrl+Enter to force apply')}</span>
                <button className={sharedStyles.primaryButton} onClick={handleApply}>
                    {t('Apply')}
                </button>
            </div>
        </div>
    );
};

interface UserFilterProps {
    onChange: (authors: string[] | undefined) => void;
    initialAuthors?: string[];
}

export const UserFilter: React.FC<UserFilterProps> = ({ onChange, initialAuthors }) => {
    const { t } = useTranslation();
    const [filterType, setFilterType] = useState<'all' | 'me' | 'custom'>(() => {
        if (initialAuthors && initialAuthors.length > 0) return 'custom';
        return 'all';
    });
    const [appliedValue, setAppliedValue] = useState(() => initialAuthors?.join('\n') || '');
    const [showMenu, setShowMenu] = useState(false);
    const [showPopup, setShowPopup] = useState(false);
    const [allAuthors, setAllAuthors] = useState<string[]>([]);
    const [currentUser, setCurrentUser] = useState('');

    useEffect(() => {
        rpc.getCurrentUser().then((user) => {
            setCurrentUser(user);
        });
    }, []);

    useEffect(() => {
        if (showPopup && allAuthors.length === 0) {
            rpc.getAuthors().then((authors) => {
                setAllAuthors(authors);
            });
        }
    }, [showPopup, allAuthors.length]);

    const handleSelectMe = () => {
        if (!currentUser) return;
        setFilterType('me');
        setAppliedValue(currentUser);
        onChange([currentUser]);
        setShowMenu(false);
    };

    const handleSelectCustom = () => {
        setFilterType('custom');
        setShowMenu(false);
        setShowPopup(true);
    };

    const handleApply = (value: string) => {
        setAppliedValue(value);
        const authors = value
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => !!s);
        if (authors.length > 0) {
            onChange(authors);
        } else {
            onChange(undefined);
            setFilterType('all');
        }
        setShowPopup(false);
    };

    const getLabel = () => {
        if (filterType === 'all') return t('Author');
        if (filterType === 'me') return t('Me');
        if (appliedValue) {
            const lines = appliedValue.split('\n').filter((l) => l.trim());
            if (lines.length > 1) return `${lines[0]} +${lines.length - 1}`;
            return lines[0] || t('Author');
        }
        return t('Author');
    };

    const dropdownItems: FilterMenuItem[] = [
        {
            id: 'custom',
            label: t('Custom...'),
            checked: filterType === 'custom',
            onSelect: handleSelectCustom,
        },
        ...(currentUser
            ? [
                  {
                      id: 'me',
                      label: `${t('Me')} (${currentUser})`,
                      checked: filterType === 'me',
                      onSelect: handleSelectMe,
                  },
              ]
            : []),
    ];

    return (
        <FilterMenu
            label={getLabel()}
            active={filterType !== 'all'}
            onClear={() => {
                setFilterType('all');
                setAppliedValue('');
                onChange(undefined);
            }}
            showMenu={showMenu}
            setShowMenu={setShowMenu}
            showPopup={showPopup}
            setShowPopup={setShowPopup}
            dropdownItems={dropdownItems}
            popupContent={
                <AuthorInputPopup initialValue={appliedValue} onApply={handleApply} allAuthors={allAuthors} />
            }
            ariaLabel={t('Author')}
        />
    );
};
