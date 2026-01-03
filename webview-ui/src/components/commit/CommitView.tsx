import { useState, useCallback, useEffect, useMemo } from 'react';
import { ChangelistTree } from '../file-tree/ChangelistTree';
import { CommitForm } from './CommitForm';
import { RebaseForm } from './RebaseForm';
import { CommitToolbar } from './CommitToolbar';
import { useTranslation } from 'react-i18next';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useRpcData } from '../../hooks/useRpcData';
import styles from './CommitView.module.css';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import type { ChangelistGroup, BranchInfo } from '@shared/messages';

interface CommitViewProps {
    rebaseStatus?: BranchInfo['rebaseStatus'];
}

export function CommitView({ rebaseStatus }: CommitViewProps) {
    const { t } = useTranslation();

    // Data State
    const { data: changelists, loading } = useRpcData(() => rpc.getChangelists(), { initialValue: [] as ChangelistGroup[] });
    const [activeFile, setActiveFile] = useState<string | null>(null);

    // Persisted UI State
    const [viewMode, setViewMode] = usePersistedState('commit.viewMode');
    const [selectedFiles, setSelectedFiles] = usePersistedState('commit.selectedFiles');
    const [collapsedGroups, setCollapsedGroups] = usePersistedState('commit.collapsedGroups');
    const [commitMessage, setCommitMessage] = usePersistedState('commit.message');
    const [amend, setAmend] = usePersistedState('commit.amend');

    // Non-persisted state
    const [isGenerating, setIsGenerating] = useState(false);

    // Active file subscription
    useEffect(() => {
        const unsubActiveFile = rpcEvents.activeFileChange.subscribe(({ path }) => {
            setActiveFile(path);
        });
        return () => unsubActiveFile();
    }, []);

    const toggleFile = useCallback((path: string, checked: boolean) => {
        setSelectedFiles(prev => {
            const next = new Set(prev);
            if (checked) next.add(path);
            else next.delete(path);
            return next;
        });
    }, [setSelectedFiles]);

    const toggleGroupCollapse = useCallback((groupId: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
        });
    }, [setCollapsedGroups]);

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

    const handleCommit = async (push: boolean) => {
        const files = Array.from(selectedFiles);
        if (files.length === 0 && !amend) {
            return;
        }
        try {
            await rpc.commit({
                message: commitMessage,
                files: files,
                amend: amend,
                push: push
            });
            setCommitMessage('');
        } catch (e) {
            console.error('Commit failed:', e);
        }
    };

    const handleGenerateMessage = async () => {
        setIsGenerating(true);
        try {
            const message = await rpc.generateCommitMessage(Array.from(selectedFiles));
            setCommitMessage(message);
        } catch (e) {
            console.error('Failed to generate message', e);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className={styles.commitView}>
            <CommitToolbar
                viewMode={viewMode}
                selectedFiles={selectedFiles}
                onViewModeChange={setViewMode}
                onExpandAll={() => setCollapsedGroups(new Set())}
                onCollapseAll={() => setCollapsedGroups(new Set(changelists.map(g => g.id)))}
            />

            <div className={styles.fileListContainer}>
                {changelists.length === 0 ? (
                    loading ? null : <div className={styles.emptyState}>{t('commitView.emptyState')}</div>
                ) : (
                    changelists.map(group => (
                        <ChangelistTree
                            key={group.id}
                            group={group}
                            viewMode={viewMode}
                            selectedFiles={selectedFiles}
                            isCollapsed={collapsedGroups.has(group.id)}
                            activeFile={activeFile}
                            onToggleFile={toggleFile}
                            onToggleCollapse={() => toggleGroupCollapse(group.id)}
                            onRollback={(files) => rpc.rollback(files)}
                            onStash={(files) => rpc.stash({ files })}
                            onDelete={(files) => rpc.deleteFiles(files)}
                            onMoveToChangelist={(files) => rpc.promptCreateChangelist(files[0])}
                        />
                    ))
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
                    addedCount={fileStats.added}
                    modifiedCount={fileStats.modified}
                    deletedCount={fileStats.deleted}
                    onMessageChange={setCommitMessage}
                    onAmendChange={setAmend}
                    onCommit={handleCommit}
                    isGenerating={isGenerating}
                    onGenerate={handleGenerateMessage}
                />
            )}
        </div>
    );
}
