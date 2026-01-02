import React, { useEffect, useRef } from 'react';
import styles from './ContextMenu.module.css';

export interface ContextMenuItem {
    icon?: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    separator?: boolean;
}

export interface ContextMenuProps {
    items: ContextMenuItem[];
    position: { x: number; y: number };
    onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ items, position, onClose }) => {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    // Adjust position to keep menu within viewport
    useEffect(() => {
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            if (rect.right > viewportWidth) {
                menuRef.current.style.left = `${viewportWidth - rect.width - 8}px`;
            }
            if (rect.bottom > viewportHeight) {
                menuRef.current.style.top = `${viewportHeight - rect.height - 8}px`;
            }
        }
    }, [position]);

    return (
        <div
            ref={menuRef}
            className={styles.contextMenu}
            style={{ left: position.x, top: position.y }}
        >
            {items.map((item, index) => {
                if (item.separator) {
                    return <div key={index} className={styles.contextMenuSeparator} />;
                }

                return (
                    <div
                        key={index}
                        className={`${styles.contextMenuItem} ${item.disabled ? styles.disabled : ''}`}
                        onClick={() => {
                            if (!item.disabled) {
                                item.onClick();
                                onClose();
                            }
                        }}
                    >
                        <span className={styles.contextMenuItemIcon}>
                            {item.icon && <i className={`codicon codicon-${item.icon}`} />}
                        </span>
                        <span className={styles.contextMenuItemLabel}>{item.label}</span>
                    </div>
                );
            })}
        </div>
    );
};
