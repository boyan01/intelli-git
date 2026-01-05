import React, { useState, useEffect, useRef } from 'react';
import type { LogOptions } from '../../../../../shared/messages';
import { rpc } from '../../../lib/rpc_client';
import styles from './FilterToolbar.module.css';
import { DateFilter } from './DateFilter';
import { UserFilter } from './UserFilter';
import { logger } from '@/lib/log';

interface FilterToolbarProps {
    onFilterChange: (options: Partial<LogOptions>) => void;
    externalBranch?: string;
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({ onFilterChange, externalBranch }) => {
    const [branch, setBranch] = useState('all');
    const [search, setSearch] = useState('');
    const [regexMode, setRegexMode] = useState(false);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [authors, setAuthors] = useState<string[]>([]);
    const [paths, setPaths] = useState<string[]>([]);
    const [since, setSince] = useState<string | undefined>();
    const [until, setUntil] = useState<string | undefined>();

    // Sync external branch
    useEffect(() => {
        if (externalBranch !== undefined) {
            setBranch(externalBranch);
        }
    }, [externalBranch]);


    const isInitialMount = useRef(true);
    useEffect(() => {
        const delay = isInitialMount.current ? 0 : 300;
        isInitialMount.current = false;

        const timer = setTimeout(() => {
            onFilterChange({
                branch: branch === 'all' ? undefined : branch,
                search: search || undefined,
                regexMode: regexMode || undefined,
                caseSensitive: caseSensitive || undefined,
                authors: authors.length > 0 ? authors : undefined,
                paths: paths.length > 0 ? paths : undefined,
                since,
                until
            });
        }, delay);
        return () => clearTimeout(timer);
    }, [branch, search, regexMode, caseSensitive, authors, paths, since, until, onFilterChange]);

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

    const handleDateChange = (dates: { since?: string; until?: string }) => {
        setSince(dates.since);
        setUntil(dates.until);
    };

    const handlePathClick = async (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.path-clear')) {
            e.stopPropagation();
            setPaths([]);
            return;
        }
        const picked = await rpc.pickPaths();
        logger.log('picked paths:', picked);
        if (picked !== undefined) {
            setPaths(picked);
        }
    };

    const getPathLabel = () => {
        if (paths.length === 0) return '路径';
        if (paths.length === 1) {
            const name = paths[0].split('/').pop() || paths[0];
            return `路径: ${name}`;
        }
        return `路径: ${paths.length} 个`;
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
            <UserFilter onChange={authors => setAuthors(authors ?? [])} />

            <DateFilter onChange={handleDateChange} />

            {/* Path filter */}
            <button
                className={`${styles.filterButton} ${styles.pathButton}`}
                onClick={handlePathClick}
                title={paths.length > 0 ? paths.join('\n') : '选择文件或文件夹'}
            >
                <span className={styles.ellipsis}>
                    {getPathLabel()}
                </span>
                {paths.length > 0 ? (
                    <span
                        className={`codicon codicon-close path-clear ${styles.icon} ${styles.iconMedium}`}
                        title="清除路径过滤"
                    />
                ) : (
                    <span className={`codicon codicon-chevron-down ${styles.icon} ${styles.iconSmall}`} />
                )}
            </button>
        </div>
    );
};
