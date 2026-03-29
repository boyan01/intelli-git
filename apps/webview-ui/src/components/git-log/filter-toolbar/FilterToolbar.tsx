import React, { useEffect, useRef } from 'react';
import type { LogOptions } from '@shared/messages';
import { rpc } from '../../../lib/rpc_client';
import styles from './FilterToolbar.module.css';
import { DateFilter } from './DateFilter';
import { UserFilter } from './UserFilter';
import { logger } from '@/lib/log';
import { useTranslation } from 'react-i18next';
import { usePersistedState } from '../../../hooks/usePersistedState';

interface FilterToolbarProps {
    onFilterChange: (options: Partial<LogOptions>) => void;
    externalBranch?: string;
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({ onFilterChange, externalBranch }) => {
    const { t } = useTranslation();
    const [branch, setBranch] = usePersistedState('gitLog.filter.branch');
    const [search, setSearch] = usePersistedState('gitLog.filter.search');
    const [regexMode, setRegexMode] = usePersistedState('gitLog.filter.regexMode');
    const [caseSensitive, setCaseSensitive] = usePersistedState('gitLog.filter.caseSensitive');
    const [authors, setAuthors] = usePersistedState('gitLog.filter.authors');
    const [paths, setPaths] = usePersistedState('gitLog.filter.paths');
    const [since, setSince] = usePersistedState('gitLog.filter.since');
    const [until, setUntil] = usePersistedState('gitLog.filter.until');

    // Sync external branch
    useEffect(() => {
        if (externalBranch !== undefined) {
            setBranch(externalBranch);
        }
    }, [externalBranch, setBranch]);


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
        logger.info('picked paths:', picked);
        if (picked !== undefined) {
            setPaths(picked);
        }
    };

    const getPathLabel = () => {
        if (paths.length === 0) return t('Paths');
        if (paths.length === 1) {
            const name = paths[0].split('/').pop() || paths[0];
            return `${t('Path')}: ${name}`;
        }
        return `${t('Paths')}: ${paths.length}`;
    };

    return (
        <div className={styles.container}>
            {/* Search box */}
            <div className={styles.searchBox}>
                <span className={`${styles.searchIcon} codicon codicon-search`} />
                <input
                    className={styles.searchInput}
                    placeholder={t('Text or Hash')}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                <button
                    className={`${styles.inlineToggle} ${regexMode ? styles.active : ''}`}
                    onClick={() => setRegexMode(!regexMode)}
                    title={t('Regex')}
                >
                    .*
                </button>
                <button
                    className={`${styles.inlineToggle} ${caseSensitive ? styles.active : ''}`}
                    onClick={() => setCaseSensitive(!caseSensitive)}
                    title={t('Match Case')}
                >
                    Cc
                </button>
            </div>

            <div className={styles.separator} />

            {/* Branch filter */}
            <button
                className={`${styles.filterButton} ${styles.branchButton}`}
                onClick={handleBranchClick}
                title={branch !== 'all' ? branch : t('All Branches')}
            >
                <span className={styles.ellipsis}>
                    {branch !== 'all' ? `${t('Branch')}: ${branch}` : t('Branch')}
                </span>
                {branch !== 'all' ? (
                    <span
                        className={`codicon codicon-close branch-clear ${styles.icon} ${styles.iconMedium}`}
                        title={t('Clear branch filter')}
                    />
                ) : (
                    <span className={`codicon codicon-chevron-down ${styles.icon} ${styles.iconSmall}`} />
                )}
            </button>

            {/* User filter */}
            <UserFilter onChange={authors => setAuthors(authors ?? [])} initialAuthors={authors} />

            <DateFilter onChange={handleDateChange} initialSince={since} initialUntil={until} />

            {/* Path filter */}
            <button
                className={`${styles.filterButton} ${styles.pathButton}`}
                onClick={handlePathClick}
                title={paths.length > 0 ? paths.join('\n') : t('Select files or folders')}
            >
                <span className={styles.ellipsis}>
                    {getPathLabel()}
                </span>
                {paths.length > 0 ? (
                    <span
                        className={`codicon codicon-close path-clear ${styles.icon} ${styles.iconMedium}`}
                        title={t('Clear path filter')}
                    />
                ) : (
                    <span className={`codicon codicon-chevron-down ${styles.icon} ${styles.iconSmall}`} />
                )}
            </button>
        </div>
    );
};
