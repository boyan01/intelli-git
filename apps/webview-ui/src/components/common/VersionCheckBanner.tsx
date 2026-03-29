import React from 'react';
import { useTranslation } from 'react-i18next';

export const EXPIRATION_DAYS = 30;
export const WARNING_DAYS = 23;

export const useVersionCheck = () => {
    const buildTimeStr = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : Date.now().toString();
    const buildTime = parseInt(buildTimeStr, 10);
    const daysSinceBuild = (Date.now() - buildTime) / (1000 * 60 * 60 * 24);

    const isExpired = typeof __IS_EXPIRED__ !== 'undefined' ? __IS_EXPIRED__ : (daysSinceBuild > EXPIRATION_DAYS);

    return {
        isExpired,
        needsWarning: !isExpired && daysSinceBuild >= WARNING_DAYS,
        daysRemaining: Math.max(0, Math.ceil(EXPIRATION_DAYS - daysSinceBuild))
    };
};

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
