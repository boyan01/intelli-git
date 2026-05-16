import React from 'react';
import type { GraphNode, GraphLine } from './graphUtils';

interface GraphColumnProps {
    node: GraphNode;
    rowHeight: number;
    graphWidth: number;
    rowIndex: number;
    onJumpToCommit?: (hash: string) => void;
    isSelected?: boolean;
    isHovered?: boolean;
    hasFocus?: boolean;
    isExpanded?: boolean;
}

export const CELL_WIDTH = 16;

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
    graphWidth,
    rowIndex,
    onJumpToCommit,
    isSelected = false,
    isHovered = false,
    hasFocus = false,
    isExpanded = false
}) => {
    const DOT_RADIUS = isExpanded ? 6 : 5;
    const STROKE_WIDTH = isExpanded ? 4 : 3;
    const [hoveredArrowIndex, setHoveredArrowIndex] = React.useState<number | null>(null);
    const getLineStrokeWidth = (line: GraphLine) => {
        if (!isExpanded) return 2;
        return line.x1 === node.column || line.x2 === node.column ? 3 : 2;
    };

    const getPath = (line: GraphLine) => {
        const x1 = line.x1 * CELL_WIDTH + CELL_WIDTH / 2;
        const y1 = line.y1 * rowHeight;
        const x2 = line.x2 * CELL_WIDTH + CELL_WIDTH / 2;
        const y2 = line.y2 * rowHeight;

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
        const arrowY = (isDown ? line.y2 : line.y1) * rowHeight;

        // Triangle arrow - filled for better visibility
        const arrowSize = 5;
        const arrowPath = isDown
            ? `M ${x} ${arrowY} L ${x - arrowSize} ${arrowY - arrowSize * 1.5} L ${x + arrowSize} ${arrowY - arrowSize * 1.5} Z`
            : `M ${x} ${arrowY} L ${x - arrowSize} ${arrowY + arrowSize * 1.5} L ${x + arrowSize} ${arrowY + arrowSize * 1.5} Z`;
        const hitAreaY = isDown ? arrowY - 15 : arrowY;
        const isArrowHovered = hoveredArrowIndex === index;

        return (
            <g
                key={`arrow-${index}`}
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
                        x={x - 9}
                        y={hitAreaY + 1}
                        width={18}
                        height={13}
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
                    x={x - 10}
                    y={hitAreaY}
                    width={20}
                    height={15}
                    fill="transparent"
                />
                {/* Filled triangle arrow */}
                <path
                    d={arrowPath}
                    fill={line.color}
                    stroke={isArrowHovered ? 'var(--vscode-focusBorder)' : line.color}
                    strokeWidth={isArrowHovered ? 2 : 1}
                    strokeLinejoin="round"
                />
            </g>
        );
    };

    return (
        <svg width={graphWidth} height={rowHeight} style={{ overflow: 'visible', pointerEvents: 'auto' }}>
            {node.lines.map((line, i) => (
                <React.Fragment key={i}>
                    <path
                        d={getPath(line)}
                        stroke={line.color}
                        strokeWidth={getLineStrokeWidth(line)}
                        fill="none"
                        strokeLinecap={line.isDashed ? 'butt' : 'round'}
                        strokeDasharray={line.isDashed ? '2 3' : undefined}
                        strokeDashoffset={line.isDashed ? ((rowIndex + line.y1) * rowHeight) % 5 : undefined}
                    />
                    {renderArrow(line, i)}
                </React.Fragment>
            ))}
            <circle
                cx={node.column * CELL_WIDTH + CELL_WIDTH / 2}
                cy={rowHeight / 2}
                r={DOT_RADIUS}
                fill={node.color}
                stroke={getStrokeColor(isSelected, isHovered, hasFocus)}
                strokeWidth={STROKE_WIDTH}
            />
        </svg>
    );
};
