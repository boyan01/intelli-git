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
    onToggleView,
    onRemoteChange,
    onRemoteBranchChange
}) => {
    const { t } = useTranslation();


    const [isRemoteDropdownOpen, setIsRemoteDropdownOpen] = useState(false);
    const [isBranchEditing, setIsBranchEditing] = useState(false);
    const [branchInputValue, setBranchInputValue] = useState(selectedRemoteBranch);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
    const [showSuggestions, setShowSuggestions] = useState(true);

    const remoteDropdownRef = useRef<HTMLDivElement>(null);
    const branchInputRef = useRef<HTMLInputElement>(null);
    const branchEditRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setBranchInputValue(selectedRemoteBranch);
    }, [selectedRemoteBranch]);

    useEffect(() => {
        if (isBranchEditing && branchInputRef.current) {
            branchInputRef.current.focus();
            branchInputRef.current.select();
        }
    }, [isBranchEditing]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (remoteDropdownRef.current && !remoteDropdownRef.current.contains(e.target as Node)) {
                setIsRemoteDropdownOpen(false);
            }
            if (branchEditRef.current && !branchEditRef.current.contains(e.target as Node)) {
                if (isBranchEditing) {
                    handleBranchConfirm();
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isBranchEditing, branchInputValue]);

    const isNewBranch = selectedRemoteBranch.trim() !== '' && !remoteBranches.includes(selectedRemoteBranch);

    const filteredBranches = remoteBranches.filter(b =>
        b.toLowerCase().includes(branchInputValue.toLowerCase())
    );

    const handleRemoteSelect = (remote: string) => {
        onRemoteChange(remote);
        setIsRemoteDropdownOpen(false);
    };

    const handleBranchConfirm = () => {
        const trimmed = branchInputValue.trim();
        if (trimmed && trimmed !== selectedRemoteBranch) {
            onRemoteBranchChange(trimmed);
        } else {
            setBranchInputValue(selectedRemoteBranch);
        }
        setIsBranchEditing(false);
        setSelectedSuggestionIndex(0);
        setShowSuggestions(true);
    };

    const handleBranchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (showSuggestions && filteredBranches.length > 0) {
                setSelectedSuggestionIndex(prev =>
                    prev < filteredBranches.length - 1 ? prev + 1 : prev
                );
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (showSuggestions && filteredBranches.length > 0) {
                setSelectedSuggestionIndex(prev => prev > 0 ? prev - 1 : 0);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (showSuggestions && filteredBranches.length > 0 && filteredBranches[selectedSuggestionIndex]) {
                setBranchInputValue(filteredBranches[selectedSuggestionIndex]);
                setShowSuggestions(false);
            } else {
                handleBranchConfirm();
            }
        } else if (e.key === 'Escape') {
            setBranchInputValue(selectedRemoteBranch);
            setIsBranchEditing(false);
            setSelectedSuggestionIndex(0);
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
                {!isBranchEditing ? (
                    <div
                        className={styles.remoteDisplay}
                        ref={remoteDropdownRef}
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
                            onClick={() => setIsBranchEditing(true)}
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
                    <div className={styles.inlineEditWrapper} ref={branchEditRef}>
                        <span className={styles.remotePrefix}>{selectedRemote}/</span>
                        <div className={styles.inputStack}>
                            <input
                                ref={branchInputRef}
                                type="text"
                                className={styles.inlineInput}
                                value={branchInputValue}
                                onChange={(e) => {
                                    setBranchInputValue(e.target.value);
                                    setSelectedSuggestionIndex(0);
                                    setShowSuggestions(true);
                                }}
                                onKeyDown={handleBranchKeyDown}
                                onBlur={() => {
                                    setTimeout(() => {
                                        if (document.activeElement !== branchInputRef.current) {
                                            handleBranchConfirm();
                                        }
                                    }, 150);
                                }}
                            />
                            {showSuggestions && filteredBranches.length > 0 && (
                                <div className={styles.suggestionsList}>
                                    {filteredBranches.slice(0, 5).map((branch, idx) => (
                                        <div
                                            key={branch}
                                            className={`${styles.suggestionItem} ${idx === selectedSuggestionIndex ? styles.suggestionItemSelected : ''}`}
                                            onMouseDown={() => {
                                                setBranchInputValue(branch);
                                                setShowSuggestions(false);
                                                handleBranchConfirm();
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
