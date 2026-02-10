/**
 * Decision Queue workspace — master-detail layout for decision triage.
 *
 * "The decision queue is the heart of human-agent coordination."
 */

import { useState, useEffect, useMemo } from 'react'
import { useProjectState } from '../../lib/context.js'
import DecisionList from './DecisionList.js'
import DecisionDetail from './DecisionDetail.js'
import ProvenanceDrawer from './ProvenanceDrawer.js'
import { Inbox } from 'lucide-react'

export default function QueueWorkspace() {
  const state = useProjectState()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [provenanceArtifactId, setProvenanceArtifactId] = useState<string | null>(null)

  const pendingDecisions = useMemo(
    () => state.decisions.filter((d) => !d.resolved).sort((a, b) => b.attentionScore - a.attentionScore),
    [state.decisions],
  )

  const selectedDecision = state.decisions.find((d) => d.id === selectedId)

  // Auto-advance selection when the selected decision gets resolved
  useEffect(() => {
    if (selectedId && selectedDecision?.resolved && pendingDecisions.length > 0) {
      setSelectedId(pendingDecisions[0].id)
    }
  }, [selectedId, selectedDecision?.resolved, pendingDecisions])

  if (!state.project) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        No project loaded
      </div>
    )
  }

  const effectiveSelection =
    selectedDecision && !selectedDecision.resolved
      ? selectedDecision
      : pendingDecisions[0] ?? null

  return (
    <div className="flex h-full -m-6">
      {/* Left panel — decision list */}
      <div className="w-80 flex-shrink-0 border-r border-border overflow-y-auto bg-surface-1">
        <DecisionList
          decisions={state.decisions}
          selectedId={effectiveSelection?.id ?? null}
          onSelect={setSelectedId}
          currentTick={state.project.currentTick}
        />
      </div>

      {/* Right panel — decision detail */}
      <div className="flex-1 overflow-y-auto">
        {effectiveSelection ? (
          <DecisionDetail
            decision={effectiveSelection}
            onOpenProvenance={setProvenanceArtifactId}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
            <Inbox size={48} strokeWidth={1} />
            <div className="text-center">
              <p className="text-lg mb-1">Queue is clear</p>
              <p className="text-xs">
                {state.decisions.filter((d) => d.resolved).length} decisions resolved
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Provenance drawer */}
      {provenanceArtifactId && (
        <ProvenanceDrawer
          artifactId={provenanceArtifactId}
          onClose={() => setProvenanceArtifactId(null)}
        />
      )}
    </div>
  )
}
