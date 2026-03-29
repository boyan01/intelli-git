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

function buildChangelists(files: FileStatus[], t: (key: string) => string): ChangelistGroup[] {
    const stagedFiles: FileStatus[] = [];
    const conflictedFiles: FileStatus[] = [];
    const changesFiles: FileStatus[] = [];
    const untrackedFiles: FileStatus[] = [];
    const inactiveFiles: FileStatus[] = [];

    files.forEach(f => {
        const hasActiveHunks = !f.hunks || f.hunks.some(h => !f.inactiveHunkIds?.includes(h.id));
        const hasInactiveHunks = f.inactive || (f.inactiveHunkIds && f.inactiveHunkIds.length > 0);

        // Files with inactive content always go to Inactive group
        if (hasInactiveHunks) {
            inactiveFiles.push(f);
        }

        // Files with active content go to their respective functional groups
        if (hasActiveHunks) {
            if (f.status === 'C' || f.status === 'U') {
                conflictedFiles.push(f);
            } else if (f.staged) {
                stagedFiles.push(f);
            } else if (f.status === '?') {
                untrackedFiles.push(f);
            } else {
                changesFiles.push(f);
            }
        }
    });

    const changelists: ChangelistGroup[] = [];

    const mapItems = (items: FileStatus[]) => items.map(f => ({
        path: f.path,
        status: f.status,
        staged: f.staged,
        inactive: f.inactive,
        inactiveHunkIds: f.inactiveHunkIds,
        resolvedCandidate: f.resolvedCandidate,
        hunks: f.hunks,
        hasStagedInactive: f.hasStagedInactive
    }));

    if (stagedFiles.length > 0) {
        changelists.push({
            id: 'staged-changes',
            name: t('Staged Changes'),
            isDefault: false,
            items: mapItems(stagedFiles)
        });
    }

    if (conflictedFiles.length > 0) {
        changelists.push({
            id: 'conflicting-changes',
            name: t('Conflicting Changes'),
            isDefault: false,
            items: mapItems(conflictedFiles)
        });
    }

    if (changesFiles.length > 0) {
        changelists.push({
            id: 'changes',
            name: t('Changes'),
            isDefault: false,
            items: mapItems(changesFiles)
        });
    }

    if (untrackedFiles.length > 0) {
        changelists.push({
            id: 'untracked-changes',
            name: t('Untracked Changes'),
            isDefault: false,
            items: mapItems(untrackedFiles)
        });
    }

    if (inactiveFiles.length > 0) {
        const hasWarning = inactiveFiles.some(f => f.hasStagedInactive);
        changelists.push({
            id: 'inactive-changes',
            name: t('Inactive Changes'),
            isDefault: false,
            items: mapItems(inactiveFiles),
            hasWarning: hasWarning
        });
    }

    if (changelists.length === 0) {
        changelists.push({
            id: 'changes',
            name: t('Changes'),
            isDefault: true,
            items: []
        });
    }

    return changelists;
}

export function CommitView({ rebaseStatus }: CommitViewProps) {
    const { t } = useTranslation();
    const loadStatus = useCallback(() => rpc.getStatus(), []);
    const loadWorkspaceRoot = useCallback(() => rpc.getWorkspaceRoot(), []);

    // Data State
    const { data: files, loading } = useRpcData(loadStatus, {
        initialValue: [] as FileStatus[],
        cacheKey: 'commit.files'
    });
    const changelists = useMemo(() => buildChangelists(files, t), [files, t]);
    const [activeFile, setActiveFile] = useState<string | null>(null);

    // State for amend (Must be declared before hooks that use them)
    const [lastCommitInfo, setLastCommitInfo] = useState<LastCommitInfo | null>(null);
    const [savedMessage, setSavedMessage] = useState<string>('');

    // Persisted UI State
    const [viewMode, setViewMode] = usePersistedState('commit.viewMode');
    const [selectedFiles, setSelectedFiles] = usePersistedState('commit.selectedFiles');
    const [expandedIds, setExpandedIds] = usePersistedState('commit.expandedIds');
    const [commitMessage, setCommitMessage] = usePersistedState('commit.message');
    const [amend, setAmend] = usePersistedState('commit.amend');

    const { data: workspaceRoot } = useRpcData(loadWorkspaceRoot, {
        initialValue: ''
    });

    // Active file subscription
    useEffect(() => {
        const unsubActiveFile = rpcEvents.activeFileChange.subscribe(({ path }) => {
            setActiveFile(path);
        });
        return () => unsubActiveFile();
    }, []);

    // Sync selectedFiles with staged files in staging mode
    useEffect(() => {
        const stagedPaths = new Set(
            files.filter(f => f.staged && !f.inactive).map(f => f.path)
        );
        setSelectedFiles(stagedPaths);
    }, [files, setSelectedFiles]);

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
            if (savedMessage) {
                setCommitMessage(savedMessage);
                setSavedMessage('');
            }
        }
    }, [amend, commitMessage, savedMessage, setCommitMessage]);

    const handleToggle = useCallback((id: string, expanded: boolean) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (expanded) next.add(id);
            else next.delete(id);
            return next;
        });
    }, [setExpandedIds]);

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

    const hasTrackedChanges = useMemo(() => {
        return files.some(file => !file.staged && !file.inactive && file.status !== '?' && file.status !== 'C' && file.status !== 'U');
    }, [files]);

    const handleCommitSuccess = useCallback(() => {
        setSavedMessage('');
        setAmend(false);
    }, [setAmend]);

    return (
        <div className={styles.commitView}>
            <CommitToolbar
                viewMode={viewMode}
                selectedFiles={selectedFiles}
                hasTrackedChanges={hasTrackedChanges}
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
                        workspaceRoot={workspaceRoot}
                        amendCommit={lastCommitInfo}
                    />
                )}
            </div>

            {rebaseStatus && rebaseStatus !== 'none' ? (
                <RebaseForm
                    mode={rebaseStatus}
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
