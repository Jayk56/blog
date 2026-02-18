/**
 * Knowledge Map — interactive DAG visualization of artifact dependencies.
 *
 * Uses a custom topological layout algorithm to arrange artifacts in a
 * dependency graph grouped by workstream. Falls back to the original
 * card grid when no dependency edges exist among visible artifacts.
 */

import { useState, useMemo } from 'react'
import { Lightbulb, FileText, BookOpen } from 'lucide-react'
import type { Artifact, Workstream } from '../../types/index.js'
import { useProjectState, useEffectiveTick } from '../../lib/context.js'
import ArtifactNode from './ArtifactNode.js'
import DependencyEdge from './DependencyEdge.js'
import WorkstreamCluster from './WorkstreamCluster.js'

interface Props {
  onSelectArtifact: (artifact: Artifact) => void
}

// ── Layout constants ─────────────────────────────────────────────

const NODE_WIDTH = 180
const NODE_HEIGHT = 60
const NODE_H_GAP = 40  // horizontal gap between nodes
const NODE_V_GAP = 60  // vertical gap between ranks
const CLUSTER_PADDING = 24
const CLUSTER_LABEL_HEIGHT = 24
const GRAPH_MARGIN = 20

// ── Layout types ─────────────────────────────────────────────────

interface LayoutNode {
  id: string
  artifact: Artifact
  x: number
  y: number
  rank: number
  workstreamId: string
}

interface LayoutEdge {
  sourceId: string
  targetId: string
  points: Array<{ x: number; y: number }>
}

interface ClusterLayout {
  workstreamId: string
  label: string
  x: number
  y: number
  width: number
  height: number
  colorIndex: number
}

interface GraphLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  clusters: ClusterLayout[]
  width: number
  height: number
}

// ── DAG layout algorithm ─────────────────────────────────────────

/**
 * Compute a simple top-to-bottom DAG layout.
 *
 * Algorithm:
 * 1. Build adjacency from sourceArtifactIds (source -> target edges)
 * 2. Assign ranks via longest-path from roots
 * 3. Group nodes by workstream, then position within ranks
 * 4. Compute cluster bounding boxes
 * 5. Generate edge paths between node centers
 */
function computeLayout(
  artifacts: Artifact[],
  workstreams: Workstream[],
): GraphLayout {
  const artifactMap = new Map(artifacts.map((a) => [a.id, a]))

  // Build edges: source -> this artifact (source is dependency)
  const edges: Array<{ source: string; target: string }> = []
  for (const a of artifacts) {
    for (const srcId of a.provenance.sourceArtifactIds) {
      if (artifactMap.has(srcId)) {
        edges.push({ source: srcId, target: a.id })
      }
    }
  }

  // Assign ranks via longest path from roots (nodes with no incoming edges)
  const inDegree = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const a of artifacts) {
    inDegree.set(a.id, 0)
    children.set(a.id, [])
  }
  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
    children.get(e.source)?.push(e.target)
  }

  // BFS from roots to assign ranks (longest path)
  const rank = new Map<string, number>()
  const queue: string[] = []
  for (const a of artifacts) {
    if ((inDegree.get(a.id) ?? 0) === 0) {
      rank.set(a.id, 0)
      queue.push(a.id)
    }
  }

  // Handle case where all nodes are in cycles (shouldn't happen with artifact deps, but be safe)
  if (queue.length === 0 && artifacts.length > 0) {
    for (const a of artifacts) {
      rank.set(a.id, 0)
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    const nodeRank = rank.get(nodeId) ?? 0
    for (const childId of children.get(nodeId) ?? []) {
      const currentRank = rank.get(childId)
      const newRank = nodeRank + 1
      if (currentRank === undefined || newRank > currentRank) {
        rank.set(childId, newRank)
      }
      // Add to queue if all parents have been processed
      const parentEdges = edges.filter((e) => e.target === childId)
      const allParentsRanked = parentEdges.every((e) => rank.has(e.source))
      if (allParentsRanked && !queue.includes(childId)) {
        queue.push(childId)
      }
    }
  }

  // Group artifacts by workstream
  const artifactsByWs = new Map<string, Artifact[]>()
  for (const a of artifacts) {
    const list = artifactsByWs.get(a.workstreamId) ?? []
    list.push(a)
    artifactsByWs.set(a.workstreamId, list)
  }

  // Get unique workstream IDs that have artifacts, in the order they appear in workstreams array
  const activeWsIds = workstreams
    .filter((ws) => artifactsByWs.has(ws.id))
    .map((ws) => ws.id)

  // Position nodes: arrange workstreams side by side, nodes within workstream by rank
  const wsOffsets = new Map<string, number>()
  let currentX = GRAPH_MARGIN

  // For each workstream, figure out how many columns it needs (max nodes at any rank)
  for (const wsId of activeWsIds) {
    const wsArtifacts = artifactsByWs.get(wsId) ?? []
    wsOffsets.set(wsId, currentX)

    // Width = max nodes at any rank * (NODE_WIDTH + gap) + cluster padding
    const rankCounts = new Map<number, number>()
    for (const a of wsArtifacts) {
      const r = rank.get(a.id) ?? 0
      rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1)
    }
    const maxNodesInRank = Math.max(1, ...Array.from(rankCounts.values()))
    const wsWidth = maxNodesInRank * (NODE_WIDTH + NODE_H_GAP) - NODE_H_GAP + CLUSTER_PADDING * 2
    currentX += wsWidth + NODE_H_GAP
  }

  // Position individual nodes
  const layoutNodes: LayoutNode[] = []
  const nodePositions = new Map<string, { x: number; y: number }>()

  for (const wsId of activeWsIds) {
    const wsArtifacts = artifactsByWs.get(wsId) ?? []
    const wsX = wsOffsets.get(wsId) ?? 0

    // Group by rank
    const byRank = new Map<number, Artifact[]>()
    for (const a of wsArtifacts) {
      const r = rank.get(a.id) ?? 0
      const list = byRank.get(r) ?? []
      list.push(a)
      byRank.set(r, list)
    }

    for (const [r, rankedArtifacts] of byRank.entries()) {
      for (let i = 0; i < rankedArtifacts.length; i++) {
        const a = rankedArtifacts[i]
        const x = wsX + CLUSTER_PADDING + i * (NODE_WIDTH + NODE_H_GAP)
        const y = GRAPH_MARGIN + CLUSTER_LABEL_HEIGHT + r * (NODE_HEIGHT + NODE_V_GAP)

        const node: LayoutNode = { id: a.id, artifact: a, x, y, rank: r, workstreamId: wsId }
        layoutNodes.push(node)
        nodePositions.set(a.id, { x, y })
      }
    }
  }

  // Compute cluster bounding boxes
  const clusters: ClusterLayout[] = []
  let colorIndex = 0
  for (const wsId of activeWsIds) {
    const ws = workstreams.find((w) => w.id === wsId)
    if (!ws) continue

    const wsNodes = layoutNodes.filter((n) => n.workstreamId === wsId)
    if (wsNodes.length === 0) continue

    const minX = Math.min(...wsNodes.map((n) => n.x)) - CLUSTER_PADDING
    const minY = Math.min(...wsNodes.map((n) => n.y)) - CLUSTER_PADDING - CLUSTER_LABEL_HEIGHT
    const maxX = Math.max(...wsNodes.map((n) => n.x + NODE_WIDTH)) + CLUSTER_PADDING
    const maxY = Math.max(...wsNodes.map((n) => n.y + NODE_HEIGHT)) + CLUSTER_PADDING

    clusters.push({
      workstreamId: wsId,
      label: ws.name,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      colorIndex: colorIndex++,
    })
  }

  // Generate edge paths
  const layoutEdges: LayoutEdge[] = edges.map((e) => {
    const srcPos = nodePositions.get(e.source)
    const tgtPos = nodePositions.get(e.target)
    if (!srcPos || !tgtPos) return { sourceId: e.source, targetId: e.target, points: [] }

    // Edge from bottom-center of source to top-center of target
    return {
      sourceId: e.source,
      targetId: e.target,
      points: [
        { x: srcPos.x + NODE_WIDTH / 2, y: srcPos.y + NODE_HEIGHT },
        { x: tgtPos.x + NODE_WIDTH / 2, y: tgtPos.y },
      ],
    }
  }).filter((e) => e.points.length > 0)

  // Compute overall dimensions
  const allX = layoutNodes.map((n) => n.x + NODE_WIDTH)
  const allY = layoutNodes.map((n) => n.y + NODE_HEIGHT)
  const graphWidth = allX.length > 0
    ? Math.max(...allX) + GRAPH_MARGIN
    : 400
  const graphHeight = allY.length > 0
    ? Math.max(...allY) + GRAPH_MARGIN
    : 300

  return { nodes: layoutNodes, edges: layoutEdges, clusters, width: graphWidth, height: graphHeight }
}

// ── Component ────────────────────────────────────────────────────

export default function KnowledgeMap({ onSelectArtifact }: Props) {
  const state = useProjectState()
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)

  const effectiveTick = useEffectiveTick()

  // Filter artifacts by tick
  const visibleArtifacts = useMemo(
    () => state.artifacts.filter((a) => a.provenance.producedAtTick <= effectiveTick),
    [state.artifacts, effectiveTick],
  )

  // Compute layout
  const layout = useMemo(() => {
    if (!state.project) return null
    return computeLayout(visibleArtifacts, state.project.workstreams)
  }, [visibleArtifacts, state.project])

  if (!state.project) return null

  const workstreams = state.project.workstreams

  // Group artifacts by workstream (for fallback grid)
  const artifactsByWorkstream = new Map<string, Artifact[]>()
  for (const a of visibleArtifacts) {
    const list = artifactsByWorkstream.get(a.workstreamId) ?? []
    list.push(a)
    artifactsByWorkstream.set(a.workstreamId, list)
  }

  // Cross-cutting decisions that span multiple workstreams and match tick filter.
  // Apply the same temporal masking as QueueWorkspace: a decision resolved in the
  // future (relative to effectiveTick) should still appear as unresolved.
  const crossCutting = state.decisions.filter((d) => {
    if (d.relatedWorkstreamIds.length <= 1) return false
    if (d.createdAtTick > effectiveTick) return false
    const isUnresolvedAtTick =
      !d.resolved ||
      (d.resolution?.resolvedAtTick != null && d.resolution.resolvedAtTick > effectiveTick)
    return isUnresolvedAtTick
  })

  // Determine if we should use graph or fallback to card grid
  const hasEdges = layout !== null && layout.edges.length > 0

  // Determine which edges are connected to the selected node
  const connectedEdgeSet = useMemo(() => {
    if (!selectedArtifactId || !layout) return new Set<string>()
    const connected = new Set<string>()
    for (const edge of layout.edges) {
      if (edge.sourceId === selectedArtifactId || edge.targetId === selectedArtifactId) {
        connected.add(`${edge.sourceId}->${edge.targetId}`)
      }
    }
    return connected
  }, [selectedArtifactId, layout])

  function handleNodeClick(artifact: Artifact) {
    setSelectedArtifactId((prev) => (prev === artifact.id ? null : artifact.id))
    onSelectArtifact(artifact)
  }

  return (
    <div className="space-y-6">
      {/* Cross-cutting patterns */}
      {crossCutting.length > 0 && (
        <div>
          <h3 className="text-xs uppercase text-text-muted mb-3 flex items-center gap-1.5">
            <Lightbulb size={12} />
            Cross-Cutting Patterns
          </h3>
          <div className="space-y-2">
            {crossCutting.map((d) => {
              const wsNames = d.relatedWorkstreamIds
                .map((id) => workstreams.find((ws) => ws.id === id)?.name ?? id)
                .join(' + ')
              return (
                <div
                  key={d.id}
                  className="p-3 bg-accent/5 border border-accent/20 rounded-lg"
                >
                  <div className="text-sm text-text-primary mb-1">{d.title}</div>
                  <div className="text-xs text-text-muted line-clamp-2 mb-2">{d.summary}</div>
                  <div className="text-[10px] text-accent">{wsNames}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Graph visualization or fallback card grid */}
      {hasEdges && layout ? (
        <div data-testid="knowledge-graph">
          <svg
            width="100%"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            style={{ minHeight: 200 }}
          >
            {/* Layer 1: Workstream clusters (background) */}
            {layout.clusters.map((cluster) => (
              <WorkstreamCluster
                key={cluster.workstreamId}
                label={cluster.label}
                x={cluster.x}
                y={cluster.y}
                width={cluster.width}
                height={cluster.height}
                colorIndex={cluster.colorIndex}
              />
            ))}

            {/* Layer 2: Dependency edges (middle) */}
            {layout.edges.map((edge) => {
              const edgeKey = `${edge.sourceId}->${edge.targetId}`
              return (
                <DependencyEdge
                  key={edgeKey}
                  points={edge.points}
                  highlighted={connectedEdgeSet.has(edgeKey)}
                />
              )
            })}

            {/* Layer 3: Artifact nodes (top) */}
            {layout.nodes.map((node) => (
              <ArtifactNode
                key={node.id}
                artifact={node.artifact}
                x={node.x}
                y={node.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                selected={node.id === selectedArtifactId}
                onClick={() => handleNodeClick(node.artifact)}
              />
            ))}
          </svg>
        </div>
      ) : (
        /* Fallback: card grid for scenarios without edges */
        <div data-testid="knowledge-card-grid">
          {Array.from(artifactsByWorkstream.entries()).map(([wsId, artifacts]) => {
            const ws = workstreams.find((w) => w.id === wsId)
            if (!ws) return null

            return (
              <div key={wsId} className="mb-6">
                <h3 className="text-xs uppercase text-text-muted mb-3 flex items-center gap-1.5">
                  <BookOpen size={12} />
                  {ws.name}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {artifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      onClick={() => handleNodeClick(artifact)}
                      className="text-left p-3 bg-surface-2 rounded-lg border border-border hover:bg-surface-3 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <FileText size={14} className="text-text-muted shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-sm text-text-primary truncate">{artifact.name}</div>
                          <div className="text-xs text-text-muted line-clamp-2 mt-0.5">
                            {artifact.description}
                          </div>
                          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-text-muted">
                            <span className="capitalize">{artifact.kind}</span>
                            <span>&middot;</span>
                            <span className={
                              artifact.status === 'approved'
                                ? 'text-success'
                                : artifact.status === 'needs_rework'
                                  ? 'text-danger'
                                  : ''
                            }>
                              {artifact.status.replace(/_/g, ' ')}
                            </span>
                            <span>&middot;</span>
                            <span>Q: {Math.round(artifact.qualityScore * 100)}%</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
