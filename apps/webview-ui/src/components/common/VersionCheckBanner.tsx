import React from 'react';
import { useTranslation } from 'react-i18next';
import { useVersionCheck } from '../../hooks/useVersionCheck';

export const VersionCheckBanner: React.FC = () => {
    const { t } = useTranslation();
    const { needsWarning, daysRemaining } = useVersionCheck();

    if (!needsWarning) return null;

    return (
        <div style={{
            backgroundColor: 'var(--vscode-editorWarning-background, #cc6633)',
            color: 'var(--vscode-editorWarning-foreground, #ffffff)',
            padding: '8px 12px',
            textAlign: 'center',
            fontSize: '13px',
            flexShrink: 0
        }}>
            {t('version.expires.warning', { days: daysRemaining })}
        </div>
    );
};
