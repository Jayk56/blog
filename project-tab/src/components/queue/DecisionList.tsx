/**
 * Decision list — left panel of the Decision Queue workspace.
 * Shows pending decisions sorted by attention priority.
 */

import { AlertTriangle, Clock, Target } from 'lucide-react'
import type { DecisionItem, Severity } from '../../types/index.js'

interface Props {
  decisions: DecisionItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  currentTick: number
}

const severityColor: Record<Severity, string> = {
  critical: 'bg-danger text-white',
  high: 'bg-warning/80 text-surface-0',
  medium: 'bg-info/60 text-white',
  low: 'bg-surface-3 text-text-secondary',
  info: 'bg-surface-2 text-text-muted',
}

export default function DecisionList({ decisions, selectedId, onSelect, currentTick }: Props) {
  const pending = decisions
    .filter((d) => !d.resolved)
    .sort((a, b) => b.attentionScore - a.attentionScore)

  if (pending.length === 0) {
    return (
      <div className="p-6 text-center text-text-muted">
        <p className="text-lg mb-2">Queue is clear</p>
        <p className="text-xs">
          {decisions.filter((d) => d.resolved).length} decisions resolved
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-border text-xs text-text-muted">
        {pending.length} pending &middot; sorted by priority
      </div>

      {pending.map((d) => {
        const isOverdue = d.dueByTick !== null && d.dueByTick <= currentTick
        const isSelected = d.id === selectedId

        return (
          <button
            key={d.id}
            onClick={() => onSelect(d.id)}
            className={`w-full text-left px-3 py-3 border-b border-border transition-colors ${
              isSelected
                ? 'bg-accent/10 border-l-2 border-l-accent'
                : 'hover:bg-surface-2 border-l-2 border-l-transparent'
            }`}
          >
            {/* Title + severity badge */}
            <div className="flex items-start gap-2 mb-1.5">
              <span
                className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${severityColor[d.severity]}`}
              >
                {d.severity}
              </span>
              <span className="text-sm text-text-primary line-clamp-2 leading-tight">
                {d.title}
              </span>
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-3 text-[11px] text-text-muted">
              {/* Confidence */}
              <span className="flex items-center gap-1">
                <div className="w-12 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full"
                    style={{ width: `${d.confidence * 100}%` }}
                  />
                </div>
                {Math.round(d.confidence * 100)}%
              </span>

              {/* Blast radius */}
              <span className="flex items-center gap-0.5" title={`Blast radius: ${d.blastRadius.magnitude}`}>
                <Target size={10} />
                {d.blastRadius.magnitude}
              </span>

              {/* Due / overdue */}
              {d.dueByTick !== null && (
                <span
                  className={`flex items-center gap-0.5 ${isOverdue ? 'text-danger font-medium' : ''}`}
                >
                  {isOverdue ? <AlertTriangle size={10} /> : <Clock size={10} />}
                  {isOverdue ? 'overdue' : `T${d.dueByTick}`}
                </span>
              )}

              {/* Attention score */}
              <span className="ml-auto tabular-nums" title="Attention priority score (0-100)">
                <span className="text-text-muted font-normal">pri </span>{d.attentionScore}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
