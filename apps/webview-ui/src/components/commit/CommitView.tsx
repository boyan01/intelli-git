import { useState, useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { ChangelistTree } from './ChangelistTree';
import { CommitForm } from './CommitForm';
import { RebaseForm } from './RebaseForm';
import { CommitToolbar } from './CommitToolbar';
import { LoadingProgressBar } from '../common/LoadingProgressBar';
import { useTranslation } from 'react-i18next';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useRpcData } from '../../hooks/useRpcData';
import styles from './CommitView.module.css';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import type { BranchInfo, ChangelistState, FileStatus, LastCommitInfo, RepositoryCommitViewState, RepositoryFileReference } from '@shared/messages';
import type { ChangelistBackgroundContext } from '@shared/webviewContext';
import type { CommitOptions } from './CommitForm';
import {
    buildWorkspaceChangelists,
    getWorkspaceFileStats,
    getWorkspaceSelectedFiles,
    hasWorkspaceTrackedChanges,
    INACTIVE_CHANGELIST_ID,
    type WorkspaceChangelistGroup
} from './changelistModel';

interface CommitViewProps {
    rebaseStatus?: BranchInfo['rebaseStatus'];
    pushTarget?: {
        remote: string;
        branch: string;
        isConfirmed: boolean;
    };
    isPushTargetLoading?: boolean;
    commitOptions: CommitOptions;
    onReviewPushTarget?: () => void;
    onCommitOptionsChange: Dispatch<SetStateAction<CommitOptions>>;
}

function getActiveChangelistName(changelistState: ChangelistState): string | undefined {
    return changelistState.lists.find(list => list.id === changelistState.activeListId)?.name;
}

function hasDisplayableChanges(changelists: WorkspaceChangelistGroup[]): boolean {
    return changelists.some(group => group.repositories.some(repoGroup => repoGroup.group.items.length > 0));
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

export function CommitView({
    rebaseStatus,
    pushTarget,
    isPushTargetLoading = false,
    commitOptions,
    onReviewPushTarget,
    onCommitOptionsChange
}: CommitViewProps) {
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
            hasRepository: true,
            repositories: [] as RepositoryCommitViewState[]
        },
        loadingOnRefresh: true
    });
    const files = commitViewState.files;
    const changelistState = commitViewState.changelistState;
    const workspaceRoot = commitViewState.workspaceRoot;
    const hasRepository = commitViewState.hasRepository !== false;
    const repositoryStates = useMemo(() => {
        if (commitViewState.repositories && commitViewState.repositories.length > 0) {
            return commitViewState.repositories;
        }

        if (!workspaceRoot) {
            return [] as RepositoryCommitViewState[];
        }

        return [{
            repository: commitViewState.activeRepository || {
                name: workspaceRoot.split('/').pop() || workspaceRoot,
                path: workspaceRoot,
                repoPath: workspaceRoot,
                workspaceRoot,
                gitRoot: workspaceRoot,
                isSubmodule: false,
                kind: 'workspace'
            },
            files,
            changelistState,
            workspaceRoot
        }] as RepositoryCommitViewState[];
    }, [commitViewState.repositories, commitViewState.activeRepository, files, changelistState, workspaceRoot]);

    const changelists = useMemo(() => buildWorkspaceChangelists(repositoryStates, t), [repositoryStates, t]);
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

    const selectedFileMap = useMemo(() => getWorkspaceSelectedFiles(changelists, changelistState), [changelists, changelistState]);
    const selectedFiles = useMemo(() => new Set(selectedFileMap.keys()), [selectedFileMap]);
    const selectedFileRefs = useMemo(() => Array.from(selectedFileMap.values()).map(file => ({
        repoPath: file.repoPath,
        path: file.path
    } satisfies RepositoryFileReference)), [selectedFileMap]);

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

    const fileStats = useMemo(() => getWorkspaceFileStats(changelists, selectedFileMap), [changelists, selectedFileMap]);

    const hasTracked = useMemo(() => hasWorkspaceTrackedChanges(repositoryStates), [repositoryStates]);
    const hasChanges = useMemo(() => hasDisplayableChanges(changelists), [changelists]);
    const changedRepositoryCount = useMemo(() => {
        const repoPaths = new Set<string>();
        changelists.forEach(group => {
            group.repositories.forEach(repoGroup => {
                if (repoGroup.group.items.length > 0) {
                    repoPaths.add(repoGroup.repository.repoPath);
                }
            });
        });
        return repoPaths.size;
    }, [changelists]);
    const activeChangelistName = useMemo(() => getActiveChangelistName(changelistState), [changelistState]);

    const handleCommitSuccess = useCallback(() => {
        savedMessageRef.current = null;
        setAmend(false);
    }, [setAmend]);

    const handleOpenFolder = useCallback(() => {
        void rpc.openFolder();
    }, []);

    const handleInitializeRepository = useCallback(async () => {
        await rpc.initializeRepository();
        await reload();
    }, [reload]);

    const handleConfigureAIProvider = useCallback(() => {
        void rpc.configureAIProvider();
    }, []);

    const isInitialCommitViewLoading = loading && hasRepository && files.length === 0 && !workspaceRoot && !error;
    const loadingIndicator = <LoadingProgressBar active={loading} ariaLabel={t('Loading...')} />;

    const renderStatePanel = () => {
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
                    description={t('Open a folder that contains a Git repository, or initialize one in the current workspace.')}
                    actions={[
                        {
                            label: t('Open Folder'),
                            icon: 'codicon-folder-opened',
                            onClick: handleOpenFolder
                        },
                        {
                            label: t('Initialize Repository'),
                            icon: 'codicon-repo-create',
                            onClick: handleInitializeRepository
                        },
                        {
                            label: t('Configure AI Provider'),
                            icon: 'codicon-sparkle',
                            onClick: handleConfigureAIProvider
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
                />
            );
        }

        return null;
    };

    const statePanel = renderStatePanel();
    if (!hasRepository) {
        return (
            <div className={styles.commitView}>
                {loadingIndicator}
                <div className={styles.fileListContainer}>
                    {statePanel}
                </div>
            </div>
        );
    }

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
                selectedFiles={selectedFileRefs}
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

            {loadingIndicator}

            <div
                className={styles.fileListContainer}
                {...(backgroundContext ? { 'data-vscode-context': JSON.stringify(backgroundContext) } : {})}
            >
                {isInitialCommitViewLoading ? null : statePanel || (
                    <ChangelistTree
                        groups={changelists}
                        changelistState={changelistState}
                        viewMode={viewMode}
                        selectedFiles={selectedFiles}
                        expandedIds={expandedIds}
                        activeFile={activeFile}
                        onToggle={handleToggle}
                        workspaceRoot={workspaceRoot}
                        showRepositoryRoots={changedRepositoryCount > 1}
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
                        files: selectedFileRefs.map(file => file.path)
                    })}
                />
            ) : (
                <CommitForm
                    message={commitMessage}
                    amend={amend}
                    selectedFiles={selectedFileRefs}
                    repositories={repositoryStates.map(state => state.repository)}
                    addedCount={fileStats.added}
                    modifiedCount={fileStats.modified}
                    deletedCount={fileStats.deleted}
                    pushTarget={pushTarget}
                    isPushTargetLoading={isPushTargetLoading}
                    options={commitOptions}
                    onReviewPushTarget={onReviewPushTarget}
                    onMessageChange={setCommitMessage}
                    onAmendChange={setAmend}
                    onOptionsChange={onCommitOptionsChange}
                    onCommitSuccess={handleCommitSuccess}
                />
            )}
        </div>
    );
}
