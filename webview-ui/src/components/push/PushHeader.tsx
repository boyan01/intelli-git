import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PushHeader.module.css';

// ... imports ...
export interface PushHeaderProps {

    selectedRemote: string;
    selectedRemoteBranch: string;
    remotes: string[];
    remoteBranches: string[];
    viewMode: 'commits' | 'changes';
    isLoading?: boolean;
    onToggleView: () => void;
    onRemoteChange: (remote: string) => void;
    onRemoteBranchChange: (branch: string) => void;
}

export const PushHeader: React.FC<PushHeaderProps> = ({
    selectedRemote,
    selectedRemoteBranch,
    remotes,
    remoteBranches,
    viewMode,
    isLoading = false,
    onToggleView,
    onRemoteChange,
    onRemoteBranchChange
}) => {
    const { t } = useTranslation();


    const [isRemoteDropdownOpen, setIsRemoteDropdownOpen] = useState(false);
    const [isEditingBranch, setIsEditingBranch] = useState(false);
    const [editValue, setEditValue] = useState(selectedRemoteBranch);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [showSuggestions, setShowSuggestions] = useState(true);

    const remoteRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const editWrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setEditValue(selectedRemoteBranch);
    }, [selectedRemoteBranch]);

    useEffect(() => {
        if (isEditingBranch && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditingBranch]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (remoteRef.current && !remoteRef.current.contains(event.target as Node)) {
                setIsRemoteDropdownOpen(false);
            }
            if (editWrapperRef.current && !editWrapperRef.current.contains(event.target as Node)) {
                if (isEditingBranch) {
                    handleCommitEdit();
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isEditingBranch, editValue]);

    const targetBranch = isEditingBranch ? editValue : selectedRemoteBranch;
    const isNewBranch = !isLoading && targetBranch.trim() !== '' && !remoteBranches.includes(targetBranch);

    const filteredBranches = remoteBranches.filter(b =>
        b.toLowerCase().includes(editValue.toLowerCase())
    );

    const handleRemoteSelect = (remote: string) => {
        onRemoteChange(remote);
        setIsRemoteDropdownOpen(false);
    };

    const handleCommitEdit = () => {
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== selectedRemoteBranch) {
            onRemoteBranchChange(trimmed);
        } else {
            setEditValue(selectedRemoteBranch);
        }
        setIsEditingBranch(false);
        setHighlightedIndex(0);
        setShowSuggestions(true);
    };

    const handleBranchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (showSuggestions && filteredBranches.length > 0) {
                setHighlightedIndex(prev =>
                    prev < filteredBranches.length - 1 ? prev + 1 : prev
                );
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (showSuggestions && filteredBranches.length > 0) {
                setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (showSuggestions && filteredBranches.length > 0 && filteredBranches[highlightedIndex]) {
                onRemoteBranchChange(filteredBranches[highlightedIndex]);
                setIsEditingBranch(false);
                setHighlightedIndex(0);
                setShowSuggestions(true);
            } else {
                handleCommitEdit();
            }
        } else if (e.key === 'Escape') {
            setEditValue(selectedRemoteBranch);
            setIsEditingBranch(false);
            setHighlightedIndex(0);
            setShowSuggestions(true);
        }
    };

    const truncateBranch = (branch: string, maxLen: number = 18) => {
        return branch.length > maxLen ? branch.slice(0, maxLen) + '…' : branch;
    };

    return <div className={styles.headerContainer}>
        <div className={styles.headerTitleRow}>
            <div className={styles.pushTargetLabel}>{t('Push Target')}</div>
            <button
                className={styles.iconBtn}
                onClick={onToggleView}
                title={viewMode === 'commits' ? t('Switch to Changes') : t('Switch to Commits')}
            >
                <i className={`codicon ${viewMode === 'commits' ? 'codicon-git-commit' : 'codicon-files'}`} />
            </button>
        </div>
        <div className={styles.branchRow}>
            {/* Arrow */}
            <div className={styles.arrowRow}>
                <span>→</span>
            </div>

            {/* Remote Branch (Target) */}
            <div className={styles.remoteWrapper}>
                {!isEditingBranch ? (
                    <div
                        className={styles.remoteDisplay}
                        ref={remoteRef}
                    >
                        {/* Remote Part (Click to Select Remote) */}
                        <span
                            className={styles.remotePart}
                            onClick={() => setIsRemoteDropdownOpen(!isRemoteDropdownOpen)}
                            title={t('Select Remote')}
                        >
                            {selectedRemote}
                        </span>

                        <span className={styles.separator}>/</span>

                        {/* Branch Part (Click to Edit Branch) */}
                        <span
                            className={styles.branchPart}
                            onClick={() => setIsEditingBranch(true)}
                            title={t('Edit Branch')}
                        >
                            {truncateBranch(selectedRemoteBranch, 20)}
                        </span>

                        {/* Remote Dropdown List */}
                        {isRemoteDropdownOpen && (
                            <div className={styles.remoteDropdown}>
                                {remotes.map(remote => (
                                    <div
                                        key={remote}
                                        className={`${styles.suggestionItem} ${remote === selectedRemote ? styles.suggestionItemSelected : ''}`}
                                        onClick={() => handleRemoteSelect(remote)}
                                    >
                                        {remote}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className={styles.inlineEditWrapper} ref={editWrapperRef}>
                        <span className={styles.remotePrefix}>{selectedRemote}/</span>
                        <div className={styles.inputStack}>
                            <input
                                ref={inputRef}
                                type="text"
                                className={styles.inlineInput}
                                value={editValue}
                                onChange={(e) => {
                                    setEditValue(e.target.value);
                                    setHighlightedIndex(0);
                                    setShowSuggestions(true);
                                }}
                                onKeyDown={handleBranchKeyDown}
                                onBlur={() => {
                                    setTimeout(() => {
                                        if (document.activeElement !== inputRef.current) {
                                            handleCommitEdit();
                                        }
                                    }, 150);
                                }}
                            />
                            {showSuggestions && filteredBranches.length > 0 && (
                                <div className={styles.suggestionsList}>
                                    {filteredBranches.slice(0, 5).map((branch, idx) => (
                                        <div
                                            key={branch}
                                            className={`${styles.suggestionItem} ${idx === highlightedIndex ? styles.suggestionItemSelected : ''}`}
                                            onMouseDown={() => {
                                                onRemoteBranchChange(branch);
                                                setIsEditingBranch(false);
                                                setHighlightedIndex(0);
                                                setShowSuggestions(true);
                                            }}
                                        >
                                            {branch}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
                {isNewBranch && (
                    <span className={styles.newBadge}>NEW</span>
                )}
            </div>
        </div>
    </div>;
};
