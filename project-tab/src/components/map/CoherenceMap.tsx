/**
 * Coherence Map — structured list view of workstreams, agents,
 * and the coherence issues between them.
 *
 * Uses the card fallback approach (per PLAN.md open question #1)
 * rather than a full graph visualization library.
 */

import { useMemo } from 'react'
import { Circle, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import type { CoherenceIssue, Workstream, Severity } from '../../types/index.js'
import { useProjectState, useEffectiveTick } from '../../lib/context.js'

interface Props {
  onSelectIssue: (issue: CoherenceIssue) => void
  onSelectWorkstream: (workstream: Workstream) => void
}

const statusColor: Record<string, string> = {
  detected: 'text-danger',
  confirmed: 'text-warning',
  in_progress: 'text-warning',
  resolved: 'text-success',
  accepted: 'text-text-muted',
  dismissed: 'text-text-muted',
}

const statusIcon: Record<string, typeof AlertTriangle> = {
  detected: AlertTriangle,
  confirmed: AlertTriangle,
  in_progress: Circle,
  resolved: CheckCircle,
  accepted: CheckCircle,
  dismissed: XCircle,
}

const severityBorder: Record<Severity, string> = {
  critical: 'border-l-danger',
  high: 'border-l-warning',
  medium: 'border-l-info',
  low: 'border-l-border-light',
  info: 'border-l-border',
}

export default function CoherenceMap({ onSelectIssue, onSelectWorkstream }: Props) {
  const state = useProjectState()
  const effectiveTick = useEffectiveTick()

  // Filter issues by effectiveTick: only show issues detected at or before the viewed tick.
  // For issues resolved after effectiveTick, mask them as active (not yet resolved).
  const tickFilteredIssues = useMemo(() => {
    return state.coherenceIssues
      .filter((i) => i.detectedAtTick <= effectiveTick)
      .map((i) => {
        if (i.resolvedAtTick !== null && i.resolvedAtTick > effectiveTick) {
          // Mask resolved status back to the pre-resolution status
          const activeStatus = i.status === 'resolved' || i.status === 'accepted' || i.status === 'dismissed'
            ? 'detected' as const
            : i.status
          return { ...i, status: activeStatus, resolvedAtTick: null }
        }
        return i
      })
  }, [state.coherenceIssues, effectiveTick])

  if (!state.project) return null

  const workstreams = state.project.workstreams
  const issues = tickFilteredIssues
  const activeIssues = issues.filter(
    (i) => i.status === 'detected' || i.status === 'confirmed' || i.status === 'in_progress',
  )

  return (
    <div className="space-y-6">
      {/* Coherence overview */}
      <div className="flex items-center gap-4 p-4 bg-surface-2 rounded-lg">
        <div>
          <div className="text-2xl font-bold text-text-primary">
            {state.metrics.coherenceScore}
          </div>
          <div className="text-[10px] uppercase text-text-muted">Coherence Score</div>
        </div>
        <div className="h-8 w-px bg-border" />
        <div className="flex gap-4 text-xs text-text-muted">
          <span>{activeIssues.length} active issues</span>
          <span>{issues.filter((i) => i.status === 'resolved').length} resolved</span>
          <span>{workstreams.length} workstreams</span>
        </div>
      </div>

      {/* Active coherence issues */}
      {activeIssues.length > 0 && (
        <div>
          <h3 className="text-xs uppercase text-text-muted mb-3">Active Issues</h3>
          <div className="space-y-2">
            {activeIssues
              .sort((a, b) => {
                const sev = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
                return (sev[a.severity] ?? 4) - (sev[b.severity] ?? 4)
              })
              .map((issue) => {
                const StatusIcon = statusIcon[issue.status] ?? Circle
                return (
                  <button
                    key={issue.id}
                    onClick={() => onSelectIssue(issue)}
                    className={`w-full text-left p-3 bg-surface-2 rounded-lg border-l-2 ${severityBorder[issue.severity]} hover:bg-surface-3 transition-colors`}
                  >
                    <div className="flex items-start gap-2">
                      <StatusIcon size={14} className={`mt-0.5 shrink-0 ${statusColor[issue.status]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text-primary mb-0.5">{issue.title}</div>
                        <div className="text-xs text-text-muted line-clamp-2">{issue.description}</div>
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-text-muted">
                          <span className="capitalize">{issue.category.replace(/_/g, ' ')}</span>
                          <span>&middot;</span>
                          <span className="capitalize">{issue.severity}</span>
                          <span>&middot;</span>
                          <span>
                            {issue.workstreamIds.length} workstream{issue.workstreamIds.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
          </div>
        </div>
      )}

      {/* Workstream health grid */}
      <div>
        <h3 className="text-xs uppercase text-text-muted mb-3">Workstreams</h3>
        <div className="grid grid-cols-2 gap-2">
          {workstreams.map((ws) => {
            const wsIssues = activeIssues.filter((i) => i.workstreamIds.includes(ws.id))
            const hasIssues = wsIssues.length > 0
            const hasCritical = wsIssues.some((i) => i.severity === 'critical' || i.severity === 'high')

            const agents = state.project!.agents.filter((a) => ws.agentIds.includes(a.id))

            return (
              <button
                key={ws.id}
                onClick={() => onSelectWorkstream(ws)}
                className={`text-left p-3 rounded-lg border transition-colors ${
                  hasCritical
                    ? 'border-danger/40 bg-danger/5 hover:bg-danger/10'
                    : hasIssues
                      ? 'border-warning/40 bg-warning/5 hover:bg-warning/10'
                      : 'border-border bg-surface-2 hover:bg-surface-3'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-text-primary">{ws.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${
                      ws.status === 'active'
                        ? 'bg-success/15 text-success'
                        : ws.status === 'blocked'
                          ? 'bg-danger/15 text-danger'
                          : ws.status === 'complete'
                            ? 'bg-surface-3 text-text-muted'
                            : 'bg-surface-3 text-text-muted'
                    }`}
                  >
                    {ws.status}
                  </span>
                </div>
                <div className="text-xs text-text-muted mb-2">{ws.description}</div>
                <div className="flex items-center gap-2 text-[10px] text-text-muted">
                  <span>{agents.map((a) => a.name).join(', ')}</span>
                  {wsIssues.length > 0 && (
                    <>
                      <span>&middot;</span>
                      <span className={hasCritical ? 'text-danger' : 'text-warning'}>
                        {wsIssues.length} issue{wsIssues.length !== 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Resolved issues (collapsed) */}
      {issues.filter((i) => i.status === 'resolved' || i.status === 'accepted' || i.status === 'dismissed').length > 0 && (
        <div>
          <h3 className="text-xs uppercase text-text-muted mb-3">Resolved Issues</h3>
          <div className="space-y-1">
            {issues
              .filter((i) => i.status === 'resolved' || i.status === 'accepted' || i.status === 'dismissed')
              .map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted"
                >
                  <CheckCircle size={12} className="text-success/50" />
                  <span className="line-through">{issue.title}</span>
                  <span className="capitalize ml-auto">{issue.status}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
