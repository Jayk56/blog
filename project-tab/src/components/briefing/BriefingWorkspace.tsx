/**
 * Briefing workspace — the "catch up" view.
 *
 * Answers: "What happened while I was away?"
 *
 * Layout:
 * 1. Multi-paragraph narrative briefing (from buildBriefing / state.briefing)
 * 2. Action summary card with decision and issue counts
 * 3. Recent agent activity feed
 */

import { useMemo, useState, useCallback } from 'react'
import { useProjectState, useProjectDispatch, useEffectiveTick, useApi } from '../../lib/context.js'
import NarrativeBriefing from './NarrativeBriefing.js'
import ActionSummary from './ActionSummary.js'
import ActivityFeed from './ActivityFeed.js'

export default function BriefingWorkspace() {
  const state = useProjectState()
  const dispatch = useProjectDispatch()
  const effectiveTick = useEffectiveTick()
  const api = useApi()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredTimeline = useMemo(
    () => state.timeline.filter((e) => e.tick <= effectiveTick),
    [state.timeline, effectiveTick],
  )

  const handleEnhanceWithAI = useCallback(async () => {
    if (!api) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.generateBriefing()
      dispatch({ type: 'set-llm-briefing', briefing: result.briefing })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 503 means no API key — not really an error, just unavailable
      if (message.includes('503')) {
        setError('LLM briefing unavailable (no API key configured)')
      } else {
        setError(`Failed to generate briefing: ${message}`)
      }
    } finally {
      setLoading(false)
    }
  }, [api, dispatch])

  const handleResetToTemplate = useCallback(() => {
    dispatch({ type: 'reset-briefing' })
    setError(null)
  }, [dispatch])

  if (!state.project) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        Select a scenario to see the briefing.
      </div>
    )
  }

  const isLlmBriefing = state.briefingSource === 'llm'

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Emergency brake banner */}
      {state.project.emergencyBrakeEngaged && (
        <div className="rounded-lg border border-danger bg-danger/10 p-4 text-danger text-sm font-medium">
          EMERGENCY BRAKE ENGAGED -- all agent work is paused.
        </div>
      )}

      {/* Briefing header with AI controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isLlmBriefing && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-accent bg-accent/10 px-2 py-0.5 rounded-full">
              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1l1.6 3.3L13 5l-2.5 2.4.6 3.6L8 9.3 4.9 11l.6-3.6L3 5l3.4-.7L8 1z"/>
              </svg>
              AI-enhanced
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isLlmBriefing && (
            <>
              <button
                onClick={handleEnhanceWithAI}
                disabled={loading}
                className="text-xs text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
              >
                Refresh
              </button>
              <span className="text-text-muted">|</span>
              <button
                onClick={handleResetToTemplate}
                className="text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                Reset to template
              </button>
            </>
          )}

          {!isLlmBriefing && api && (
            <button
              onClick={handleEnhanceWithAI}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 transition-colors disabled:opacity-40"
            >
              {loading ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="8" cy="8" r="6" strokeDasharray="30" strokeDashoffset="10" />
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 1l1.6 3.3L13 5l-2.5 2.4.6 3.6L8 9.3 4.9 11l.6-3.6L3 5l3.4-.7L8 1z"/>
                  </svg>
                  Enhance with AI
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="text-xs text-warning bg-warning/10 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Narrative briefing */}
      <NarrativeBriefing briefing={state.briefing} />

      {/* Action summary */}
      <ActionSummary metrics={state.metrics} />

      {/* Agent activity feed */}
      <ActivityFeed
        timeline={filteredTimeline}
        agents={state.project.agents}
        currentTick={effectiveTick}
      />
    </div>
  )
}
