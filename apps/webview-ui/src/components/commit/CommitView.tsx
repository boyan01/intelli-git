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
import type { BranchInfo, ChangelistAssignment, ChangelistGroup, ChangelistState, FileStatus, GitHunk, LastCommitInfo } from '@shared/messages';

interface CommitViewProps {
    rebaseStatus?: BranchInfo['rebaseStatus'];
}

type LogicalFile = {
    path: string;
    status: FileStatus['status'];
    entries: FileStatus[];
    hunks: GitHunk[];
    inactive: boolean;
    inactiveHunkIds: string[];
    resolvedCandidate?: boolean;
    error?: boolean;
    hasStagedInactive?: boolean;
};

function getLogicalStatus(entries: FileStatus[]): FileStatus['status'] {
    if (entries.some(entry => entry.status === 'C' || entry.status === 'U')) {
        return 'C';
    }
    if (entries.some(entry => entry.status === '?')) {
        return '?';
    }
    if (entries.some(entry => entry.status === 'D')) {
        return 'D';
    }
    if (entries.some(entry => entry.status === 'A')) {
        return 'A';
    }
    return entries[0]?.status || 'M';
}

function buildLogicalFiles(files: FileStatus[]): LogicalFile[] {
    const grouped = new Map<string, FileStatus[]>();
    files.forEach(file => {
        const entries = grouped.get(file.path) || [];
        entries.push(file);
        grouped.set(file.path, entries);
    });

    return Array.from(grouped.entries()).map(([path, entries]) => {
        const hunks = Array.from(new Map(
            entries.flatMap(entry => (entry.hunks || []).map(hunk => [hunk.id, hunk]))
        ).values());
        const inactiveHunkIds = Array.from(new Set(entries.flatMap(entry => entry.inactiveHunkIds || [])));

        return {
            path,
            status: getLogicalStatus(entries),
            entries,
            hunks,
            inactive: entries.some(entry => entry.inactive),
            inactiveHunkIds,
            resolvedCandidate: entries.some(entry => entry.resolvedCandidate),
            error: entries.some(entry => entry.error),
            hasStagedInactive: entries.some(entry => entry.hasStagedInactive)
        };
    });
}

function toDisplayFile(file: LogicalFile, hunks?: GitHunk[]): FileStatus {
    return {
        path: file.path,
        status: file.status,
        staged: false,
        inactive: file.inactive,
        hunks,
        inactiveHunkIds: file.inactiveHunkIds,
        resolvedCandidate: file.resolvedCandidate,
        error: file.error,
        hasStagedInactive: file.hasStagedInactive
    };
}

function buildChangelists(files: FileStatus[], changelistState: ChangelistState, t: (key: string) => string): ChangelistGroup[] {
    const logicalFiles = buildLogicalFiles(files);
    const changelistGroups = new Map<string, FileStatus[]>();
    changelistState.lists.forEach(list => changelistGroups.set(list.id, []));

    const inactiveFiles: FileStatus[] = [];
    const untrackedFiles: FileStatus[] = [];

    logicalFiles.forEach(file => {
        if (file.status === '?') {
            untrackedFiles.push(toDisplayFile(file));
            return;
        }

        if (file.inactive) {
            inactiveFiles.push(toDisplayFile(file));
            return;
        }

        const assignment: ChangelistAssignment | undefined = changelistState.assignments[file.path];
        const activeHunks = file.hunks.filter(hunk => !file.inactiveHunkIds.includes(hunk.id));

        if (activeHunks.length > 0) {
            const hunksByList = new Map<string, GitHunk[]>();

            activeHunks.forEach(hunk => {
                const listId = assignment?.hunkListIds?.[hunk.id] || changelistState.activeListId;
                const group = hunksByList.get(listId) || [];
                group.push(hunk);
                hunksByList.set(listId, group);
            });

            hunksByList.forEach((hunks, listId) => {
                const group = changelistGroups.get(listId);
                if (group) {
                    group.push(toDisplayFile(file, hunks));
                }
            });
            return;
        }

        const listId = assignment?.fileListId || changelistState.activeListId;
        const group = changelistGroups.get(listId);
        if (group) {
            group.push(toDisplayFile(file));
        }
    });

    const result: ChangelistGroup[] = [];

    if (changelistState.mode === 'staged') {
        const stagedFiles = files.filter(file => file.staged && !file.inactive && file.status !== '?');
        const changesFiles = files.filter(file => !file.staged && !file.inactive && file.status !== '?');

        if (stagedFiles.length > 0) {
            result.push({
                id: 'staged-changes',
                name: t('Staged Changes'),
                isDefault: false,
                isActive: false,
                items: stagedFiles
            });
        }

        if (changesFiles.length > 0) {
            result.push({
                id: 'changes',
                name: t('Changes'),
                isDefault: true,
                isActive: true,
                items: changesFiles
            });
        }
    } else {
        changelistState.lists.forEach(list => {
            result.push({
                id: list.id,
                name: list.name,
                isDefault: list.isDefault,
                isActive: list.isActive,
                items: changelistGroups.get(list.id) || []
            });
        });
    }

    if (untrackedFiles.length > 0) {
        result.push({
            id: 'untracked-changes',
            name: t('Untracked Changes'),
            isDefault: false,
            isActive: false,
            items: untrackedFiles
        });
    }

    if (inactiveFiles.length > 0) {
        result.push({
            id: 'inactive-changes',
            name: t('Inactive Changes'),
            isDefault: false,
            isActive: false,
            items: inactiveFiles,
            hasWarning: inactiveFiles.some(file => file.hasStagedInactive)
        });
    }

    return result;
}

export function CommitView({ rebaseStatus }: CommitViewProps) {
    const { t } = useTranslation();
    const loadStatus = useCallback(() => rpc.getStatus(), []);
    const loadChangelistState = useCallback(() => rpc.getChangelistState(), []);
    const loadWorkspaceRoot = useCallback(() => rpc.getWorkspaceRoot(), []);

    const { data: files, loading } = useRpcData(loadStatus, {
        initialValue: [] as FileStatus[],
        cacheKey: 'commit.files'
    });
    const { data: changelistState } = useRpcData(loadChangelistState, {
        initialValue: {
            mode: 'staged',
            activeListId: 'changes',
            lists: [{ id: 'changes', name: t('Changes'), isDefault: true, isActive: true }],
            assignments: {}
        } as ChangelistState
    });

    const changelists = useMemo(() => buildChangelists(files, changelistState, t), [files, changelistState, t]);
    const [activeFile, setActiveFile] = useState<string | null>(null);

    const [lastCommitInfo, setLastCommitInfo] = useState<LastCommitInfo | null>(null);
    const [savedMessage, setSavedMessage] = useState<string>('');

    const [viewMode, setViewMode] = usePersistedState('commit.viewMode');
    const [expandedIds, setExpandedIds] = usePersistedState('commit.expandedIds');
    const [commitMessage, setCommitMessage] = usePersistedState('commit.message');
    const [amend, setAmend] = usePersistedState('commit.amend');

    const { data: workspaceRoot } = useRpcData(loadWorkspaceRoot, {
        initialValue: ''
    });

    useEffect(() => {
        const handleActiveFile = ({ path }: { path: string }) => {
            setActiveFile(path);
        };
        return rpcEvents.activeFileChange.subscribe(handleActiveFile);
    }, []);

    const selectedFiles = useMemo(() => {
        if (changelistState.mode === 'staged') {
            return new Set(files.filter(file => file.staged && !file.inactive).map(file => file.path));
        }

        const activeGroup = changelists.find(group => group.isActive);
        return new Set(activeGroup?.items.filter(file => file.status !== '?').map(file => file.path) || []);
    }, [changelistState.mode, changelists, files]);

    useEffect(() => {
        if (amend) {
            setSavedMessage(commitMessage);
            rpc.getLastCommitInfo().then(info => {
                setLastCommitInfo(info);
                if (info) {
                    setCommitMessage(info.message);
                }
            });
        } else {
            setLastCommitInfo(null);
            if (savedMessage) {
                setCommitMessage(savedMessage);
                setSavedMessage('');
            }
        }
    }, [amend, commitMessage, savedMessage, setCommitMessage]);

    const handleToggle = useCallback((id: string, expanded: boolean) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (expanded) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }, [setExpandedIds]);

    const fileStats = useMemo(() => {
        let added = 0;
        let modified = 0;
        let deleted = 0;

        changelists.forEach(group => {
            group.items.forEach(file => {
                if (!selectedFiles.has(file.path)) {
                    return;
                }

                const status = file.status.trim().toUpperCase();
                if (status.startsWith('A') || status === '?' || status === 'U') {
                    added++;
                } else if (status.startsWith('D')) {
                    deleted++;
                } else {
                    modified++;
                }
            });
        });

        return { added, modified, deleted };
    }, [changelists, selectedFiles]);

    const hasTrackedChanges = useMemo(() => {
        return files.some(file => !file.inactive && file.status !== '?' && file.status !== 'C' && file.status !== 'U' && !file.staged);
    }, [files]);

    const handleCommitSuccess = useCallback(() => {
        setSavedMessage('');
        setAmend(false);
    }, [setAmend]);

    return (
        <div className={styles.commitView}>
            <CommitToolbar
                viewMode={viewMode}
                changelistState={changelistState}
                selectedFiles={selectedFiles}
                hasTrackedChanges={hasTrackedChanges}
                onViewModeChange={setViewMode}
                onExpandAll={() => {
                    const allIds = new Set(expandedIds);
                    changelists.forEach(group => allIds.add(`__root__${group.id}`));
                    setExpandedIds(allIds);
                }}
                onCollapseAll={() => {
                    const nextIds = new Set(expandedIds);
                    changelists.forEach(group => nextIds.delete(`__root__${group.id}`));
                    setExpandedIds(nextIds);
                }}
            />

            <div className={styles.fileListContainer}>
                {changelists.length === 0 ? (
                    loading ? null : <div className={styles.emptyState}>{t('No changes')}</div>
                ) : (
                    <ChangelistTree
                        groups={changelists}
                        changelistState={changelistState}
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
                    disableContinue={changelists.some(group => group.items.some(file => file.status === 'C' || file.status === 'U'))}
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
