import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChangelistTree } from './ChangelistTree';
import { CommitForm } from './CommitForm';
import { RebaseForm } from './RebaseForm';
import { CommitToolbar } from './CommitToolbar';
import { useTranslation } from 'react-i18next';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useRpcData } from '../../hooks/useRpcData';
import styles from './CommitView.module.css';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import type { BranchInfo, ChangelistState, FileStatus, LastCommitInfo } from '@shared/messages';
import { buildChangelists, getFileStats, getSelectedFiles, hasTrackedChanges, INACTIVE_CHANGELIST_ID } from './changelistModel';

interface CommitViewProps {
    rebaseStatus?: BranchInfo['rebaseStatus'];
}

export function CommitView({ rebaseStatus }: CommitViewProps) {
    const { t } = useTranslation();
    const loadCommitViewState = useCallback(() => rpc.getCommitViewState(), []);
    const initialChangelistState = useMemo(() => ({
        mode: 'staged',
        activeListId: 'changes',
        lists: [
            { id: 'changes', name: t('Changes'), isDefault: true, isActive: true },
            { id: INACTIVE_CHANGELIST_ID, name: t('Inactive Changes'), isDefault: true, isActive: false }
        ],
        assignments: {}
    } as ChangelistState), [t]);

    const { data: commitViewState, loading } = useRpcData(loadCommitViewState, {
        initialValue: {
            files: [] as FileStatus[],
            changelistState: initialChangelistState,
            workspaceRoot: '',
            hasRepository: true
        },
        cacheKey: 'commit.viewState'
    });
    const files = commitViewState.files;
    const changelistState = commitViewState.changelistState;
    const workspaceRoot = commitViewState.workspaceRoot;
    const hasRepository = commitViewState.hasRepository !== false;

    const changelists = useMemo(() => buildChangelists(files, changelistState, t), [files, changelistState, t]);
    const [activeFile, setActiveFile] = useState<string | null>(null);

    const [lastCommitInfo, setLastCommitInfo] = useState<LastCommitInfo | null>(null);

    const [viewMode, setViewMode] = usePersistedState('commit.viewMode');
    const [expandedIds, setExpandedIds] = usePersistedState('commit.expandedIds');
    const [commitMessage, setCommitMessage] = usePersistedState('commit.message');
    const [amend, setAmend] = usePersistedState('commit.amend');
    const currentCommitMessageRef = useRef(commitMessage);
    const savedMessageRef = useRef<string | null>(null);
    const lastCommitInfoRequestRef = useRef(0);

    useEffect(() => {
        currentCommitMessageRef.current = commitMessage;
    }, [commitMessage]);

    useEffect(() => {
        const handleActiveFile = ({ path }: { path: string }) => {
            setActiveFile(path);
        };
        return rpcEvents.activeFileChange.subscribe(handleActiveFile);
    }, []);

    const selectedFiles = useMemo(() => getSelectedFiles(files, changelists, changelistState), [files, changelists, changelistState]);

    useEffect(() => {
        const requestId = ++lastCommitInfoRequestRef.current;

        if (amend) {
            savedMessageRef.current = currentCommitMessageRef.current;
            rpc.getLastCommitInfo().then(info => {
                if (requestId !== lastCommitInfoRequestRef.current) {
                    return;
                }
                setLastCommitInfo(info);
                if (info) {
                    setCommitMessage(info.message);
                }
            });
        } else {
            setLastCommitInfo(null);
            if (savedMessageRef.current !== null) {
                setCommitMessage(savedMessageRef.current);
                currentCommitMessageRef.current = savedMessageRef.current;
                savedMessageRef.current = null;
            }
        }
    }, [amend, setCommitMessage]);

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

    const fileStats = useMemo(() => getFileStats(changelists, selectedFiles), [changelists, selectedFiles]);

    const hasTracked = useMemo(() => hasTrackedChanges(files), [files]);

    const handleCommitSuccess = useCallback(() => {
        savedMessageRef.current = null;
        setAmend(false);
    }, [setAmend]);

    return (
        <div className={styles.commitView}>
            <CommitToolbar
                viewMode={viewMode}
                changelistState={changelistState}
                selectedFiles={selectedFiles}
                hasTrackedChanges={hasTracked}
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
                {!hasRepository ? (
                    loading ? null : <div className={styles.emptyState}>{t('No Git repository found')}</div>
                ) : changelists.length === 0 ? (
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
