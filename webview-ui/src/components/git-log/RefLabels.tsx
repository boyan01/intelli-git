import React, { useState, useRef, useEffect } from 'react';
import styles from './RefLabels.module.css';

interface Ref {
    name: string;
    type: 'head' | 'tag' | 'remote' | 'local';
}

interface RefLabelsProps {
    refs: Ref[];
}

const MAX_LABEL_LENGTH = 16;

function shortenRefName(name: string): string {
    if (name.length <= MAX_LABEL_LENGTH) return name;

    // origin/feat/improve_xxxx_api -> .../improve_xx...
    const parts = name.split('/');
    if (parts.length > 2) {
        const lastPart = parts[parts.length - 1];
        const availableLength = MAX_LABEL_LENGTH - 4; // ".../" takes 4 chars
        if (lastPart.length > availableLength) {
            return '.../' + lastPart.slice(0, availableLength - 3) + '...';
        }
        return '.../' + lastPart;
    }

    // Simple truncation for short paths
    return name.slice(0, MAX_LABEL_LENGTH - 3) + '...';
}

function getTypeClass(type: string, name: string): string {
    if (name.includes('HEAD')) return styles.head;
    switch (type) {
        case 'head': return styles.head;
        case 'tag': return styles.tag;
        case 'remote': return styles.remote;
        case 'local': return styles.local;
        default: return styles.local;
    }
}

export const RefLabels: React.FC<RefLabelsProps> = ({ refs }) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const containerRef = useRef<HTMLSpanElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showTooltip || !tooltipRef.current || !containerRef.current) return;

        const tooltip = tooltipRef.current;
        const container = containerRef.current;
        const rect = container.getBoundingClientRect();

        // Position tooltip below the labels
        tooltip.style.top = `${rect.height + 4}px`;
        tooltip.style.left = '0';
    }, [showTooltip]);

    if (!refs || refs.length === 0) return null;

    const firstRef = refs[0];
    const secondRef = refs.length > 1 ? refs[1] : null;
    const extraCount = refs.length - 2;
    const shortName = shortenRefName(firstRef.name);
    const isShortened = shortName !== firstRef.name;

    return (
        <span
            ref={containerRef}
            className={styles.container}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            <span className={styles.stackWrapper}>
                {secondRef && (
                    <span
                        className={`${styles.label} ${styles.stackedLabel} ${getTypeClass(secondRef.type, secondRef.name)}`}
                    />
                )}
                <span className={`${styles.label} ${getTypeClass(firstRef.type, firstRef.name)}`}>
                    {shortName}
                </span>
                {extraCount > 0 && (
                    <span className={styles.extraBadge}>+{extraCount}</span>
                )}
            </span>

            {showTooltip && (secondRef || isShortened) && (
                <div ref={tooltipRef} className={styles.tooltip}>
                    {refs.map((ref, i) => (
                        <div key={i} className={`${styles.tooltipItem} ${getTypeClass(ref.type, ref.name)}`}>
                            {ref.name}
                        </div>
                    ))}
                </div>
            )}
        </span>
    );
};
