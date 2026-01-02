import React from 'react';
import { useTranslation } from 'react-i18next';

interface RebaseFormProps {
    message: string;
    addedCount?: number;
    modifiedCount?: number;
    deletedCount?: number;
    disableContinue?: boolean;
    onMessageChange: (msg: string) => void;
    onContinue: () => void;
}

export const RebaseForm: React.FC<RebaseFormProps> = ({
    message,
    addedCount = 0,
    modifiedCount = 0,
    deletedCount = 0,
    disableContinue = false,
    onMessageChange,
    onContinue
}) => {
    const { t } = useTranslation();

    return (
        <div className="commit-section">
            <div className="commit-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', opacity: 0.7 }}>
                    <span className="codicon codicon-git-merge" style={{ marginRight: '4px' }}></span>
                    <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Rebase in progress</span>
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
                    fontFamily: 'var(--vscode-font-family)',
                    opacity: 0.9
                }}
            />

            <div className="footer-actions">
                <div className="actions-left">
                    <button
                        className="btn btn-primary"
                        onClick={onContinue}
                        disabled={disableContinue}
                        title={disableContinue ? 'Resolve conflicts before continuing' : ''}
                        style={{ backgroundColor: 'var(--vscode-debugIcon-startForeground)', color: '#fff', width: '100%', opacity: disableContinue ? 0.5 : 1 }}
                    >
                        <span className="codicon codicon-play" style={{ marginRight: '4px' }}></span>
                        {t('commitForm.actions.continue')}
                    </button>
                </div>
            </div>
        </div>
    );
};
