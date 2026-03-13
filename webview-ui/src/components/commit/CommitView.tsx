import { useState, useCallback, useEffect, useMemo } from 'react';
import { ChangelistTree } from './ChangelistTree';
import { CommitForm } from './CommitForm';
import { RebaseForm } from './RebaseForm';
import { CommitToolbar } from './CommitToolbar';
import { useTranslation } from 'react-i18next';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useRpcData } from '../../hooks/useRpcData';
import styles from './CommitView.module.css';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import type { ChangelistGroup, BranchInfo, FileStatus, LastCommitInfo } from '@shared/messages';

interface CommitViewProps {
    rebaseStatus?: BranchInfo['rebaseStatus'];
}

function buildChangelists(files: FileStatus[]): ChangelistGroup[] {
    const conflictedFiles = files.filter(f => f.status === 'C' || f.status === 'U');
    const trackedFiles = files.filter(f => f.status !== '?' && f.status !== 'C' && f.status !== 'U');
    const untrackedFiles = files.filter(f => f.status === '?');

    const changelists: ChangelistGroup[] = [];

    if (conflictedFiles.length > 0) {
        changelists.push({
            id: 'merge-conflicts',
            name: 'Merge Conflicts',
            isDefault: false,
            items: conflictedFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
        });
    }

    if (trackedFiles.length > 0) {
        changelists.push({
            id: 'default',
            name: 'Default Changelist',
            isDefault: true,
            items: trackedFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
        });
    }

    if (untrackedFiles.length > 0) {
        changelists.push({
            id: 'unversioned',
            name: 'Unversioned Files',
            isDefault: false,
            items: untrackedFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
        });
    }

    if (changelists.length === 0) {
        changelists.push({
            id: 'default',
            name: 'Default Changelist',
            isDefault: true,
            items: []
        });
    }

    return changelists;
}

export function CommitView({ rebaseStatus }: CommitViewProps) {
    const { t } = useTranslation();

    // Data State
    const { data: files, loading } = useRpcData(() => rpc.getStatus(), {
        initialValue: [] as FileStatus[],
        cacheKey: 'commit.files'
    });
    const changelists = useMemo(() => buildChangelists(files), [files]);
    const [activeFile, setActiveFile] = useState<string | null>(null);

    // Persisted UI State
    const [viewMode, setViewMode] = usePersistedState('commit.viewMode');
    const [selectedFiles, setSelectedFiles] = usePersistedState('commit.selectedFiles');
    const [expandedIds, setExpandedIds] = usePersistedState('commit.expandedIds');
    const [commitMessage, setCommitMessage] = usePersistedState('commit.message');
    const [amend, setAmend] = usePersistedState('commit.amend');

    const { data: workspaceRoot } = useRpcData(() => rpc.getWorkspaceRoot(), {
        initialValue: ''
    });

    // Active file subscription
    useEffect(() => {
        const unsubActiveFile = rpcEvents.activeFileChange.subscribe(({ path }) => {
            setActiveFile(path);
        });
        return () => unsubActiveFile();
    }, []);

    // Last commit info for amend
    const [lastCommitInfo, setLastCommitInfo] = useState<LastCommitInfo | null>(null);
    const [savedMessage, setSavedMessage] = useState<string>('');

    useEffect(() => {
        if (amend) {
            // Save current message before replacing with last commit message
            setSavedMessage(commitMessage);
            rpc.getLastCommitInfo().then(info => {
                setLastCommitInfo(info);
                if (info) {
                    setCommitMessage(info.message);
                }
            });
        } else {
            setLastCommitInfo(null);
            // Restore saved message when un-checking amend
            if (savedMessage !== undefined) {
                setCommitMessage(savedMessage);
                setSavedMessage('');
            }
        }
    }, [amend]);

    const toggleFile = useCallback((path: string, checked: boolean) => {
        setSelectedFiles(prev => {
            const next = new Set(prev);
            if (checked) next.add(path);
            else next.delete(path);
            return next;
        });
    }, [setSelectedFiles]);

    const handleToggle = useCallback((id: string, expanded: boolean) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (expanded) next.add(id);
            else next.delete(id);
            return next;
        });
    }, [setExpandedIds]);

    // Clean up selectedFiles when files are removed from changelists
    useEffect(() => {
        const allPaths = new Set<string>();
        changelists.forEach(group => group.items.forEach(file => allPaths.add(file.path)));

        const invalidPaths = Array.from(selectedFiles).filter(path => !allPaths.has(path));
        if (invalidPaths.length > 0) {
            setSelectedFiles(prev => {
                const next = new Set(prev);
                invalidPaths.forEach(path => next.delete(path));
                return next;
            });
        }
    }, [changelists, selectedFiles, setSelectedFiles]);

    const fileStats = useMemo(() => {
        let added = 0;
        let modified = 0;
        let deleted = 0;

        changelists.forEach(group => {
            group.items.forEach(file => {
                if (selectedFiles.has(file.path)) {
                    const status = file.status.trim().toUpperCase();
                    if (status.startsWith('A') || status === '?' || status === 'U') {
                        added++;
                    } else if (status.startsWith('D')) {
                        deleted++;
                    } else {
                        modified++;
                    }
                }
            });
        });

        return { added, modified, deleted };
    }, [changelists, selectedFiles]);

    const handleCommitSuccess = useCallback(() => {
        setSavedMessage('');
        setAmend(false);
    }, [setAmend]);

    return (
        <div className={styles.commitView}>
            <CommitToolbar
                viewMode={viewMode}
                selectedFiles={selectedFiles}
                onViewModeChange={setViewMode}
                onExpandAll={() => {
                    const allIds = new Set(expandedIds);
                    changelists.forEach(g => allIds.add(`__root__${g.id}`));
                    setExpandedIds(allIds);
                }}
                onCollapseAll={() => {
                    const newIds = new Set(expandedIds);
                    changelists.forEach(g => newIds.delete(`__root__${g.id}`));
                    setExpandedIds(newIds);
                }}
            />

            <div className={styles.fileListContainer}>
                {changelists.length === 0 ? (
                    loading ? null : <div className={styles.emptyState}>{t('No changes')}</div>
                ) : (
                    <ChangelistTree
                        groups={changelists}
                        viewMode={viewMode}
                        selectedFiles={selectedFiles}
                        expandedIds={expandedIds}
                        activeFile={activeFile}
                        onToggle={handleToggle}
                        onToggleFile={toggleFile}
                        workspaceRoot={workspaceRoot}
                        amendCommit={lastCommitInfo}
                    />
                )}
            </div>

            {rebaseStatus === 'interactive' ? (
                <RebaseForm
                    message={commitMessage}
                    addedCount={fileStats.added}
                    modifiedCount={fileStats.modified}
                    deletedCount={fileStats.deleted}
                    disableContinue={changelists.some(g => g.items.some(f => f.status === 'C' || f.status === 'U'))}
                    onMessageChange={setCommitMessage}
                    onContinue={() => rpc.continueRebase({
                        message: commitMessage,
                        files: Array.from(selectedFiles)
                    })}
                />
            ) : (
                <CommitForm
                    message={commitMessage}
                    amend={amend}
                    selectedFiles={selectedFiles}
                    addedCount={fileStats.added}
                    modifiedCount={fileStats.modified}
                    deletedCount={fileStats.deleted}
                    onMessageChange={setCommitMessage}
                    onAmendChange={setAmend}
                    onCommitSuccess={handleCommitSuccess}
                />
            )}
        </div>
    );
}
