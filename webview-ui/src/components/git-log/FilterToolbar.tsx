import React, { useState, useEffect } from 'react';
import type { LogOptions } from '../../../../shared/messages';
import { rpc } from '../../lib/rpc_client';
import styles from './FilterToolbar.module.css';

interface FilterToolbarProps {
    onFilterChange: (options: Partial<LogOptions>) => void;
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({ onFilterChange }) => {
    const [branch, setBranch] = useState('all');
    const [search, setSearch] = useState('');
    const [regexMode, setRegexMode] = useState(false);
    const [caseSensitive, setCaseSensitive] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            onFilterChange({
                branch: branch === 'all' ? undefined : branch,
                search: search || undefined,
            });
        }, 300);
        return () => clearTimeout(timer);
    }, [branch, search, onFilterChange]);

    const handleBranchClick = async (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.branch-clear')) {
            e.stopPropagation();
            setBranch('all');
            return;
        }
        const picked = await rpc.pickBranchForFilter();
        if (picked !== undefined) {
            setBranch(picked);
        }
    };

    return (
        <div className={styles.container}>
            {/* Search box */}
            <div className={styles.searchBox}>
                <span className={`${styles.searchIcon} codicon codicon-search`} />
                <input
                    className={styles.searchInput}
                    placeholder="文本或哈希"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                <button
                    className={`${styles.inlineToggle} ${regexMode ? styles.active : ''}`}
                    onClick={() => setRegexMode(!regexMode)}
                    title="正则表达式"
                >
                    .*
                </button>
                <button
                    className={`${styles.inlineToggle} ${caseSensitive ? styles.active : ''}`}
                    onClick={() => setCaseSensitive(!caseSensitive)}
                    title="区分大小写"
                >
                    Cc
                </button>
            </div>

            <div className={styles.separator} />

            {/* Branch filter */}
            <button
                className={`${styles.filterButton} ${styles.branchButton}`}
                onClick={handleBranchClick}
                title={branch !== 'all' ? branch : '全部分支'}
            >
                <span className={styles.ellipsis}>
                    分支{branch !== 'all' ? `: ${branch}` : ''}
                </span>
                {branch !== 'all' ? (
                    <span
                        className={`codicon codicon-close branch-clear ${styles.icon} ${styles.iconMedium}`}
                        title="清除分支过滤"
                    />
                ) : (
                    <span className={`codicon codicon-chevron-down ${styles.icon} ${styles.iconSmall}`} />
                )}
            </button>

            {/* User filter */}
            <button className={styles.filterButton}>
                用户
                <span className={`codicon codicon-chevron-down ${styles.icon} ${styles.iconSmall}`} />
            </button>

            {/* Date filter */}
            <button className={styles.filterButton}>
                日期
                <span className={`codicon codicon-chevron-down ${styles.icon} ${styles.iconSmall}`} />
            </button>

            {/* Path filter */}
            <button className={styles.filterButton}>
                路径
                <span className={`codicon codicon-chevron-down ${styles.icon} ${styles.iconSmall}`} />
            </button>

            <div className={styles.separator} />

            {/* Right icons */}
            <button className={styles.iconButton} title="Intel Sort">
                <span className="codicon codicon-arrow-swap" />
            </button>
        </div>
    );
};
