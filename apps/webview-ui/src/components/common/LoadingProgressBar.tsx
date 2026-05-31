import { useEffect, useState } from 'react';
import styles from './LoadingProgressBar.module.css';

const DEFAULT_DELAY_MS = 150;

interface LoadingProgressBarProps {
    active: boolean;
    ariaLabel: string;
    delayMs?: number;
    className?: string;
}

export function LoadingProgressBar({
    active,
    ariaLabel,
    delayMs = DEFAULT_DELAY_MS,
    className = ''
}: LoadingProgressBarProps) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!active) {
            setVisible(false);
            return;
        }

        const timeoutId = window.setTimeout(() => {
            setVisible(true);
        }, delayMs);

        return () => window.clearTimeout(timeoutId);
    }, [active, delayMs]);

    return (
        <div className={`${styles.slot} ${className}`}>
            {visible ? (
                <div
                    className={styles.indicator}
                    role="progressbar"
                    aria-label={ariaLabel}
                />
            ) : null}
        </div>
    );
}
