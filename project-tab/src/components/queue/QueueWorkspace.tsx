/**
 * Decision Queue workspace — master-detail layout for decision triage.
 *
 * "The decision queue is the heart of human-agent coordination."
 *
 * Manages filter state, batch selection state, and batch actions.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useProjectState, useProjectDispatch, useApi, useEffectiveTick } from '../../lib/context.js'
import DecisionList from './DecisionList.js'
import { applyFilters } from './DecisionList.js'
import type { QueueFilters } from './DecisionList.js'
import DecisionDetail from './DecisionDetail.js'
import ProvenanceDrawer from './ProvenanceDrawer.js'
import { Inbox, Check, X, AlertTriangle } from 'lucide-react'
import { adaptFrontendResolution } from '../../services/state-adapter.js'
import type { Severity } from '../../types/index.js'

/** Default filter state: all severities active, all types, hide resolved. */
function makeDefaultFilters(): QueueFilters {
  return {
    severities: new Set<Severity>(['critical', 'high', 'medium', 'low', 'info']),
    subtype: 'all',
    showResolved: false,
  }
}

export default function QueueWorkspace() {
  const state = useProjectState()
  const dispatch = useProjectDispatch()
  const api = useApi()
  const effectiveTick = useEffectiveTick()
  const isViewingHistory = state.viewingTick !== null
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [provenanceArtifactId, setProvenanceArtifactId] = useState<string | null>(null)
  const [filters, setFilters] = useState<QueueFilters>(makeDefaultFilters)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Filter decisions by effectiveTick: only show decisions created at or before the viewed tick.
  // For resolved decisions whose resolution happened after effectiveTick, mask as unresolved.
  const tickFilteredDecisions = useMemo(() => {
    return state.decisions
      .filter((d) => d.createdAtTick <= effectiveTick)
      .map((d) => {
        if (d.resolved && d.resolution && d.resolution.resolvedAtTick > effectiveTick) {
          return { ...d, resolved: false, resolution: null }
        }
        return d
      })
  }, [state.decisions, effectiveTick])

  const pendingDecisions = useMemo(
    () => tickFilteredDecisions.filter((d) => !d.resolved).sort((a, b) => b.attentionScore - a.attentionScore),
    [tickFilteredDecisions],
  )

  const selectedDecision = tickFilteredDecisions.find((d) => d.id === selectedId)

  // Auto-advance selection when the selected decision gets resolved
  useEffect(() => {
    if (selectedId && selectedDecision?.resolved && pendingDecisions.length > 0) {
      setSelectedId(pendingDecisions[0].id)
    }
  }, [selectedId, selectedDecision?.resolved, pendingDecisions])

  const filteredDecisions = useMemo(
    () => applyFilters(tickFilteredDecisions, filters).sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1
      return b.attentionScore - a.attentionScore
    }),
    [tickFilteredDecisions, filters],
  )

  // Prune selectedIds to only decisions currently visible in the filtered list.
  // This covers tick changes, filter changes, and resolution — any reason a decision
  // might leave the visible set.
  useEffect(() => {
    const visibleIds = new Set(filteredDecisions.map((d) => d.id))
    setSelectedIds((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        if (visibleIds.has(id)) next.add(id)
      }
      return next.size === prev.size ? prev : next
    })
  }, [filteredDecisions])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids))
  }, [])

  // Compute batch approval state
  const selectedDecisions = useMemo(
    () => tickFilteredDecisions.filter((d) => selectedIds.has(d.id)),
    [tickFilteredDecisions, selectedIds],
  )

  const hasRationaleRequired = useMemo(
    () => selectedDecisions.some((d) => !d.resolved && d.requiresRationale),
    [selectedDecisions],
  )

  function handleBatchApprove() {
    if (hasRationaleRequired) return

    for (const d of selectedDecisions) {
      if (d.resolved) continue

      // Find the recommended option, or fall back to the first option
      const recommended = d.options.find((o) => o.recommended) ?? d.options[0]
      if (!recommended) continue

      if (api) {
        const resolution = adaptFrontendResolution(
          recommended.id,
          recommended.actionKind,
          '',
          d.subtype,
        )

        api.resolveDecision(d.id, resolution).then(() => {
          dispatch({
            type: 'resolve-decision',
            decisionId: d.id,
            chosenOptionId: recommended.id,
            actionKind: recommended.actionKind,
            rationale: '',
          })
        }).catch((err) => {
          console.error('Failed to batch resolve decision:', err)
        })
      } else {
        dispatch({
          type: 'resolve-decision',
          decisionId: d.id,
          chosenOptionId: recommended.id,
          actionKind: recommended.actionKind,
          rationale: '',
        })
      }
    }

    setSelectedIds(new Set())
  }

  function handleClearSelection() {
    setSelectedIds(new Set())
  }

  if (!state.project) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        No project loaded
      </div>
    )
  }

  const filteredPending = filteredDecisions.filter((d) => !d.resolved)

  const effectiveSelection =
    selectedDecision && filteredDecisions.some((d) => d.id === selectedId)
      ? selectedDecision
      : filteredPending[0] ?? filteredDecisions[0] ?? null

  return (
    <div className="flex flex-col h-full -m-6">
      <div className="flex flex-1 min-h-0">
        {/* Left panel — decision list */}
        <div className="w-80 flex-shrink-0 border-r border-border overflow-y-auto bg-surface-1">
          <DecisionList
            decisions={tickFilteredDecisions}
            selectedId={effectiveSelection?.id ?? null}
            onSelect={setSelectedId}
            currentTick={effectiveTick}
            filters={filters}
            onFiltersChange={setFilters}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
          />
        </div>

        {/* Right panel — decision detail */}
        <div className="flex-1 overflow-y-auto">
          {effectiveSelection ? (
            <DecisionDetail
              decision={effectiveSelection}
              onOpenProvenance={setProvenanceArtifactId}
              effectiveTick={effectiveTick}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
              <Inbox size={48} strokeWidth={1} />
              <div className="text-center">
                <p className="text-lg mb-1">Queue is clear</p>
                <p className="text-xs">
                  {tickFilteredDecisions.filter((d) => d.resolved).length} decisions resolved
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

      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="sticky bottom-0 flex items-center gap-3 px-4 py-3 bg-surface-2 border-t border-border">
          <span className="text-sm text-text-primary font-medium">
            {selectedIds.size} selected
          </span>

          <div className="flex items-center gap-2 ml-auto">
            {hasRationaleRequired && (
              <span
                className="flex items-center gap-1 text-xs text-warning"
                title="Cannot batch approve: one or more selected decisions require a rationale"
              >
                <AlertTriangle size={12} />
                Rationale required
              </span>
            )}

            <button
              onClick={handleBatchApprove}
              disabled={hasRationaleRequired || isViewingHistory}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-accent text-white hover:bg-accent-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={isViewingHistory ? 'Cannot approve while viewing history' : hasRationaleRequired ? 'Cannot batch approve: one or more selected decisions require a rationale' : 'Approve all selected decisions with their recommended option'}
            >
              <Check size={12} />
              Approve Selected
            </button>

            <button
              onClick={handleClearSelection}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-surface-3 text-text-secondary hover:bg-border transition-colors"
            >
              <X size={12} />
              Clear Selection
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
