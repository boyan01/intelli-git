import { useState, useRef, useEffect } from 'react';
import type { CommitInfo, PushConfig } from '@shared/messages';
import styles from './CommitsPanel.module.css';

interface CommitsPanelProps {
    commits: CommitInfo[];
    config: PushConfig;
    selectedCommitHash: string | null;
    onSelectCommit: (index: number, hash: string) => void;
    onRemoteChange: (remote: string) => void;
    onRemoteBranchChange: (branch: string) => void;
}

export function CommitsPanel({
    commits,
    config,
    selectedCommitHash,
    onSelectCommit,
    onRemoteChange,
    onRemoteBranchChange
}: CommitsPanelProps) {
    const [isRemoteDropdownOpen, setIsRemoteDropdownOpen] = useState(false);
    const [isBranchEditing, setIsBranchEditing] = useState(false);
    const [branchInputValue, setBranchInputValue] = useState(config.remoteBranch);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
    const [showSuggestions, setShowSuggestions] = useState(true);

    const remoteRef = useRef<HTMLDivElement>(null);
    const branchInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setBranchInputValue(config.remoteBranch);
    }, [config.remoteBranch]);

    useEffect(() => {
        if (isBranchEditing && branchInputRef.current) {
            branchInputRef.current.focus();
            branchInputRef.current.select();
        }
    }, [isBranchEditing]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (remoteRef.current && !remoteRef.current.contains(e.target as Node)) {
                setIsRemoteDropdownOpen(false);
            }
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                if (isBranchEditing) {
                    handleBranchConfirm();
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isBranchEditing, branchInputValue]);

    const handleRemoteSelect = (remote: string) => {
        onRemoteChange(remote);
        setIsRemoteDropdownOpen(false);
    };

    const handleBranchConfirm = () => {
        const trimmed = branchInputValue.trim();
        if (trimmed && trimmed !== config.remoteBranch) {
            onRemoteBranchChange(trimmed);
        } else {
            setBranchInputValue(config.remoteBranch);
        }
        setIsBranchEditing(false);
        setSelectedSuggestionIndex(0);
    };

    // Strip remote prefix from branch names for display
    const stripRemotePrefix = (branch: string) => {
        const prefix = `${config.remote}/`;
        return branch.startsWith(prefix) ? branch.slice(prefix.length) : branch;
    };

    const filteredBranches = config.remoteBranches
        .map(stripRemotePrefix)
        .filter(b => b.toLowerCase().includes(branchInputValue.toLowerCase()));

    const isNewBranch = config.remoteBranch.trim() !== '' &&
        !config.remoteBranches.some(b => b === config.remoteBranch);

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
                // Fill input and hide suggestions
                setBranchInputValue(filteredBranches[selectedSuggestionIndex]);
                setShowSuggestions(false);
            } else {
                // Submit and close editing
                handleBranchConfirm();
            }
        } else if (e.key === 'Escape') {
            setBranchInputValue(config.remoteBranch);
            setIsBranchEditing(false);
            setSelectedSuggestionIndex(0);
            setShowSuggestions(true);
        }
    };

    const truncatedBranch = config.currentBranch.length > 20
        ? config.currentBranch.slice(0, 20) + '…'
        : config.currentBranch;

    return (
        <div className={styles.commitsPanel}>
            <div className={styles.commitsHeader}>
                <div className={styles.branchFlow}>
                    {!isBranchEditing && (
                        <>
                            <span className={styles.localBranch} title={config.currentBranch}>
                                {truncatedBranch}
                            </span>

                            <span className={styles.arrow}>→</span>

                            {/* Remote Selector */}
                            <div className={styles.remoteDropdown} ref={remoteRef}>
                                <span
                                    className={styles.inlineHighlight}
                                    onClick={() => setIsRemoteDropdownOpen(!isRemoteDropdownOpen)}
                                >
                                    {config.remote}
                                </span>
                                {isRemoteDropdownOpen && config.remotes.length > 1 && (
                                    <div className={styles.dropdownMenu}>
                                        {config.remotes.map(r => (
                                            <div
                                                key={r}
                                                className={`${styles.dropdownItem} ${r === config.remote ? styles.dropdownItemSelected : ''}`}
                                                onClick={() => handleRemoteSelect(r)}
                                            >
                                                {r}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <span className={styles.separator}>:</span>

                            {/* Branch Display (click to edit) */}
                            <span
                                className={styles.inlineHighlight}
                                onClick={() => setIsBranchEditing(true)}
                            >
                                {config.remoteBranch}
                            </span>

                            {isNewBranch && (
                                <span className={styles.newBadge}>new</span>
                            )}
                        </>
                    )}

                    {/* Branch Edit Mode */}
                    {isBranchEditing && (
                        <div className={styles.branchEditWrapper} ref={dropdownRef}>
                            <input
                                ref={branchInputRef}
                                type="text"
                                className={styles.branchInput}
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
                                placeholder="branch name"
                            />
                            {showSuggestions && filteredBranches.length > 0 && (
                                <div className={styles.suggestionsDropdown}>
                                    {filteredBranches.slice(0, 10).map((branch, idx) => (
                                        <div
                                            key={branch}
                                            className={`${styles.suggestionItem} ${idx === selectedSuggestionIndex ? styles.suggestionItemSelected : ''}`}
                                            onMouseDown={() => {
                                                setBranchInputValue(branch);
                                                setShowSuggestions(false);
                                            }}
                                        >
                                            {branch}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <div className={styles.commitsList}>
                {commits.map((commit, index) => (
                    <div
                        key={commit.hash}
                        className={`${styles.commitItem} ${selectedCommitHash === commit.hash ? styles.selected : ''}`}
                        onClick={() => onSelectCommit(index, commit.hash)}
                    >
                        <div className={styles.commitMessage} title={commit.subject}>{commit.subject}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
