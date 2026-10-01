import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './CommitForm.module.css';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import { RpcError } from '@shared/rpc';
import {
    AI_COPILOT_MODEL_UNAVAILABLE_CODE,
    AI_PROVIDER_SETUP_REQUIRED_CODE,
    type AiProviderStatus,
    type CommitMessageGenerationMode,
    type RepositoryFileReference,
    type RepositoryInfo,
} from '@shared/messages';
import type { CommitAiContext } from '@shared/webviewContext';
import { applyGeneratedCommitMessage, type CommitMessageSelection } from './commitMessageUpdate';

export interface CommitOptions {
    push: boolean;
    signOff: boolean;
}

interface PendingGeneration {
    mode: CommitMessageGenerationMode;
    selection?: CommitMessageSelection;
}

interface CommitFormProps {
    message: string;
    amend: boolean;
    selectedFiles: RepositoryFileReference[];
    repositories?: RepositoryInfo[];
    addedCount?: number;
    modifiedCount?: number;
    deletedCount?: number;
    pushTarget?: {
        remote: string;
        branch: string;
        isConfirmed: boolean;
    };
    isPushTargetLoading?: boolean;
    options: CommitOptions;
    onReviewPushTarget?: () => void;
    onMessageChange: (msg: string) => void;
    onAmendChange: (amend: boolean) => void;
    onOptionsChange: React.Dispatch<React.SetStateAction<CommitOptions>>;
    onCommitSuccess?: () => void;
}

export const CommitForm: React.FC<CommitFormProps> = ({
    message,
    amend,
    selectedFiles,
    repositories = [],
    addedCount = 0,
    modifiedCount = 0,
    deletedCount = 0,
    pushTarget,
    isPushTargetLoading = false,
    options,
    onReviewPushTarget,
    onMessageChange,
    onAmendChange,
    onOptionsChange,
    onCommitSuccess,
}) => {
    const { t } = useTranslation();
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorAction, setErrorAction] = useState<'configure' | 'selectCopilotModel' | null>(null);
    const [aiProviderStatus, setAiProviderStatus] = useState<AiProviderStatus | null>(null);
    const [isTestingProvider, setIsTestingProvider] = useState(false);
    const [aiNotice, setAiNotice] = useState<{ ok: boolean; message: string } | null>(null);
    const [aiScope, setAiScope] = useState<{ fileCount: number; hunkCount: number; amend: boolean } | null>(null);
    const [pendingGeneration, setPendingGeneration] = useState<PendingGeneration | null>(null);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [commitMessageSelection, setCommitMessageSelection] = useState<CommitMessageSelection>({ start: 0, end: 0 });
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const latestMessageRef = useRef(message);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const toggleOption = (key: keyof CommitOptions) => {
        onOptionsChange((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const loadAIProviderStatus = useCallback(async () => {
        try {
            setAiProviderStatus(await rpc.getAIProviderStatus());
        } catch (e) {
            console.error('Failed to load AI provider status', e);
        }
    }, []);

    useEffect(() => {
        void loadAIProviderStatus();
    }, [loadAIProviderStatus]);

    useEffect(() => {
        latestMessageRef.current = message;
    }, [message]);

    useEffect(() => {
        setAiScope(null);
    }, [selectedFiles, amend]);

    const clearError = () => {
        setError(null);
        setErrorAction(null);
        setPendingGeneration(null);
    };

    const configureAIProvider = async () => {
        await rpc.configureAIProvider();
        await loadAIProviderStatus();
    };

    const selectCopilotModel = async () => {
        await rpc.selectCopilotModel();
        await loadAIProviderStatus();
    };

    const openCommitPromptSettings = async () => {
        await rpc.openCommitPromptSettings();
    };

    const handleTestAIProvider = async () => {
        if (isTestingProvider) {
            return;
        }
        setAiNotice(null);
        setIsTestingProvider(true);
        try {
            const result = await rpc.testAIProvider();
            setAiNotice(result);
            await loadAIProviderStatus();
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setAiNotice({ ok: false, message });
        } finally {
            setIsTestingProvider(false);
        }
    };

    const handleErrorAction = async () => {
        if (errorAction === 'selectCopilotModel') {
            await selectCopilotModel();
            return;
        }

        if (errorAction === 'configure') {
            await configureAIProvider();
        }
    };

    const getMessageSelection = (): CommitMessageSelection => {
        const textarea = textareaRef.current;
        const start = textarea?.selectionStart ?? 0;
        const end = textarea?.selectionEnd ?? start;
        return { start, end };
    };

    const updateCommitMessageSelection = () => {
        setCommitMessageSelection(getMessageSelection());
    };

    const getSelectedMessageText = (selection: CommitMessageSelection): string => {
        return message.slice(selection.start, selection.end);
    };

    const getGenerationConfirmationMessage = (mode: CommitMessageGenerationMode): string | null => {
        if (mode === 'full' && message.trim()) {
            return t('Generating a full commit message will replace the current message.');
        }

        if (mode === 'subject') {
            const subject = message.split(/\r?\n/)[0]?.trim();
            return subject ? t('Generating a subject will replace the current subject.') : null;
        }

        if (mode === 'body') {
            const lineBreak = message.indexOf('\n');
            const body = lineBreak === -1 ? '' : message.slice(lineBreak).trim();
            return body ? t('Generating a body will replace the current body.') : null;
        }

        return null;
    };

    const handleGenerateMessage = async (
        mode: CommitMessageGenerationMode = 'full',
        confirmed = false,
        pendingSelection?: CommitMessageSelection
    ) => {
        clearError();
        if (selectedFiles.length === 0) {
            setError(t('Select changes to generate a commit message.'));
            return;
        }

        const selection = pendingSelection || getMessageSelection();
        const selectedText = mode === 'rewrite' ? getSelectedMessageText(selection) : undefined;
        if (mode === 'rewrite' && !selectedText?.trim()) {
            setError(t('Select commit message text to rewrite.'));
            return;
        }

        const confirmationMessage = confirmed ? null : getGenerationConfirmationMessage(mode);
        if (confirmationMessage) {
            setPendingGeneration({ mode, selection });
            setError(confirmationMessage);
            return;
        }

        const requestMessage = message;
        setIsGenerating(true);
        try {
            const result = await rpc.generateCommitMessage({
                files: selectedFiles,
                mode,
                currentMessage: requestMessage,
                selectedText,
                amend,
            });
            if (!result.message.trim()) {
                setError(t('Select changes to generate a commit message.'));
                return;
            }
            if (latestMessageRef.current !== requestMessage) {
                setError(t('Commit message changed while AI was generating. Run generation again.'));
                return;
            }
            onMessageChange(applyGeneratedCommitMessage(requestMessage, result.message, result.mode, selection));
            setAiScope({
                fileCount: result.fileCount,
                hunkCount: result.hunkCount,
                amend,
            });
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            setError(t('Generate failed: {{message}}', { message: errMsg }));
            if (e instanceof RpcError && e.code === AI_COPILOT_MODEL_UNAVAILABLE_CODE) {
                setErrorAction('selectCopilotModel');
            } else if (e instanceof RpcError && e.code === AI_PROVIDER_SETUP_REQUIRED_CODE) {
                setErrorAction('configure');
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const confirmPendingGeneration = () => {
        if (!pendingGeneration) {
            return;
        }

        void handleGenerateMessage(pendingGeneration.mode, true, pendingGeneration.selection);
    };

    useEffect(() => {
        return rpcEvents.commitAiAction.subscribe((action) => {
            if (action === 'generateMessage') {
                void handleGenerateMessage('full');
                return;
            }
            if (action === 'generateSubject') {
                void handleGenerateMessage('subject');
                return;
            }
            if (action === 'generateBody') {
                void handleGenerateMessage('body');
                return;
            }
            if (action === 'rewriteSelection') {
                void handleGenerateMessage('rewrite', false, commitMessageSelection);
                return;
            }
            if (action === 'configureProvider') {
                void configureAIProvider();
                return;
            }
            if (action === 'selectCopilotModel') {
                void selectCopilotModel();
                return;
            }
            if (action === 'testProvider') {
                void handleTestAIProvider();
                return;
            }
            if (action === 'openCommitPromptSettings') {
                void openCommitPromptSettings();
            }
        });
    });

    const handleCommit = async () => {
        clearError();
        const files = selectedFiles;
        if (files.length === 0 && !amend) {
            return;
        }
        const repoCount = new Set(files.map((file) => file.repoPath || '')).size;
        if (options.push && repoCount > 1) {
            setError(t('Commit & Push supports one repository at a time.'));
            return;
        }
        if (options.push) {
            if (isPushTargetLoading) {
                setError(t('Push target is still loading.'));
                return;
            }
            if (!pushTarget?.isConfirmed) {
                onReviewPushTarget?.();
                return;
            }
        }
        try {
            await rpc.commit({
                message: options.signOff ? `${message}\n\nSigned-off-by: ` : message,
                files,
                amend: amend,
                pushTarget:
                    options.push && pushTarget?.isConfirmed
                        ? { remote: pushTarget.remote, branch: pushTarget.branch }
                        : undefined,
            });
            onMessageChange('');
            onCommitSuccess?.();
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            const key = errMsg.includes('succeeded; push to')
                ? 'Push after commit failed: {{message}}'
                : 'Commit failed: {{message}}';
            setError(t(key, { message: errMsg }));
        }
    };

    const getButtonState = () => {
        const repoCount = new Set(selectedFiles.map((file) => file.repoPath || '')).size;
        if (amend && options.push) {
            return {
                text: t('Amend & Push'),
                variant: 'primary' as const,
                icon: 'codicon-repo-push',
            };
        }
        if (amend) {
            return {
                text: t('Amend'),
                variant: 'secondary' as const,
                icon: 'codicon-edit',
            };
        }
        if (options.push) {
            return {
                text:
                    repoCount > 1
                        ? t('Commit {{count}} Repositories & Push', { count: repoCount })
                        : t('Commit & Push'),
                variant: 'primary' as const,
                icon: 'codicon-repo-push',
            };
        }
        return {
            text: repoCount > 1 ? t('Commit {{count}} Repositories', { count: repoCount }) : t('Commit'),
            variant: 'primary' as const,
            icon: 'codicon-check',
        };
    };

    const btnState = getButtonState();
    const isDisabled = (selectedFiles.length === 0 && !amend) || !message.trim();
    const planItems = Array.from(
        selectedFiles
            .reduce((map, file) => {
                const key = file.repoPath || '';
                map.set(key, (map.get(key) || 0) + 1);
                return map;
            }, new Map<string, number>())
            .entries()
    ).map(([repoPath, count]) => ({
        repo: repositories.find((repo) => repo.repoPath === repoPath),
        repoPath,
        count,
    }));
    const repoCount = planItems.length || new Set(selectedFiles.map((file) => file.repoPath || '')).size;
    const pushTargetLabel =
        pushTarget?.remote && pushTarget.branch ? `${pushTarget.remote}/${pushTarget.branch}` : t('No push target');
    const pushTargetNeedsReview = !pushTarget?.isConfirmed;
    const aiScopeLabel =
        selectedFiles.length > 0
            ? aiScope
                ? aiScope.amend
                    ? t('Amend AI scope: {{files}} files, {{hunks}} change blocks', {
                          files: aiScope.fileCount,
                          hunks: aiScope.hunkCount,
                      })
                    : t('AI scope: {{files}} files, {{hunks}} change blocks', {
                          files: aiScope.fileCount,
                          hunks: aiScope.hunkCount,
                      })
                : amend
                  ? t('Amend AI scope: {{files}} selected files', { files: selectedFiles.length })
                  : t('AI scope: {{files}} selected files', { files: selectedFiles.length })
            : null;
    const hasCommitMessageSelection = commitMessageSelection.end > commitMessageSelection.start;
    const aiButtonLabel =
        selectedFiles.length > 0
            ? aiScopeLabel
                ? `${t('Generate')}. ${aiScopeLabel}`
                : amend
                  ? `${t('Generate')}. ${t('Amend AI scope: {{files}} selected files', { files: selectedFiles.length })}`
                  : `${t('Generate')}. ${t('AI scope: {{files}} selected files', { files: selectedFiles.length })}`
            : t('Select changes to generate a commit message.');
    const commitAiContext = (webviewSection: CommitAiContext['webviewSection']): CommitAiContext => ({
        webviewSection,
        hasSelectedChanges: selectedFiles.length > 0,
        hasCommitMessageSelection,
        canSelectCopilotModel: Boolean(aiProviderStatus?.canSelectModel),
        preventDefaultContextMenuItems: false,
    });

    return (
        <div className={styles.commitSection}>
            <div className={styles.commitToolbar}>
                <div className={styles.commitToolbarLeft}>
                    <label className={styles.amendLabel}>
                        <input
                            type="checkbox"
                            checked={amend}
                            onChange={(e) => onAmendChange(e.target.checked)}
                            className={styles.amendInput}
                        />
                        <span>{t('Amend')}</span>
                    </label>

                    <div
                        className={styles.generateControl}
                        data-vscode-context={JSON.stringify(commitAiContext('commitGenerateButton'))}
                        title={aiButtonLabel}
                    >
                        <button
                            className={`${styles.iconBtn} ${styles.generateBtn} ${isGenerating ? styles.generateBtnLoading : ''}`}
                            onClick={() => void handleGenerateMessage('full')}
                            disabled={isGenerating || selectedFiles.length === 0}
                            title={aiButtonLabel}
                            aria-label={aiButtonLabel}
                            data-vscode-context={JSON.stringify(commitAiContext('commitGenerateButton'))}
                        >
                            <i
                                className={`codicon ${isGenerating ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`}
                            ></i>
                        </button>
                    </div>
                </div>

                {(addedCount > 0 || modifiedCount > 0 || deletedCount > 0) && (
                    <div className={styles.stats}>
                        {addedCount > 0 && (
                            <span className={styles.statAdded}>{t('{{count}} Added', { count: addedCount })}</span>
                        )}
                        {modifiedCount > 0 && (
                            <span className={styles.statModified}>
                                {t('{{count}} Modified', { count: modifiedCount })}
                            </span>
                        )}
                        {deletedCount > 0 && (
                            <span className={styles.statDeleted}>
                                {t('{{count}} Deleted', { count: deletedCount })}
                            </span>
                        )}
                    </div>
                )}
            </div>

            <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => onMessageChange(e.target.value)}
                onSelect={updateCommitMessageSelection}
                onMouseUp={updateCommitMessageSelection}
                onKeyUp={updateCommitMessageSelection}
                onContextMenu={updateCommitMessageSelection}
                placeholder={t('Commit Message')}
                rows={4}
                className={styles.textarea}
                data-vscode-context={JSON.stringify(commitAiContext('commitMessageInput'))}
            />

            {planItems.length > 1 && (
                <div className={styles.commitPlan}>
                    <div className={styles.commitPlanTitle}>{t('Commit Plan')}</div>
                    {planItems.map((item) => (
                        <div className={styles.commitPlanItem} key={item.repoPath || 'active'}>
                            <span>
                                {item.repo?.name || item.repoPath || t('Current Repository')}
                                {item.repo?.branch ? ` - ${item.repo.branch}` : ''}
                            </span>
                            <span>{t('{{count}} files', { count: item.count })}</span>
                        </div>
                    ))}
                </div>
            )}

            {options.push && (
                <div
                    className={`${styles.pushTargetRow} ${pushTargetNeedsReview || repoCount > 1 ? styles.pushTargetWarning : ''}`}
                >
                    <div className={styles.pushTargetInfo}>
                        <i
                            className={`codicon ${pushTargetNeedsReview || repoCount > 1 ? 'codicon-warning' : 'codicon-repo-push'}`}
                        />
                        <span className={styles.pushTargetLabel}>{t('Push target:')}</span>
                        <span className={styles.pushTargetValue}>
                            {repoCount > 1
                                ? t('Select one repository to push after commit')
                                : isPushTargetLoading
                                  ? t('Loading...')
                                  : pushTargetNeedsReview
                                    ? t('Review target before pushing')
                                    : pushTargetLabel}
                        </span>
                    </div>
                    {repoCount <= 1 && (
                        <button type="button" className={styles.pushTargetButton} onClick={onReviewPushTarget}>
                            {pushTargetNeedsReview ? t('Review...') : t('Change...')}
                        </button>
                    )}
                </div>
            )}

            {error && (
                <div className={styles.errorMessage}>
                    <i className="codicon codicon-warning"></i>
                    <span>{error}</span>
                    {pendingGeneration && (
                        <button className={styles.errorActionBtn} onClick={confirmPendingGeneration}>
                            {t('Replace')}
                        </button>
                    )}
                    {errorAction && (
                        <button className={styles.errorActionBtn} onClick={handleErrorAction}>
                            {errorAction === 'selectCopilotModel'
                                ? t('Select Copilot Model')
                                : t('Configure AI Provider')}
                        </button>
                    )}
                    <button className={styles.dismissBtn} onClick={clearError} title={t('Dismiss')}>
                        <i className="codicon codicon-close"></i>
                    </button>
                </div>
            )}

            {aiNotice && (
                <div className={`${styles.aiNotice} ${aiNotice.ok ? styles.aiNoticeSuccess : styles.aiNoticeError}`}>
                    <i className={`codicon ${aiNotice.ok ? 'codicon-check' : 'codicon-warning'}`} />
                    <span>{aiNotice.message}</span>
                    <button className={styles.dismissBtn} onClick={() => setAiNotice(null)} title={t('Dismiss')}>
                        <i className="codicon codicon-close"></i>
                    </button>
                </div>
            )}

            <div className={styles.footerActions}>
                <div
                    className={styles.splitButton}
                    ref={dropdownRef}
                    onBlur={(e) => {
                        if (!dropdownRef.current?.contains(e.relatedTarget as Node)) {
                            setIsDropdownOpen(false);
                        }
                    }}
                >
                    <button
                        className={`${styles.mainBtn} ${styles[btnState.variant]}`}
                        onClick={handleCommit}
                        disabled={isDisabled}
                    >
                        <i className={`codicon ${btnState.icon}`} />
                        <span>{btnState.text}</span>
                    </button>

                    <button
                        className={`${styles.optionsBtn} ${styles[btnState.variant]} ${isDisabled ? styles.optionsBtnDisabled : ''}`}
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        aria-label={t('Commit Options')}
                    >
                        <i
                            className={`codicon codicon-chevron-up ${styles.chevron} ${isDropdownOpen ? styles.chevronOpen : ''}`}
                        />
                    </button>

                    {isDropdownOpen && (
                        <div className={styles.dropdown}>
                            <div className={styles.dropdownHeader}>{t('Commit Options')}</div>

                            <button className={styles.dropdownItem} onClick={() => toggleOption('push')}>
                                <div className={styles.itemContent}>
                                    <i className="codicon codicon-repo-push" />
                                    <span>{t('Push after Commit')}</span>
                                </div>
                                <span className={styles.checkIcon}>
                                    {options.push && <i className="codicon codicon-check" />}
                                </span>
                            </button>

                            <button className={styles.dropdownItem} onClick={() => toggleOption('signOff')}>
                                <div className={styles.itemContent}>
                                    <i className="codicon codicon-verified" />
                                    <span>{t('Sign Off')}</span>
                                </div>
                                <span className={styles.checkIcon}>
                                    {options.signOff && <i className="codicon codicon-check" />}
                                </span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
