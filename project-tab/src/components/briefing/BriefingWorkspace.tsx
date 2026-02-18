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

import { useMemo } from 'react'
import { useProjectState, useEffectiveTick } from '../../lib/context.js'
import NarrativeBriefing from './NarrativeBriefing.js'
import ActionSummary from './ActionSummary.js'
import ActivityFeed from './ActivityFeed.js'

export default function BriefingWorkspace() {
  const state = useProjectState()
  const effectiveTick = useEffectiveTick()

  const filteredTimeline = useMemo(
    () => state.timeline.filter((e) => e.tick <= effectiveTick),
    [state.timeline, effectiveTick],
  )

  if (!state.project) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        Select a scenario to see the briefing.
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Emergency brake banner */}
      {state.project.emergencyBrakeEngaged && (
        <div className="rounded-lg border border-danger bg-danger/10 p-4 text-danger text-sm font-medium">
          EMERGENCY BRAKE ENGAGED -- all agent work is paused.
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
