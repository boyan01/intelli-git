import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ViewModeToggle.module.css';

export type ViewMode = 'tree' | 'list';

interface ViewModeToggleProps {
    viewMode: ViewMode;
    onChange: (mode: ViewMode) => void;
    className?: string;
}

export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({
    viewMode,
    onChange,
    className
}) => {
    const { t } = useTranslation();

    const handleClick = () => {
        onChange(viewMode === 'tree' ? 'list' : 'tree');
    };

    const iconClass = viewMode === 'tree' ? 'list-tree' : 'list-flat';
    const title = viewMode === 'tree' ? t('Switch to List View') : t('Switch to Tree View');

    return (
        <button
            className={`${styles.toggle} ${className ?? ''}`}
            title={title}
            aria-label={title}
            data-tooltip={title}
            onClick={handleClick}
        >
            <i className={`codicon codicon-${iconClass}`} />
        </button>
    );
};
