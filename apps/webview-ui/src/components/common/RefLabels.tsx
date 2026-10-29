import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { RefInfo } from '@shared/messages';
import styles from './RefLabels.module.css';
import { buildRefLabels, type RefLabel } from './refLabelModel';

interface RefLabelsProps {
    refs: RefInfo[];
    maxVisible?: number;
    wrap?: boolean;
    truncate?: boolean;
}

const VISIBLE_REF_COUNT = 1;
const TOOLTIP_GAP = 4;
const VIEWPORT_MARGIN = 4;

const KIND_CLASS: Record<RefLabel['kind'], string> = {
    current: styles.current,
    local: styles.local,
    tag: styles.tag,
    remote: styles.remote,
};

const REF_TYPE_KIND: Record<RefInfo['type'], RefLabel['kind']> = {
    head: 'current',
    local: 'local',
    tag: 'tag',
    remote: 'remote',
};

function getKindIcon(kind: RefLabel['kind']): string {
    if (kind === 'tag') return 'tag';
    if (kind === 'remote') return 'cloud';
    return 'git-branch';
}

export const RefLabels: React.FC<RefLabelsProps> = ({
    refs,
    maxVisible = VISIBLE_REF_COUNT,
    wrap = false,
    truncate = true,
}) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const containerRef = useRef<HTMLSpanElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    // The tooltip lives in a body-level fixed layer so scrollable lists cannot clip it.
    useLayoutEffect(() => {
        if (!showTooltip || !tooltipRef.current || !containerRef.current) return;

        const tooltip = tooltipRef.current;
        const anchor = containerRef.current.getBoundingClientRect();
        const { width, height } = tooltip.getBoundingClientRect();
        const fitsBelow = anchor.bottom + TOOLTIP_GAP + height <= window.innerHeight - VIEWPORT_MARGIN;
        const top = fitsBelow ? anchor.bottom + TOOLTIP_GAP : anchor.top - TOOLTIP_GAP - height;
        const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width;

        tooltip.style.top = `${Math.max(VIEWPORT_MARGIN, top)}px`;
        tooltip.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, maxLeft))}px`;
    }, [showTooltip]);

    // A fixed tooltip would drift away from its row while the list scrolls.
    useEffect(() => {
        if (!showTooltip) return;
        const hide = () => setShowTooltip(false);
        window.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);
        return () => {
            window.removeEventListener('scroll', hide, true);
            window.removeEventListener('resize', hide);
        };
    }, [showTooltip]);

    if (!refs || refs.length === 0) return null;

    const labels = buildRefLabels(refs);
    if (labels.length === 0) return null;

    const visibleLabels = labels.slice(0, Math.max(1, maxVisible));
    const extraCount = labels.length - visibleLabels.length;
    // Labels truncate via CSS, so the compact form always offers the full ref list on hover.
    const shouldShowTooltip = truncate || extraCount > 0;

    return (
        <span
            ref={containerRef}
            className={`${styles.container} ${wrap ? styles.wrap : ''} ${truncate ? '' : styles.fullNames}`}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            {visibleLabels.map((label) => (
                <span key={`${label.kind}:${label.name}`} className={`${styles.label} ${KIND_CLASS[label.kind]}`}>
                    <i className={`codicon codicon-${getKindIcon(label.kind)} ${styles.icon}`} aria-hidden="true" />
                    <span className={styles.text}>{label.name}</span>
                    {label.syncedRemotes.length > 0 && (
                        <i className={`codicon codicon-cloud ${styles.icon} ${styles.syncIcon}`} aria-hidden="true" />
                    )}
                </span>
            ))}
            {extraCount > 0 && <span className={styles.extraCount}>+{extraCount}</span>}

            {showTooltip &&
                shouldShowTooltip &&
                createPortal(
                    <div ref={tooltipRef} className={styles.tooltip}>
                        {refs.map((ref, i) => {
                            const kind = REF_TYPE_KIND[ref.type];
                            return (
                                <div key={i} className={`${styles.tooltipItem} ${KIND_CLASS[kind]}`}>
                                    <i
                                        className={`codicon codicon-${getKindIcon(kind)} ${styles.icon}`}
                                        aria-hidden="true"
                                    />
                                    <span>{ref.name}</span>
                                </div>
                            );
                        })}
                    </div>,
                    document.body
                )}
        </span>
    );
};
