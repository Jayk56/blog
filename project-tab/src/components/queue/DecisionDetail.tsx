/**
 * Decision detail — right panel of the Decision Queue workspace.
 * Shows full context for the selected decision and action controls.
 */

import { useState, useEffect } from 'react'
import { AlertTriangle, FileText, Target, Check, X } from 'lucide-react'
import type { DecisionItem, Severity } from '../../types/index.js'
import { useProjectDispatch, useProjectState, useApi } from '../../lib/context.js'
import { adaptFrontendResolution } from '../../services/state-adapter.js'

/** Render tool arguments in a readable format. */
function ToolArgsDetail({ toolArgs }: { toolArgs: Record<string, unknown> }) {
  const command = toolArgs.command as string | undefined
  const filePath = (toolArgs.file_path ?? toolArgs.filePath) as string | undefined
  const oldString = (toolArgs.old_string ?? toolArgs.oldString) as string | undefined
  const newString = (toolArgs.new_string ?? toolArgs.newString) as string | undefined
  const content = toolArgs.content as string | undefined
  const description = toolArgs.description as string | undefined

  return (
    <div className="space-y-2">
      {description && (
        <p className="text-xs text-text-muted italic">{description}</p>
      )}
      {filePath && (
        <div>
          <span className="text-[10px] uppercase text-text-muted">File</span>
          <p className="text-sm text-text-primary font-mono bg-surface-2 px-2 py-1 rounded mt-0.5 break-all">
            {filePath}
          </p>
        </div>
      )}
      {command && (
        <div>
          <span className="text-[10px] uppercase text-text-muted">Command</span>
          <pre className="text-sm text-text-primary font-mono bg-surface-2 px-3 py-2 rounded mt-0.5 overflow-x-auto whitespace-pre-wrap break-all">
            {command}
          </pre>
        </div>
      )}
      {oldString && (
        <div>
          <span className="text-[10px] uppercase text-text-muted">Replace</span>
          <pre className="text-sm text-danger/80 font-mono bg-surface-2 px-3 py-2 rounded mt-0.5 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
            {oldString}
          </pre>
        </div>
      )}
      {newString && (
        <div>
          <span className="text-[10px] uppercase text-text-muted">With</span>
          <pre className="text-sm text-success/80 font-mono bg-surface-2 px-3 py-2 rounded mt-0.5 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
            {newString}
          </pre>
        </div>
      )}
      {content && !command && (
        <div>
          <span className="text-[10px] uppercase text-text-muted">Content</span>
          <pre className="text-sm text-text-primary font-mono bg-surface-2 px-3 py-2 rounded mt-0.5 overflow-x-auto whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
            {content}
          </pre>
        </div>
      )}
    </div>
  )
}

interface Props {
  decision: DecisionItem
  onOpenProvenance: (artifactId: string) => void
  effectiveTick?: number
}

const severityLabel: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
}

export default function DecisionDetail({ decision, onOpenProvenance, effectiveTick }: Props) {
  const dispatch = useProjectDispatch()
  const state = useProjectState()
  const api = useApi()
  const isHistorical = state.viewingTick !== null
  const [rationale, setRationale] = useState('')

  // Reset rationale when switching between decisions
  useEffect(() => {
    setRationale('')
  }, [decision.id])

  const artifacts = state.artifacts.filter((a) =>
    decision.affectedArtifactIds.includes(a.id),
  )

  const sourceAgent = state.project?.agents.find(
    (a) => a.id === decision.sourceAgentId,
  )

  function handleResolve(optionId: string) {
    if (decision.requiresRationale && !rationale.trim()) return

    const option = decision.options.find((o) => o.id === optionId)
    if (!option) return

    const trimmedRationale = rationale.trim()

    // Call API first if in live mode
    if (api) {
      const resolution = adaptFrontendResolution(
        optionId,
        option.actionKind,
        trimmedRationale,
        decision.subtype,
      )

      api.resolveDecision(decision.id, resolution).then(() => {
        // Server will broadcast the resolution to all clients
        // Local dispatch only in mock mode or if API succeeds
        dispatch({
          type: 'resolve-decision',
          decisionId: decision.id,
          chosenOptionId: optionId,
          actionKind: option.actionKind,
          rationale: trimmedRationale,
        })
        setRationale('')
      }).catch((err) => {
        console.error('Failed to resolve decision:', err)
        // Don't update local state on failure
      })
    } else {
      // Mock mode - update immediately
      dispatch({
        type: 'resolve-decision',
        decisionId: decision.id,
        chosenOptionId: optionId,
        actionKind: option.actionKind,
        rationale: trimmedRationale,
      })
      setRationale('')
    }
  }

  return (
    <div className="p-5 space-y-5 overflow-y-auto">
      {/* Historical mode banner */}
      {isHistorical && (
        <div className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-border rounded-lg text-xs text-text-muted">
          <AlertTriangle size={12} className="shrink-0" />
          Viewing historical state — actions disabled
        </div>
      )}

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${
              decision.severity === 'critical'
                ? 'bg-danger text-white'
                : decision.severity === 'high'
                  ? 'bg-warning/80 text-surface-0'
                  : decision.severity === 'medium'
                    ? 'bg-info/60 text-white'
                    : decision.severity === 'low'
                      ? 'bg-surface-3 text-text-secondary'
                      : 'bg-surface-2 text-text-muted'
            }`}
          >
            {severityLabel[decision.severity]}
          </span>
          <span className="text-xs text-text-muted capitalize">{decision.type}</span>
          {sourceAgent && (
            <span className="text-xs text-text-muted">
              from {sourceAgent.name}
            </span>
          )}
        </div>
        <h2 className="text-lg font-semibold text-text-primary">{decision.title}</h2>
      </div>

      {/* Summary */}
      <p className="text-sm text-text-secondary leading-relaxed">
        {decision.summary}
      </p>

      {/* Agent reasoning for tool_approval decisions */}
      {decision.subtype === 'tool_approval' && decision.reasoning && (
        <div className="bg-surface-2 rounded-lg px-4 py-3 border-l-2 border-l-accent/40">
          <span className="text-[10px] uppercase text-text-muted block mb-1">Agent Reasoning</span>
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
            {decision.reasoning}
          </p>
        </div>
      )}

      {/* Tool args detail for tool_approval decisions */}
      {decision.subtype === 'tool_approval' && decision.toolArgs && (
        <ToolArgsDetail toolArgs={decision.toolArgs} />
      )}

      {/* Metrics row */}
      <div className="flex items-center gap-6 py-3 px-4 bg-surface-2 rounded-lg">
        {/* Confidence gauge */}
        <div className="flex-1">
          <div className="text-[10px] uppercase text-text-muted mb-1">Confidence</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-surface-3 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  decision.confidence >= 0.8
                    ? 'bg-success'
                    : decision.confidence >= 0.5
                      ? 'bg-warning'
                      : 'bg-danger'
                }`}
                style={{ width: `${decision.confidence * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium text-text-primary tabular-nums">
              {Math.round(decision.confidence * 100)}%
            </span>
          </div>
        </div>

        {/* Blast radius */}
        <div>
          <div className="text-[10px] uppercase text-text-muted mb-1">Blast Radius</div>
          <div className="flex items-center gap-1.5">
            <Target size={14} className="text-text-muted" />
            <span className="text-sm text-text-primary capitalize">
              {decision.blastRadius.magnitude}
            </span>
            <span className="text-[10px] text-text-muted">
              ({decision.blastRadius.artifactCount}a &middot; {decision.blastRadius.workstreamCount}w &middot; {decision.blastRadius.agentCount}ag)
            </span>
          </div>
        </div>

        {/* Due status */}
        {decision.dueByTick !== null && (
          <div>
            <div className="text-[10px] uppercase text-text-muted mb-1">Due</div>
            {state.project && decision.dueByTick <= (effectiveTick ?? state.project.currentTick) ? (
              <span className="flex items-center gap-1 text-sm text-danger font-medium">
                <AlertTriangle size={14} />
                Overdue
              </span>
            ) : (
              <span className="text-sm text-text-primary">Tick {decision.dueByTick}</span>
            )}
          </div>
        )}
      </div>

      {/* Affected artifacts */}
      {artifacts.length > 0 && (
        <div>
          <h3 className="text-xs uppercase text-text-muted mb-2">Affected Artifacts</h3>
          <div className="space-y-1">
            {artifacts.map((a) => (
              <button
                key={a.id}
                onClick={() => onOpenProvenance(a.id)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-surface-2 rounded hover:bg-surface-3 transition-colors text-left"
              >
                <FileText size={14} className="text-text-muted shrink-0" />
                <span className="text-sm text-text-primary">{a.name}</span>
                <span className="text-[10px] text-text-muted capitalize ml-auto">{a.kind}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Options */}
      <div>
        <h3 className="text-xs uppercase text-text-muted mb-2">Options</h3>
        <div className="space-y-2">
          {decision.options.map((option) => (
            <div
              key={option.id}
              className={`p-3 rounded-lg border transition-colors ${
                option.recommended
                  ? 'border-accent/40 bg-accent/5'
                  : 'border-border bg-surface-2'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-text-primary flex items-center gap-2">
                  {option.label}
                  {option.recommended && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-accent/15 text-accent rounded font-medium">
                      recommended
                    </span>
                  )}
                </span>
              </div>
              <p className="text-xs text-text-secondary mb-2">{option.description}</p>
              <p className="text-xs text-text-muted italic mb-3">
                Consequence: {option.consequence}
              </p>
              <button
                onClick={() => handleResolve(option.id)}
                disabled={isHistorical || (decision.requiresRationale && !rationale.trim())}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  option.recommended
                    ? 'bg-accent text-white hover:bg-accent-muted disabled:opacity-40 disabled:cursor-not-allowed'
                    : 'bg-surface-3 text-text-secondary hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
              >
                <span className="flex items-center gap-1">
                  {option.actionKind === 'approve' ? <Check size={12} /> : <X size={12} />}
                  {option.label}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Rationale */}
      <div>
        <label className="text-xs uppercase text-text-muted mb-1 block">
          Rationale {decision.requiresRationale ? '(required)' : '(optional)'}
        </label>
        <textarea
          className={`w-full px-3 py-2 bg-surface-2 border rounded-lg text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed ${
            !isHistorical && decision.requiresRationale && !rationale.trim()
              ? 'border-warning/50'
              : 'border-border'
          }`}
          rows={3}
          placeholder="Why did you choose this option?"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          disabled={isHistorical}
        />
        {decision.requiresRationale && !rationale.trim() && (
          <p className="text-[11px] text-warning mt-1">
            Fill in rationale to unlock decision actions
          </p>
        )}
      </div>
    </div>
  )
}
