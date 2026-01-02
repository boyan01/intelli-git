import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import styles from './SplitPane.module.css';

export interface SplitPaneProps {
    direction: 'horizontal' | 'vertical';
    first: ReactNode;
    second: ReactNode;
    defaultSize?: number;
    /** Default size for second pane, will calculate first pane size from container */
    secondDefaultSize?: number;
    /** 0-1 ratio, takes precedence over defaultSize */
    defaultRatio?: number;
    minSize?: number;
    maxSize?: number;
    className?: string;
}

export function SplitPane({
    direction,
    first,
    second,
    defaultSize = 200,
    secondDefaultSize,
    defaultRatio,
    minSize = 50,
    maxSize,
    className = ''
}: SplitPaneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const needsCalculation = defaultRatio !== undefined || secondDefaultSize !== undefined;
    const [size, setSize] = useState<number | null>(needsCalculation ? null : defaultSize);
    const isDragging = useRef(false);
    const startPos = useRef(0);
    const startSize = useRef(0);

    useEffect(() => {
        if (size === null && containerRef.current) {
            const containerSize = direction === 'horizontal'
                ? containerRef.current.clientWidth
                : containerRef.current.clientHeight;

            if (defaultRatio !== undefined) {
                setSize(Math.round(containerSize * defaultRatio));
            } else if (secondDefaultSize !== undefined) {
                // Subtract resizer width (4px) and second pane size from container
                setSize(Math.max(minSize, containerSize - secondDefaultSize - 4));
            }
        }
    }, [defaultRatio, secondDefaultSize, direction, size, minSize]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        isDragging.current = true;
        startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
        startSize.current = size ?? 0;
        document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
    }, [size, direction]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging.current || !containerRef.current) return;

            const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
            const containerSize = direction === 'horizontal'
                ? containerRef.current.clientWidth
                : containerRef.current.clientHeight;

            const delta = currentPos - startPos.current;
            const effectiveMax = maxSize ?? containerSize - minSize;
            const newSize = Math.max(minSize, Math.min(startSize.current + delta, effectiveMax));
            setSize(newSize);
        };

        const handleMouseUp = () => {
            isDragging.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [direction, minSize, maxSize]);

    const isHorizontal = direction === 'horizontal';

    return (
        <div
            ref={containerRef}
            className={`${styles.container} ${isHorizontal ? styles.horizontal : styles.vertical} ${className}`}
        >
            <div
                className={styles.pane}
                style={size !== null
                    ? (isHorizontal ? { width: size } : { height: size })
                    : { flex: 1 }
                }
            >
                {first}
            </div>
            <div
                className={`${styles.resizer} ${isHorizontal ? styles.resizerHorizontal : styles.resizerVertical}`}
                onMouseDown={handleMouseDown}
            />
            <div className={`${styles.pane} ${styles.paneSecond}`}>
                {second}
            </div>
        </div>
    );
}
