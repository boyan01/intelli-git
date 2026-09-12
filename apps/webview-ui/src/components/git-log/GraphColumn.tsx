import React from 'react';
import type { GraphNode, GraphLine } from './graphUtils';

interface GraphColumnProps {
    node: GraphNode;
    rowHeight: number;
    graphHeight?: number;
    graphWidth: number;
    rowIndex: number;
    rowTop?: number;
    onJumpToCommit?: (hash: string) => void;
    isSelected?: boolean;
    isHovered?: boolean;
    hasFocus?: boolean;
    isExpanded?: boolean;
}

export const CELL_WIDTH = 16;
const ARROW_HALF_WIDTH = 4;
const ARROW_HEIGHT = 6;
const ARROW_HIT_PADDING = 4;

// Determine stroke color based on row state
const getStrokeColor = (isSelected: boolean, isHovered: boolean, hasFocus: boolean): string => {
    if (isSelected) {
        return hasFocus
            ? 'var(--vscode-list-activeSelectionBackground)'
            : 'var(--vscode-list-inactiveSelectionBackground)';
    }
    if (isHovered) {
        return 'var(--vscode-list-hoverBackground)';
    }
    return 'var(--vscode-sideBar-background)';
};

export const GraphColumn: React.FC<GraphColumnProps> = ({
    node,
    rowHeight,
    graphHeight,
    graphWidth,
    rowIndex,
    rowTop,
    onJumpToCommit,
    isSelected = false,
    isHovered = false,
    hasFocus = false,
    isExpanded = false
}) => {
    const svgHeight = graphHeight ?? rowHeight;
    const dotY = rowHeight / 2;
    const DOT_RADIUS = isExpanded ? 6 : 5;
    const STROKE_WIDTH = isExpanded ? 4 : 3;
    const [hoveredArrowIndex, setHoveredArrowIndex] = React.useState<number | null>(null);
    const getLineStrokeWidth = (line: GraphLine) => {
        if (!isExpanded) return 2;
        return line.x1 === node.column || line.x2 === node.column ? 3 : 2;
    };

    const getY = (value: number) => {
        if (value <= 0.5) {
            return value * rowHeight;
        }

        if (svgHeight === rowHeight) {
            return value * rowHeight;
        }

        return dotY + ((value - 0.5) / 0.5) * (svgHeight - dotY);
    };

    const getPath = (line: GraphLine) => {
        const x1 = line.x1 * CELL_WIDTH + CELL_WIDTH / 2;
        let y1 = getY(line.y1);
        const x2 = line.x2 * CELL_WIDTH + CELL_WIDTH / 2;
        let y2 = getY(line.y2);

        // Stop the stem at the triangle base so its round cap cannot blunt the tip.
        if (line.isLongDistance && line.targetCommitHash) {
            if (line.arrowDirection === 'down') y2 -= ARROW_HEIGHT;
            else y1 += ARROW_HEIGHT;
        }

        if (line.x1 === line.x2) {
            return `M ${x1} ${y1} L ${x2} ${y2}`;
        }

        const dy = y2 - y1;
        return `M ${x1} ${y1} C ${x1} ${y1 + dy / 2}, ${x2} ${y2 - dy / 2}, ${x2} ${y2}`;
    };

    const renderArrow = (line: GraphLine, index: number) => {
        if (!line.isLongDistance || !line.targetCommitHash) return null;

        const isDown = line.arrowDirection === 'down';

        // Arrow at the end of line
        const x = (isDown ? line.x2 : line.x1) * CELL_WIDTH + CELL_WIDTH / 2;
        const arrowY = getY(isDown ? line.y2 : line.y1);

        const baseY = arrowY + (isDown ? -ARROW_HEIGHT : ARROW_HEIGHT);
        const arrowPath = `M ${x} ${arrowY} L ${x - ARROW_HALF_WIDTH} ${baseY} L ${x + ARROW_HALF_WIDTH} ${baseY} Z`;
        const hitAreaY = Math.max(0, Math.min(arrowY, baseY) - ARROW_HIT_PADDING);
        // Leave the area below a down arrow available to an edge reusing its column.
        const hitAreaBottom = Math.min(svgHeight, Math.max(arrowY, baseY) + (isDown ? 0 : ARROW_HIT_PADDING));
        const hitAreaHeight = hitAreaBottom - hitAreaY;
        const isArrowHovered = hoveredArrowIndex === index;

        return (
            <g
                key={`arrow-${index}`}
                data-arrow-target={line.targetCommitHash}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredArrowIndex(index)}
                onMouseLeave={() => setHoveredArrowIndex(null)}
                onClick={(e) => {
                    e.stopPropagation();
                    onJumpToCommit?.(line.targetCommitHash!);
                }}
            >
                {isArrowHovered && (
                    <rect
                        x={x - CELL_WIDTH / 2 + 0.5}
                        y={hitAreaY + 0.5}
                        width={CELL_WIDTH - 1}
                        height={hitAreaHeight - 1}
                        pointerEvents="none"
                        rx={3}
                        fill={line.color}
                        fillOpacity={0.12}
                        stroke={line.color}
                        strokeOpacity={0.75}
                        strokeWidth={1}
                    />
                )}
                {/* Larger hit area */}
                <rect
                    x={x - CELL_WIDTH / 2}
                    y={hitAreaY}
                    width={CELL_WIDTH}
                    height={hitAreaHeight}
                    fill="transparent"
                    pointerEvents="all"
                />
                {/* Filled triangle arrow */}
                <path
                    d={arrowPath}
                    fill={line.color}
                    stroke="none"
                    pointerEvents="none"
                />
            </g>
        );
    };

    return (
        <svg width={graphWidth} height={svgHeight} style={{ overflow: 'visible', pointerEvents: 'auto' }}>
            {node.lines.map((line, i) => (
                <path
                    key={i}
                    d={getPath(line)}
                    stroke={line.color}
                    strokeWidth={getLineStrokeWidth(line)}
                    fill="none"
                    pointerEvents="none"
                    strokeLinecap={line.isDashed ? 'butt' : 'round'}
                    strokeDasharray={line.isDashed ? '2 3' : undefined}
                    strokeDashoffset={line.isDashed ? ((rowTop ?? rowIndex * rowHeight) + getY(line.y1)) % 5 : undefined}
                />
            ))}
            <circle
                cx={node.column * CELL_WIDTH + CELL_WIDTH / 2}
                cy={dotY}
                r={DOT_RADIUS}
                fill={node.color}
                stroke={getStrokeColor(isSelected, isHovered, hasFocus)}
                strokeWidth={STROKE_WIDTH}
            />
            {node.lines.map(renderArrow)}
        </svg>
    );
};
