import { useState, useRef, useCallback, useEffect } from 'react';
import type { LogCommit } from '@shared/messages';

interface UseCommitSelectionProps {
    commits: LogCommit[];
    onSelectionChange?: (commits: string[]) => void;
    scrollToRow?: (index: number) => void;
    initialSelection?: string[];
    onSelectionPersist?: (selection: string[]) => void;
}

export const useCommitSelection = ({
    commits,
    onSelectionChange,
    scrollToRow,
    initialSelection,
    onSelectionPersist,
}: UseCommitSelectionProps) => {
    const [selectedCommits, setSelectedCommits] = useState<string[]>(initialSelection || []);
    const [blinkHash, setBlinkHash] = useState<string | null>(null);
    const lastSelectedRef = useRef<string | null>(initialSelection?.[0] || null);

    // Persist selection changes
    useEffect(() => {
        onSelectionPersist?.(selectedCommits);
    }, [selectedCommits, onSelectionPersist]);

    const isSelected = useCallback((hash: string) => selectedCommits.includes(hash), [selectedCommits]);

    const handleRowClick = useCallback(
        (e: React.MouseEvent, commit: LogCommit) => {
            const hash = commit.hash;
            let newSelection: string[];

            if (e.metaKey || e.ctrlKey) {
                // Toggle selection
                if (selectedCommits.includes(hash)) {
                    newSelection = selectedCommits.filter((h) => h !== hash);
                } else {
                    newSelection = [...selectedCommits, hash];
                }
                lastSelectedRef.current = hash;
            } else if (e.shiftKey && lastSelectedRef.current) {
                // Range selection
                const lastIndex = commits.findIndex((c) => c.hash === lastSelectedRef.current);
                const currentIndex = commits.findIndex((c) => c.hash === hash);
                if (lastIndex !== -1 && currentIndex !== -1) {
                    const start = Math.min(lastIndex, currentIndex);
                    const end = Math.max(lastIndex, currentIndex);
                    const range = commits.slice(start, end + 1).map((c) => c.hash);
                    newSelection = range;
                } else {
                    newSelection = [hash];
                    lastSelectedRef.current = hash;
                }
            } else {
                // Single selection
                newSelection = [hash];
                lastSelectedRef.current = hash;
            }

            setSelectedCommits(newSelection);
            onSelectionChange?.(newSelection);
        },
        [commits, selectedCommits, onSelectionChange]
    );

    const handleJumpToCommit = useCallback(
        (hash: string) => {
            const index = commits.findIndex((c) => c.hash === hash);
            if (index !== -1) {
                scrollToRow?.(index);

                setSelectedCommits([hash]);
                onSelectionChange?.([hash]);
                lastSelectedRef.current = hash;

                // Blink effect
                setBlinkHash(hash);
                setTimeout(() => setBlinkHash(null), 1000);
            }
        },
        [commits, onSelectionChange, scrollToRow]
    );

    return {
        selectedCommits,
        lastSelectedRef,
        blinkHash,
        handleRowClick,
        handleJumpToCommit,
        isSelected,
        setSelectedCommits,
    };
};
