/**
 * DependencyEdge — SVG path for rendering a dependency arrow between artifacts.
 *
 * Connects source artifact to target artifact through a series of line segments.
 * Highlighted edges use accent color when a connected node is selected.
 */

interface Props {
  points: Array<{ x: number; y: number }>
  highlighted: boolean
}

export default function DependencyEdge({ points, highlighted }: Props) {
  if (points.length < 2) return null

  // Build SVG path from points
  const [first, ...rest] = points
  const d = `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ')

  // Unique marker ID based on highlight state to avoid conflicts
  const markerId = highlighted ? 'arrow-highlight' : 'arrow-normal'

  return (
    <g data-testid="dependency-edge">
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 7"
          refX="9"
          refY="3.5"
          markerWidth={8}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path
            d="M 0 0 L 10 3.5 L 0 7 z"
            fill={highlighted ? '#6366f1' : '#6b7280'}
          />
        </marker>
      </defs>
      <path
        d={d}
        fill="none"
        stroke={highlighted ? '#6366f1' : '#6b7280'}
        strokeWidth={highlighted ? 2 : 1.5}
        opacity={highlighted ? 1.0 : 0.6}
        markerEnd={`url(#${markerId})`}
      />
    </g>
  )
}
