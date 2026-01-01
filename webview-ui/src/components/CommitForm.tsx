import React from 'react';
import { useTranslation } from 'react-i18next';
// import { VSCodeButton, VSCodeCheckbox, VSCodeTextArea } from '@vscode/webview-ui-toolkit/react';

interface CommitFormProps {
    message: string;
    amend: boolean;
    addedCount?: number;
    modifiedCount?: number;
    deletedCount?: number;
    onMessageChange: (msg: string) => void;
    onAmendChange: (amend: boolean) => void;
    onCommit: (push: boolean) => void;
    isGenerating?: boolean;
    onGenerate?: () => void;
}

export const CommitForm: React.FC<CommitFormProps> = ({
    message,
    amend,
    addedCount = 0,
    modifiedCount = 0,
    deletedCount = 0,
    onMessageChange,
    onAmendChange,
    onCommit,
    isGenerating = false,
    onGenerate
}) => {
    const { t } = useTranslation();

    return (
        <div className="commit-section">
            <div className="commit-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label className="amend-label" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={amend}
                            onChange={(e) => onAmendChange(e.target.checked)}
                            style={{ margin: 0, marginRight: '4px' }}
                        />
                        <span>{t('commitForm.amend')}</span>
                    </label>

                    {onGenerate && (
                        <button
                            className="icon-btn"
                            onClick={onGenerate}
                            disabled={isGenerating}
                            title={t('commitForm.generate')}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: isGenerating ? 'wait' : 'pointer',
                                padding: '4px',
                                opacity: isGenerating ? 0.5 : 1,
                                display: 'flex',
                                alignItems: 'center'
                            }}
                        >
                            <i className={`codicon ${isGenerating ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`}></i>
                        </button>
                    )}
                </div>

                {(addedCount > 0 || modifiedCount > 0 || deletedCount > 0) && (
                    <div style={{ fontSize: '12px', opacity: 0.9, display: 'flex', gap: '8px' }}>
                        {addedCount > 0 && <span style={{ color: 'var(--vscode-gitDecoration-addedResourceForeground)' }}>{t('commitForm.stats.added', { count: addedCount })}</span>}
                        {modifiedCount > 0 && <span style={{ color: 'var(--vscode-gitDecoration-modifiedResourceForeground)' }}>{t('commitForm.stats.modified', { count: modifiedCount })}</span>}
                        {deletedCount > 0 && <span style={{ color: 'var(--vscode-gitDecoration-deletedResourceForeground)' }}>{t('commitForm.stats.deleted', { count: deletedCount })}</span>}
                    </div>
                )}
            </div>

            <textarea
                value={message}
                onChange={(e) => onMessageChange(e.target.value)}
                placeholder={t('commitForm.placeholder')}
                rows={4}
                style={{
                    width: 'calc(100% - 16px)',
                    minHeight: '80px',
                    padding: '8px',
                    margin: '8px',
                    resize: 'vertical',
                    background: 'var(--vscode-input-background)',
                    color: 'var(--vscode-input-foreground)',
                    border: '1px solid var(--vscode-input-border)',
                    borderRadius: '4px',
                    fontFamily: 'var(--vscode-font-family)'
                }}
            />

            <div className="footer-actions">
                <div className="actions-left">
                    <button
                        className="btn btn-primary"
                        onClick={() => onCommit(false)}
                    >
                        {t('commitForm.actions.commit')}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => onCommit(true)}
                    >
                        {t('commitForm.actions.commitAndPush')}
                    </button>
                </div>
                <div className="actions-right">
                    <button className="icon-btn" title={t('commitForm.settings')}>
                        <i className="codicon codicon-settings-gear"></i>
                    </button>
                </div>
            </div>
        </div>
    );
};
