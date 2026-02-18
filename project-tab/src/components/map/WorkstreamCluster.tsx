/**
 * WorkstreamCluster — SVG rect background for grouping artifacts by workstream.
 *
 * Renders a translucent rounded rectangle with a dashed border and
 * the workstream name as a label in the top-left corner.
 */

interface Props {
  label: string
  x: number
  y: number
  width: number
  height: number
  colorIndex: number
}

/** Cycling cluster fill colors — very translucent. */
const CLUSTER_FILLS = [
  'rgba(99, 102, 241, 0.05)',   // indigo
  'rgba(34, 197, 94, 0.05)',    // green
  'rgba(59, 130, 246, 0.05)',   // blue
  'rgba(245, 158, 11, 0.05)',   // amber
]

/** Cycling cluster stroke colors. */
const CLUSTER_STROKES = [
  'rgba(99, 102, 241, 0.2)',
  'rgba(34, 197, 94, 0.2)',
  'rgba(59, 130, 246, 0.2)',
  'rgba(245, 158, 11, 0.2)',
]

export default function WorkstreamCluster({ label, x, y, width, height, colorIndex }: Props) {
  const fill = CLUSTER_FILLS[colorIndex % CLUSTER_FILLS.length]
  const stroke = CLUSTER_STROKES[colorIndex % CLUSTER_STROKES.length]

  return (
    <g data-testid={`workstream-cluster-${label}`}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={8}
        ry={8}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
        strokeDasharray="6 3"
      />
      <text
        x={x + 10}
        y={y + 16}
        fontSize={10}
        fill="#7a7a8a"
        fontFamily="Inter, system-ui, sans-serif"
        style={{ textTransform: 'uppercase' }}
      >
        {label}
      </text>
    </g>
  )
}
