/**
 * ArtifactNode — SVG group for rendering an artifact in the dependency graph.
 *
 * Displays: kind indicator (colored circle), status dot, truncated name,
 * and quality score. Selection highlights with accent border.
 */

import type { Artifact } from '../../types/index.js'

interface Props {
  artifact: Artifact
  x: number
  y: number
  width: number
  height: number
  selected: boolean
  onClick: () => void
}

/** Color mapping for artifact kinds. */
const KIND_COLORS: Record<string, string> = {
  code: '#60a5fa',
  document: '#34d399',
  design: '#f472b6',
  data: '#38bdf8',
  test: '#fbbf24',
  configuration: '#a78bfa',
  research: '#34d399',
  decision_record: '#a78bfa',
}

/** Color mapping for artifact status. */
const STATUS_COLORS: Record<string, string> = {
  approved: '#22c55e',
  needs_rework: '#ef4444',
  in_review: '#f59e0b',
  draft: '#6b7280',
  archived: '#4b5563',
}

export default function ArtifactNode({ artifact, x, y, width, height, selected, onClick }: Props) {
  const kindColor = KIND_COLORS[artifact.kind] ?? '#6b7280'
  const statusColor = STATUS_COLORS[artifact.status] ?? '#6b7280'
  const qualityPct = Math.round(artifact.qualityScore * 100)

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
      role="button"
      aria-label={`Artifact: ${artifact.name}`}
      data-testid={`artifact-node-${artifact.id}`}
    >
      {/* Background rect */}
      <rect
        width={width}
        height={height}
        rx={6}
        ry={6}
        fill="#1e1e2e"
        stroke={selected ? '#6366f1' : '#2a2a3a'}
        strokeWidth={selected ? 2 : 1}
      />

      {/* Kind indicator — colored circle top-left */}
      <circle
        cx={12}
        cy={12}
        r={4}
        fill={kindColor}
      />

      {/* Status dot — top-right */}
      <circle
        cx={width - 12}
        cy={12}
        r={3}
        fill={statusColor}
      />

      {/* Name text — full name for accessibility, visual overflow clipped by rect */}
      <text
        x={24}
        y={18}
        fontSize={12}
        fill="#e8e8f0"
        fontFamily="Inter, system-ui, sans-serif"
      >
        {artifact.name}
      </text>

      {/* Quality score */}
      <text
        x={12}
        y={height - 10}
        fontSize={10}
        fill="#7a7a8a"
        fontFamily="Inter, system-ui, sans-serif"
      >
        Q: {qualityPct}%
      </text>

      {/* Status label */}
      <text
        x={width - 12}
        y={height - 10}
        fontSize={10}
        fill="#7a7a8a"
        fontFamily="Inter, system-ui, sans-serif"
        textAnchor="end"
      >
        {artifact.status.replace(/_/g, ' ')}
      </text>
    </g>
  )
}
