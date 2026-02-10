/**
 * Control mode selector — Orchestrator / Adaptive / Ecosystem.
 *
 * The two philosophies of control from the blog post, plus an adaptive
 * middle ground. Includes pending system recommendations for mode shifts.
 */

import { Check, X } from 'lucide-react'
import type { ControlMode } from '../../types/index.js'
import type { ModeShiftRecommendation } from '../../types/index.js'
import { useProjectDispatch } from '../../lib/context.js'

interface ModeSelectorProps {
  currentMode: ControlMode
  recommendations: ModeShiftRecommendation[]
}

const modeDescriptions: Record<ControlMode, { title: string; desc: string }> = {
  orchestrator: {
    title: 'Orchestrator',
    desc: 'Human retains directive control. Review every output.',
  },
  adaptive: {
    title: 'Adaptive',
    desc: 'System shifts between modes based on project signals.',
  },
  ecosystem: {
    title: 'Ecosystem',
    desc: 'Set direction and boundaries. Agents self-organize.',
  },
}

const modes: ControlMode[] = ['orchestrator', 'adaptive', 'ecosystem']

export default function ModeSelector({ currentMode, recommendations }: ModeSelectorProps) {
  const dispatch = useProjectDispatch()
  const pending = recommendations.filter(r => r.status === 'pending')

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
        Control Mode
      </h2>

      <div className="space-y-2">
        {modes.map((mode) => {
          const { title, desc } = modeDescriptions[mode]
          const isActive = mode === currentMode
          return (
            <button
              key={mode}
              onClick={() => dispatch({ type: 'set-mode', mode })}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                isActive
                  ? 'bg-accent/10 border-accent/30 text-text-primary'
                  : 'bg-surface-1 border-border hover:border-border-light text-text-secondary'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${isActive ? 'text-accent' : ''}`}>
                  {title}
                </span>
                {isActive && (
                  <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                    active
                  </span>
                )}
              </div>
              <div className="text-xs text-text-muted mt-0.5">{desc}</div>
            </button>
          )
        })}
      </div>

      {/* Pending recommendations */}
      {pending.map((rec) => (
        <div
          key={rec.id}
          className="p-3 rounded-lg bg-info/5 border border-info/20 space-y-2"
        >
          <div className="text-xs font-medium text-info">System Recommendation</div>
          <p className="text-sm text-text-secondary">{rec.rationale}</p>
          <div className="flex gap-2">
            <button
              onClick={() => dispatch({ type: 'accept-recommendation', recommendationId: rec.id })}
              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-info/10 text-info rounded hover:bg-info/20 transition-colors"
            >
              <Check size={12} /> Accept
            </button>
            <button
              onClick={() => dispatch({ type: 'reject-recommendation', recommendationId: rec.id })}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-text-muted rounded hover:bg-surface-2 transition-colors"
            >
              <X size={12} /> Dismiss
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}
