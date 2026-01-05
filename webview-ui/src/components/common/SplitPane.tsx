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

const RESIZER_SIZE = 4;

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
    // Store ratio (0-1) instead of pixel size
    const [ratio, setRatio] = useState<number | null>(() => {
        if (defaultRatio !== undefined) return defaultRatio;
        return null;
    });
    const isDragging = useRef(false);
    const startPos = useRef(0);
    const startRatio = useRef(0);

    const getContainerSize = useCallback(() => {
        if (!containerRef.current) return 0;
        return direction === 'horizontal'
            ? containerRef.current.clientWidth
            : containerRef.current.clientHeight;
    }, [direction]);

    // Calculate initial ratio from defaultSize or secondDefaultSize
    useEffect(() => {
        if (ratio === null && containerRef.current) {
            const containerSize = getContainerSize();
            if (containerSize === 0) return;

            if (secondDefaultSize !== undefined) {
                const firstSize = Math.max(minSize, containerSize - secondDefaultSize - RESIZER_SIZE);
                setRatio(firstSize / containerSize);
            } else {
                setRatio(defaultSize / containerSize);
            }
        }
    }, [ratio, getContainerSize, secondDefaultSize, defaultSize, minSize]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        isDragging.current = true;
        startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
        startRatio.current = ratio ?? 0.5;
        document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
    }, [ratio, direction]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging.current || !containerRef.current) return;

            const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
            const containerSize = getContainerSize();
            if (containerSize === 0) return;

            const delta = currentPos - startPos.current;
            const deltaRatio = delta / containerSize;

            const minRatio = minSize / containerSize;
            const maxRatio = maxSize ? maxSize / containerSize : 1 - minRatio;

            const newRatio = Math.max(minRatio, Math.min(startRatio.current + deltaRatio, maxRatio));
            setRatio(newRatio);
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
    }, [direction, minSize, maxSize, getContainerSize]);

    const isHorizontal = direction === 'horizontal';
    const firstPaneStyle = ratio !== null
        ? { flex: `0 0 calc(${ratio * 100}% - ${RESIZER_SIZE / 2}px)` }
        : { flex: 1 };
    const secondPaneStyle = ratio !== null
        ? { flex: `0 0 calc(${(1 - ratio) * 100}% - ${RESIZER_SIZE / 2}px)` }
        : { flex: 1 };

    return (
        <div
            ref={containerRef}
            className={`${styles.container} ${isHorizontal ? styles.horizontal : styles.vertical} ${className}`}
        >
            <div className={styles.pane} style={firstPaneStyle}>
                {first}
            </div>
            <div
                className={`${styles.resizer} ${isHorizontal ? styles.resizerHorizontal : styles.resizerVertical}`}
                onMouseDown={handleMouseDown}
            />
            <div className={styles.pane} style={secondPaneStyle}>
                {second}
            </div>
        </div>
    );
}
