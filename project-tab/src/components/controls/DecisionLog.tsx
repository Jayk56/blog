/**
 * Decision log — timestamped history of all decisions in the Controls workspace.
 *
 * Supports reversal of reversible decisions, retroactive review flagging,
 * and context injection.
 */

import { useState } from 'react'
import { RotateCcw, Flag, MessageSquarePlus } from 'lucide-react'
import type { DecisionLogEntry, DecisionItem } from '../../types/index.js'
import { useProjectDispatch } from '../../lib/context.js'

interface DecisionLogProps {
  entries: DecisionLogEntry[]
  decisions: DecisionItem[]
}

export default function DecisionLog({ entries, decisions }: DecisionLogProps) {
  const dispatch = useProjectDispatch()
  const [contextInput, setContextInput] = useState('')
  const [showContextForm, setShowContextForm] = useState(false)

  // Sort by tick, most recent first
  const sorted = [...entries].sort((a, b) => b.tick - a.tick)

  function handleReverse(entry: DecisionLogEntry) {
    const decision = decisions.find(d => d.title === entry.title)
    if (!decision) return
    dispatch({
      type: 'reverse-decision',
      decisionId: decision.id,
      reason: 'Reversed from decision log',
    })
  }

  function handleFlagForReview(entry: DecisionLogEntry) {
    const decision = decisions.find(d => d.title === entry.title)
    if (!decision) return
    dispatch({ type: 'retroactive-review', decisionId: decision.id })
  }

  function handleInjectContext() {
    const trimmed = contextInput.trim()
    if (!trimmed) return
    dispatch({ type: 'inject-context', context: trimmed })
    setContextInput('')
    setShowContextForm(false)
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
          Decision Log
        </h2>
        <button
          onClick={() => setShowContextForm(!showContextForm)}
          className="flex items-center gap-1 text-xs text-accent hover:text-accent-muted transition-colors"
        >
          <MessageSquarePlus size={12} />
          Inject Context
        </button>
      </div>

      {/* Context injection form */}
      {showContextForm && (
        <div className="flex gap-2">
          <input
            type="text"
            value={contextInput}
            onChange={(e) => setContextInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleInjectContext()}
            placeholder="Push new context to all agents..."
            className="flex-1 px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            autoFocus
          />
          <button
            onClick={handleInjectContext}
            disabled={!contextInput.trim()}
            className="px-3 py-2 text-sm bg-accent text-white rounded-md hover:bg-accent-muted transition-colors disabled:opacity-40"
          >
            Send
          </button>
          <button
            onClick={() => { setShowContextForm(false); setContextInput('') }}
            className="px-3 py-2 text-sm text-text-muted hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="text-sm text-text-muted p-3 rounded-lg bg-surface-1 border border-border">
          No decisions logged yet.
        </p>
      ) : (
        <div className="space-y-1">
          {sorted.map((entry) => (
            <div
              key={entry.id}
              className={`p-3 rounded-lg border transition-colors ${
                entry.reversed
                  ? 'bg-danger/5 border-danger/20 opacity-60'
                  : entry.flaggedForReview
                    ? 'bg-warning/5 border-warning/20'
                    : 'bg-surface-1 border-border'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-muted">
                      T{entry.tick}
                    </span>
                    <span className={`text-[10px] uppercase font-medium ${
                      entry.source === 'human'
                        ? 'text-accent'
                        : entry.source === 'agent'
                          ? 'text-success'
                          : 'text-info'
                    }`}>
                      {entry.source}
                    </span>
                    <span className="text-sm text-text-primary truncate">
                      {entry.title}
                    </span>
                    {entry.reversed && (
                      <span className="text-[10px] bg-danger/15 text-danger px-1.5 py-0.5 rounded">
                        reversed
                      </span>
                    )}
                    {entry.flaggedForReview && !entry.reversed && (
                      <span className="text-[10px] bg-warning/15 text-warning px-1.5 py-0.5 rounded">
                        flagged
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">
                    {entry.summary}
                    {entry.rationale && (
                      <span className="text-text-secondary"> — {entry.rationale}</span>
                    )}
                  </p>
                </div>

                {/* Actions */}
                {!entry.reversed && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {entry.reversible && (
                      <button
                        onClick={() => handleReverse(entry)}
                        className="p-1 text-text-muted hover:text-danger transition-colors"
                        title="Reverse this decision"
                      >
                        <RotateCcw size={12} />
                      </button>
                    )}
                    {!entry.flaggedForReview && (
                      <button
                        onClick={() => handleFlagForReview(entry)}
                        className="p-1 text-text-muted hover:text-warning transition-colors"
                        title="Flag for retroactive review"
                      >
                        <Flag size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
