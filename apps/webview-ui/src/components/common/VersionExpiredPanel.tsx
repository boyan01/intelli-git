import React from 'react';
import { useTranslation } from 'react-i18next';

export const VersionExpiredPanel: React.FC = () => {
    const { t } = useTranslation();

    return (
        <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100%', 
            padding: '40px 20px', 
            textAlign: 'center',
            boxSizing: 'border-box'
        }}>
            <div style={{ fontSize: '48px', marginBottom: '24px' }}>⏳</div>
            <h2 style={{ 
                margin: '0 0 12px 0', 
                color: 'var(--vscode-editorError-foreground)',
                fontSize: '18px',
                fontWeight: 600
            }}>
                {t('version.expired.title')}
            </h2>
            <p style={{ 
                margin: '0 0 24px 0', 
                color: 'var(--vscode-descriptionForeground)',
                fontSize: '13px',
                lineHeight: '1.5'
            }}>
                {t('version.expired.description')}
            </p>
        </div>
    );
};
