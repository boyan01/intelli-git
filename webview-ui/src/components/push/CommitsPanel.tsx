import { useState, useRef, useEffect } from 'react';
import type { CommitDetails } from '@shared/messages';
import styles from './CommitsPanel.module.css';

interface CommitsPanelProps {
    commits: CommitDetails[];
    localBranch: string;
    currentRemote: string;
    currentRemoteBranch: string;
    remotes: string[];
    remoteBranches: string[];
    selectedCommitHashes: string[];
    onSelectCommits: (hashes: string[]) => void;
    onRemoteChange: (remote: string) => void;
    onRemoteBranchChange: (branch: string) => void;
}

export function CommitsPanel({
    commits,
    localBranch,
    currentRemote,
    currentRemoteBranch,
    remotes,
    remoteBranches,
    selectedCommitHashes,
    onSelectCommits,
    onRemoteChange,
    onRemoteBranchChange
}: CommitsPanelProps) {
    const [isRemoteDropdownOpen, setIsRemoteDropdownOpen] = useState(false);
    const [isBranchEditing, setIsBranchEditing] = useState(false);
    const [branchInputValue, setBranchInputValue] = useState(currentRemoteBranch);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
    const [showSuggestions, setShowSuggestions] = useState(true);

    const remoteRef = useRef<HTMLDivElement>(null);
    const branchInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setBranchInputValue(currentRemoteBranch);
    }, [currentRemoteBranch]);

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
        if (trimmed && trimmed !== currentRemoteBranch) {
            onRemoteBranchChange(trimmed);
        } else {
            setBranchInputValue(currentRemoteBranch);
        }
        setIsBranchEditing(false);
        setSelectedSuggestionIndex(0);
    };

    const filteredBranches = remoteBranches.filter(b =>
        b.toLowerCase().includes(branchInputValue.toLowerCase())
    );

    const isNewBranch = currentRemoteBranch.trim() !== '' &&
        !remoteBranches.includes(currentRemoteBranch);

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
            setBranchInputValue(currentRemoteBranch);
            setIsBranchEditing(false);
            setSelectedSuggestionIndex(0);
            setShowSuggestions(true);
        }
    };

    const truncatedBranch = localBranch.length > 20
        ? localBranch.slice(0, 20) + '…'
        : localBranch;

    const isAllSelected = selectedCommitHashes.length === 0;

    const handleHeaderClick = () => {
        onSelectCommits([]);
    };

    const handleCommitClick = (e: React.MouseEvent, hash: string) => {
        if (e.metaKey || e.ctrlKey) {
            if (selectedCommitHashes.includes(hash)) {
                onSelectCommits(selectedCommitHashes.filter(h => h !== hash));
            } else {
                onSelectCommits([...selectedCommitHashes, hash]);
            }
        } else {
            onSelectCommits([hash]);
        }
    };

    return (
        <div className={styles.commitsPanel}>
            <div
                className={`${styles.commitsHeader} ${styles.commitsHeaderClickable} ${isAllSelected ? styles.headerSelected : ''}`}
                onClick={handleHeaderClick}
            >
                <div className={styles.branchFlow}>
                    {!isBranchEditing && (
                        <>
                            <span className={styles.localBranch} title={localBranch}>
                                {truncatedBranch}
                            </span>

                            <span className={styles.arrow}>→</span>

                            {/* Remote Selector */}
                            <div className={styles.remoteDropdown} ref={remoteRef}>
                                <span
                                    className={styles.inlineHighlight}
                                    onClick={(e) => { e.stopPropagation(); setIsRemoteDropdownOpen(!isRemoteDropdownOpen); }}
                                >
                                    {currentRemote}
                                </span>
                                {isRemoteDropdownOpen && remotes.length > 1 && (
                                    <div className={styles.dropdownMenu}>
                                        {remotes.map(r => (
                                            <div
                                                key={r}
                                                className={`${styles.dropdownItem} ${r === currentRemote ? styles.dropdownItemSelected : ''}`}
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
                                onClick={(e) => { e.stopPropagation(); setIsBranchEditing(true); }}
                            >
                                {currentRemoteBranch}
                            </span>

                            {isNewBranch && (
                                <span className={styles.newBadge}>new</span>
                            )}
                        </>
                    )}

                    {/* Branch Edit Mode */}
                    {isBranchEditing && (
                        <div className={styles.branchEditWrapper} ref={dropdownRef} onClick={e => e.stopPropagation()}>
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
                {commits.map((commit) => (
                    <div
                        key={commit.hash}
                        className={`${styles.commitItem} ${selectedCommitHashes.includes(commit.hash) ? styles.selected : ''}`}
                        data-vscode-context={JSON.stringify({ webviewSection: 'commitItem', hash: commit.hash })}
                        onClick={(e) => handleCommitClick(e, commit.hash)}
                    >
                        <div className={styles.commitMessage} title={commit.subject}>{commit.subject}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

