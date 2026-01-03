import React, { useState, useEffect } from 'react';
import type { LogOptions } from '../../../../shared/messages';
import { rpc } from '../../lib/rpc_client';

interface FilterToolbarProps {
    onFilterChange: (options: Partial<LogOptions>) => void;
}

const styles = {
    container: {
        display: 'flex',
        gap: '8px',
        padding: '8px',
        borderBottom: '1px solid var(--vscode-widget-border)',
        alignItems: 'center',
        flexWrap: 'wrap' as const,
    },
    select: {
        backgroundColor: 'var(--vscode-dropdown-background)',
        color: 'var(--vscode-dropdown-foreground)',
        border: '1px solid var(--vscode-dropdown-border)',
        padding: '2px 4px',
        maxWidth: '200px',
    },
    input: {
        backgroundColor: 'var(--vscode-input-background)',
        color: 'var(--vscode-input-foreground)',
        border: '1px solid var(--vscode-input-border)',
        padding: '2px 4px',
        minWidth: '150px',
    }
};

export const FilterToolbar: React.FC<FilterToolbarProps> = ({ onFilterChange }) => {
    const [branches, setBranches] = useState<string[]>([]);
    const [branch, setBranch] = useState('all');
    const [search, setSearch] = useState('');
    const [author, setAuthor] = useState('');

    useEffect(() => {
        rpc.getBranchListData().then(data => {
            const remoteBranches = Object.values(data.remoteBranches).flat();
            const allBranches = ['all', ...data.localBranches, ...remoteBranches];
            setBranches(Array.from(new Set(allBranches)));
        }).catch(console.error);
    }, []);

    // Debounce search/author
    useEffect(() => {
        const timer = setTimeout(() => {
            onFilterChange({
                branch: branch === 'all' ? undefined : branch,
                search: search || undefined,
                author: author || undefined,
            });
        }, 300);
        return () => clearTimeout(timer);
    }, [branch, search, author, onFilterChange]);

    return (
        <div style={styles.container}>
            <select
                style={styles.select}
                value={branch}
                onChange={e => setBranch(e.target.value)}
            >
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>

            <input
                style={styles.input}
                placeholder="User..."
                value={author}
                onChange={e => setAuthor(e.target.value)}
            />

            <input
                style={styles.input}
                placeholder="Search..."
                value={search}
                onChange={e => setSearch(e.target.value)}
            />
            {/* Refresh button maybe? */}
            <button
                onClick={() => onFilterChange({
                    branch: branch === 'all' ? undefined : branch,
                    search: search || undefined,
                    author: author || undefined
                })}
                style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'var(--vscode-button-foreground)' }}
            >
                ↻
            </button>
        </div>
    );
};
