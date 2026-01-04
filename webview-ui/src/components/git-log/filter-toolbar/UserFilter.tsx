import React, { useState, useEffect, useRef } from 'react';
import sharedStyles from './DateFilter.module.css';
import styles from './UserFilter.module.css';
import { FilterMenu } from './FilterMenu';
import { rpc } from '../../../lib/rpc_client';

interface AuthorInputPopupProps {
    initialValue: string;
    onApply: (value: string) => void;
    allAuthors: string[];
}

const AuthorInputPopup: React.FC<AuthorInputPopupProps> = ({
    initialValue,
    onApply,
    allAuthors
}) => {
    const [value, setValue] = useState(initialValue);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [suggestionPos, setSuggestionPos] = useState({ top: 0, left: 0 });
    const [currentLineInput, setCurrentLineInput] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        const lines = value.split('\n');
        const lastLine = lines[lines.length - 1].trim().toLowerCase();
        setCurrentLineInput(lastLine);

        if (lastLine) {
            setSuggestions(allAuthors.filter(a =>
                a.toLowerCase().includes(lastLine)
            ));
        } else {
            setSuggestions([]);
        }
        setActiveIndex(0);
    }, [value, allAuthors]);

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
            left: paddingLeft
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
            setActiveIndex(prev => (prev + 1) % suggestions.length);
        } else if (e.key === 'ArrowUp' && hasSuggestions) {
            e.preventDefault();
            setActiveIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
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
                    <div
                        className={styles.suggestionList}
                        style={{ top: suggestionPos.top, left: suggestionPos.left }}
                    >
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
                <span className={styles.hint}>回车选择建议，⌘+Enter 应用</span>
                <button className={sharedStyles.primaryButton} onClick={handleApply}>应用</button>
            </div>
        </div>
    );
};

interface UserFilterProps {
    onChange: (authors: string[] | undefined) => void;
}

export const UserFilter: React.FC<UserFilterProps> = ({ onChange }) => {
    const [filterType, setFilterType] = useState<'all' | 'me' | 'custom'>('all');
    const [appliedValue, setAppliedValue] = useState('');
    const [showMenu, setShowMenu] = useState(false);
    const [showPopup, setShowPopup] = useState(false);
    const [allAuthors, setAllAuthors] = useState<string[]>([]);
    const [currentUser, setCurrentUser] = useState('');

    useEffect(() => {
        rpc.getCurrentUser().then(user => {
            setCurrentUser(user);
        });
    }, []);

    useEffect(() => {
        if (showPopup && allAuthors.length === 0) {
            rpc.getAuthors().then(authors => {
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
        const authors = value.split('\n').map(s => s.trim()).filter(s => !!s);
        if (authors.length > 0) {
            onChange(authors);
        } else {
            onChange(undefined);
            setFilterType('all');
        }
        setShowPopup(false);
    };

    const getLabel = () => {
        if (filterType === 'all') return '用户';
        if (filterType === 'me') return 'Me';
        if (appliedValue) {
            const lines = appliedValue.split('\n').filter(l => l.trim());
            if (lines.length > 1) return `${lines[0]} +${lines.length - 1}`;
            return lines[0] || '用户';
        }
        return '用户';
    };

    const dropdownItems = (
        <>
            <div className={sharedStyles.dropdownItem} onClick={handleSelectCustom}>选择...</div>
            {currentUser && (
                <div className={sharedStyles.dropdownItem} onClick={handleSelectMe}>Me ({currentUser})</div>
            )}
        </>
    );

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
                <AuthorInputPopup
                    initialValue={appliedValue}
                    onApply={handleApply}
                    allAuthors={allAuthors}
                />
            }
        />
    );
};
