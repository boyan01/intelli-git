import { useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import styles from './SplitPane.module.css';

export interface SplitPaneProps {
    direction: 'horizontal' | 'vertical';
    first: ReactNode;
    second: ReactNode;
    defaultSize?: number;
    minSize?: number;
    maxSize?: number;
    className?: string;
}

export function SplitPane({
    direction,
    first,
    second,
    defaultSize = 200,
    minSize = 50,
    maxSize,
    className = ''
}: SplitPaneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState(defaultSize);
    const isDragging = useRef(false);
    const startPos = useRef(0);
    const startSize = useRef(0);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        isDragging.current = true;
        startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
        startSize.current = size;
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
                style={isHorizontal ? { width: size } : { height: size }}
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
