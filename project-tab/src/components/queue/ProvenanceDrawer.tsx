/**
 * Provenance drawer — slide-over panel showing artifact lineage.
 */

import { useEffect } from 'react'
import { X, FileText, User, Bot, Link } from 'lucide-react'
import { useProjectState } from '../../lib/context.js'

interface Props {
  artifactId: string
  onClose: () => void
}

export default function ProvenanceDrawer({ artifactId, onClose }: Props) {
  const state = useProjectState()
  const artifact = state.artifacts.find((a) => a.id === artifactId)

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!artifact) return null

  const provenance = artifact.provenance
  const producer = state.project?.agents.find((a) => a.id === provenance.producerAgentId)
  const validators = state.project?.agents.filter((a) =>
    provenance.validatorAgentIds.includes(a.id),
  )
  const sourceArtifacts = state.artifacts.filter((a) =>
    provenance.sourceArtifactIds.includes(a.id),
  )
  const relatedDecisions = state.decisions.filter((d) =>
    provenance.relatedDecisionIds.includes(d.id),
  )

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Artifact provenance">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      {/* Drawer */}
      <div className="relative w-96 bg-surface-1 border-l border-border overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">Provenance</h3>
          <button
            onClick={onClose}
            aria-label="Close provenance drawer"
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-2 text-text-muted"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Artifact info */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <FileText size={14} className="text-text-muted" />
              <span className="text-sm font-medium text-text-primary">{artifact.name}</span>
            </div>
            <p className="text-xs text-text-secondary">{artifact.description}</p>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted">
              <span className="capitalize">{artifact.kind}</span>
              <span className="capitalize">{artifact.status}</span>
              <span>Quality: {Math.round(artifact.qualityScore * 100)}%</span>
            </div>
          </div>

          {/* Producer */}
          <div>
            <h4 className="text-[10px] uppercase text-text-muted mb-2">Produced By</h4>
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-2 rounded">
              <Bot size={14} className="text-accent" />
              <span className="text-sm text-text-primary">{producer?.name ?? provenance.producerAgentId}</span>
              <span className="text-[10px] text-text-muted ml-auto">T{provenance.producedAtTick}</span>
            </div>
          </div>

          {/* Validators */}
          {validators && validators.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase text-text-muted mb-2">Validated By</h4>
              <div className="space-y-1">
                {validators.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 px-3 py-2 bg-surface-2 rounded">
                    <Bot size={14} className="text-info" />
                    <span className="text-sm text-text-primary">{v.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Human reviewer */}
          <div>
            <h4 className="text-[10px] uppercase text-text-muted mb-2">Human Reviewer</h4>
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-2 rounded">
              <User size={14} className={provenance.humanReviewerId ? 'text-success' : 'text-text-muted'} />
              <span className="text-sm text-text-primary">
                {provenance.humanReviewerId ?? 'Not yet reviewed'}
              </span>
            </div>
          </div>

          {/* Source artifacts */}
          {sourceArtifacts.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase text-text-muted mb-2">Source Inputs</h4>
              <div className="space-y-1">
                {sourceArtifacts.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 px-3 py-2 bg-surface-2 rounded">
                    <Link size={14} className="text-text-muted" />
                    <span className="text-sm text-text-primary">{a.name}</span>
                    <span className="text-[10px] text-text-muted ml-auto capitalize">{a.kind}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Related decisions */}
          {relatedDecisions.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase text-text-muted mb-2">Related Decisions</h4>
              <div className="space-y-1">
                {relatedDecisions.map((d) => (
                  <div key={d.id} className="px-3 py-2 bg-surface-2 rounded">
                    <span className="text-sm text-text-primary">{d.title}</span>
                    <span className={`text-[10px] ml-2 ${d.resolved ? 'text-success' : 'text-warning'}`}>
                      {d.resolved ? 'resolved' : 'pending'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
