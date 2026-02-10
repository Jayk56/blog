/**
 * Knowledge Map — tagged card grid for Rosa's research exploration.
 *
 * Uses the card grid fallback (per PLAN.md) rather than a full
 * concept graph visualization.
 */

import { Lightbulb, FileText, BookOpen } from 'lucide-react'
import type { Artifact } from '../../types/index.js'
import { useProjectState } from '../../lib/context.js'

interface Props {
  onSelectArtifact: (artifact: Artifact) => void
}

export default function KnowledgeMap({ onSelectArtifact }: Props) {
  const state = useProjectState()

  if (!state.project) return null

  // Group artifacts by workstream for the knowledge view
  const workstreams = state.project.workstreams
  const artifactsByWorkstream = new Map<string, Artifact[]>()

  for (const a of state.artifacts) {
    const list = artifactsByWorkstream.get(a.workstreamId) ?? []
    list.push(a)
    artifactsByWorkstream.set(a.workstreamId, list)
  }

  // Find cross-cutting connections (artifacts that share decision references)
  const crossCutting = state.decisions.filter(
    (d) => d.relatedWorkstreamIds.length > 1 && !d.resolved,
  )

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

      {/* Knowledge clusters by workstream */}
      {Array.from(artifactsByWorkstream.entries()).map(([wsId, artifacts]) => {
        const ws = workstreams.find((w) => w.id === wsId)
        if (!ws) return null

        return (
          <div key={wsId}>
            <h3 className="text-xs uppercase text-text-muted mb-3 flex items-center gap-1.5">
              <BookOpen size={12} />
              {ws.name}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  onClick={() => onSelectArtifact(artifact)}
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
  )
}
