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
import type { BranchInfo, ChangelistGroup, ChangelistState, FileStatus, LastCommitInfo } from '@shared/messages';
import type { ChangelistBackgroundContext } from '@shared/webviewContext';
import { buildChangelists, getFileStats, getSelectedFiles, hasTrackedChanges, INACTIVE_CHANGELIST_ID } from './changelistModel';

interface CommitViewProps {
    rebaseStatus?: BranchInfo['rebaseStatus'];
}

function getActiveChangelistName(changelistState: ChangelistState): string | undefined {
    return changelistState.lists.find(list => list.id === changelistState.activeListId)?.name;
}

function hasDisplayableChanges(changelists: ChangelistGroup[]): boolean {
    return changelists.some(group => group.items.length > 0);
}

interface EmptyAction {
    label: string;
    icon: string;
    onClick: () => void;
    disabled?: boolean;
}

interface CommitViewStatePanelProps {
    icon: string;
    title: string;
    description?: string;
    detail?: string;
    actions?: EmptyAction[];
}

function CommitViewStatePanel({ icon, title, description, detail, actions = [] }: CommitViewStatePanelProps) {
    return (
        <div className={styles.statePanel}>
            <i className={`codicon ${icon} ${styles.stateIcon}`} aria-hidden="true"></i>
            <div className={styles.stateTitle}>{title}</div>
            {description && <div className={styles.stateDescription}>{description}</div>}
            {detail && <div className={styles.stateDetail}>{detail}</div>}
            {actions.length > 0 && (
                <div className={styles.stateActions}>
                    {actions.map(action => (
                        <button
                            key={action.label}
                            className={styles.stateButton}
                            type="button"
                            onClick={action.onClick}
                            disabled={action.disabled}
                        >
                            <i className={`codicon ${action.icon}`} aria-hidden="true"></i>
                            <span>{action.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
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

    const { data: commitViewState, loading, error, reload } = useRpcData(loadCommitViewState, {
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
    const [fetching, setFetching] = useState(false);
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
    const hasChanges = useMemo(() => hasDisplayableChanges(changelists), [changelists]);
    const activeChangelistName = useMemo(() => getActiveChangelistName(changelistState), [changelistState]);

    const handleCommitSuccess = useCallback(() => {
        savedMessageRef.current = null;
        setAmend(false);
    }, [setAmend]);

    const handleFetch = useCallback(async () => {
        if (fetching) {
            return;
        }

        setFetching(true);
        try {
            await rpc.fetch();
            rpcEvents.refresh.emit();
        } catch (fetchError) {
            await rpc.showErrorMessage(String(fetchError));
        } finally {
            setFetching(false);
        }
    }, [fetching]);

    const renderStatePanel = () => {
        if (loading && files.length === 0 && !workspaceRoot && !error) {
            return (
                <CommitViewStatePanel
                    icon="codicon-loading codicon-modifier-spin"
                    title={t('Loading...')}
                />
            );
        }

        if (error) {
            return (
                <CommitViewStatePanel
                    icon="codicon-error"
                    title={t('Unable to load changes')}
                    description={error.message}
                    actions={[
                        {
                            label: t('Try Again'),
                            icon: 'codicon-refresh',
                            onClick: reload
                        }
                    ]}
                />
            );
        }

        if (!hasRepository) {
            return (
                <CommitViewStatePanel
                    icon="codicon-source-control"
                    title={t('No Git repository found')}
                    description={t('Open a folder or initialize a repository to start using Intelli Git.')}
                    actions={[
                        {
                            label: t('Open Folder'),
                            icon: 'codicon-folder-opened',
                            onClick: () => void rpc.openFolder()
                        },
                        {
                            label: t('Initialize Repository'),
                            icon: 'codicon-repo-create',
                            onClick: () => void rpc.initializeRepository()
                        }
                    ]}
                />
            );
        }

        if (!hasChanges) {
            return (
                <CommitViewStatePanel
                    icon="codicon-check"
                    title={t('Working tree clean')}
                    description={changelistState.mode === 'changes' && activeChangelistName
                        ? t('No commit-ready changes in {{name}}.', { name: activeChangelistName })
                        : t('No staged or unstaged changes in this repository.')}
                    detail={changelistState.mode === 'changes' && activeChangelistName
                        ? t('Active changelist: {{name}}', { name: activeChangelistName })
                        : undefined}
                    actions={[
                        {
                            label: fetching ? t('Fetching...') : t('Fetch'),
                            icon: fetching ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh',
                            onClick: handleFetch,
                            disabled: fetching
                        },
                        {
                            label: t('Open Git Log'),
                            icon: 'codicon-git-commit',
                            onClick: () => void rpc.focusGitLog()
                        },
                        {
                            label: t('Switch Repository...'),
                            icon: 'codicon-repo',
                            onClick: () => void rpc.switchRepository()
                        }
                    ]}
                />
            );
        }

        return null;
    };

    const statePanel = renderStatePanel();
    const backgroundContext: ChangelistBackgroundContext | undefined = hasRepository
        ? {
            webviewSection: 'changelistBackground',
            changelistMode: changelistState.mode,
            preventDefaultContextMenuItems: true
        }
        : undefined;

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

            <div
                className={styles.fileListContainer}
                {...(backgroundContext ? { 'data-vscode-context': JSON.stringify(backgroundContext) } : {})}
            >
                {statePanel || (
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
