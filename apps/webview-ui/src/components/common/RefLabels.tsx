import React, { useState, useRef, useEffect } from 'react';
import styles from './RefLabels.module.css';

interface Ref {
    name: string;
    type: 'head' | 'tag' | 'remote' | 'local';
}

interface RefLabelsProps {
    refs: Ref[];
    maxVisible?: number;
    wrap?: boolean;
    truncate?: boolean;
}

const MAX_LABEL_LENGTH = 16;
const VISIBLE_REF_COUNT = 2;

const REF_PRIORITY: Record<Ref['type'], number> = {
    head: 0,
    tag: 1,
    local: 2,
    remote: 3
};

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

function getTypeIcon(type: Ref['type'], name: string): string {
    if (name.includes('HEAD')) return 'git-branch';
    if (type === 'tag') return 'tag';
    if (type === 'remote') return 'cloud';
    return 'git-branch';
}

function sortRefsForDisplay(refs: Ref[]): Ref[] {
    return refs
        .map((ref, index) => ({ ref, index }))
        .sort((a, b) => {
            const priorityDelta = REF_PRIORITY[a.ref.type] - REF_PRIORITY[b.ref.type];
            return priorityDelta === 0 ? a.index - b.index : priorityDelta;
        })
        .map(({ ref }) => ref);
}

export const RefLabels: React.FC<RefLabelsProps> = ({ refs, maxVisible = VISIBLE_REF_COUNT, wrap = false, truncate = true }) => {
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

    const displayRefs = sortRefsForDisplay(refs);
    const visibleRefs = displayRefs.slice(0, Math.max(1, maxVisible));
    const extraCount = displayRefs.length - visibleRefs.length;
    const hasShortenedRef = truncate && displayRefs.some(ref => shortenRefName(ref.name) !== ref.name);
    const shouldShowTooltip = extraCount > 0 || hasShortenedRef;

    return (
        <span
            ref={containerRef}
            className={`${styles.container} ${wrap ? styles.wrap : ''} ${truncate ? '' : styles.fullNames}`}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            {visibleRefs.map((ref, index) => {
                const displayName = truncate ? shortenRefName(ref.name) : ref.name;
                return (
                    <span
                        key={`${ref.type}:${ref.name}:${index}`}
                        className={`${styles.label} ${getTypeClass(ref.type, ref.name)}`}
                    >
                        <i className={`codicon codicon-${getTypeIcon(ref.type, ref.name)} ${styles.icon}`} aria-hidden="true" />
                        <span className={styles.text}>{displayName}</span>
                    </span>
                );
            })}
            {extraCount > 0 && (
                <span className={styles.extraBadge}>+{extraCount}</span>
            )}

            {showTooltip && shouldShowTooltip && (
                <div ref={tooltipRef} className={styles.tooltip}>
                    {displayRefs.map((ref, i) => (
                        <div key={i} className={`${styles.tooltipItem} ${getTypeClass(ref.type, ref.name)}`}>
                            <i className={`codicon codicon-${getTypeIcon(ref.type, ref.name)} ${styles.icon}`} aria-hidden="true" />
                            <span>{ref.name}</span>
                        </div>
                    ))}
                </div>
            )}
        </span>
    );
};
