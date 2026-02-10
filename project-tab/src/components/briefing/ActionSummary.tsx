/**
 * Action summary card: shows counts of pending decisions and
 * open coherence issues with links to Queue and Map workspaces.
 */

import { Inbox, Map } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Metrics } from '../../types/index.js'

interface ActionSummaryProps {
  metrics: Metrics
}

export default function ActionSummary({ metrics }: ActionSummaryProps) {
  const { pendingDecisionCount, openCoherenceIssueCount, reworkRisk, coherenceScore } = metrics

  if (pendingDecisionCount === 0 && openCoherenceIssueCount === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <p className="text-success text-sm font-medium">All clear -- no items awaiting your attention.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4 space-y-3">
      <h3 className="text-base font-semibold text-text-primary">Action Required</h3>

      <div className="grid grid-cols-2 gap-3">
        {/* Decisions card */}
        <Link
          to="/queue"
          className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3 hover:border-accent/40 transition-colors"
        >
          <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0">
            <Inbox size={16} className="text-accent" />
          </div>
          <div>
            <span className="text-2xl font-bold text-text-primary leading-none">
              {pendingDecisionCount}
            </span>
            <p className="text-xs text-text-muted mt-0.5">
              {pendingDecisionCount === 1 ? 'decision' : 'decisions'} awaiting
            </p>
          </div>
        </Link>

        {/* Coherence issues card */}
        <Link
          to="/map"
          className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3 hover:border-accent/40 transition-colors"
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            openCoherenceIssueCount > 0 ? 'bg-warning/15' : 'bg-success/15'
          }`}>
            <Map size={16} className={openCoherenceIssueCount > 0 ? 'text-warning' : 'text-success'} />
          </div>
          <div>
            <span className="text-2xl font-bold text-text-primary leading-none">
              {openCoherenceIssueCount}
            </span>
            <p className="text-xs text-text-muted mt-0.5">
              coherence {openCoherenceIssueCount === 1 ? 'issue' : 'issues'}
            </p>
          </div>
        </Link>
      </div>

      {/* Quick stats bar */}
      <div className="flex gap-4 text-xs text-text-muted pt-1 border-t border-border">
        <span>Coherence: {coherenceScore}/100</span>
        <span>Rework risk: {reworkRisk}%</span>
      </div>
    </div>
  )
}
