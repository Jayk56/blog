/**
 * Controls Workspace (M8).
 *
 * Configuration + system introspection — answers "Here's how I want
 * the system to operate." Contains mode selection, topology visualization,
 * trust trajectories, review pattern analysis, and the decision log.
 */

import { useProjectState, useEffectiveTick } from '../../lib/context.js'
import ModeSelector from './ModeSelector.js'
import ControlTopology from './ControlTopology.js'
import QualityDial from './QualityDial.js'
import TrustTrajectories from './TrustTrajectories.js'
import ReviewPatterns from './ReviewPatterns.js'
import DecisionLog from './DecisionLog.js'

export default function ControlsWorkspace() {
  const state = useProjectState()
  const effectiveTick = useEffectiveTick()

  if (!state.project) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-lg">
        No project loaded. Select a scenario to begin.
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">
          Controls
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Configure how {state.project.name} operates
        </p>
      </div>

      {/* Mode + Topology row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ModeSelector
          currentMode={state.controlConfig.mode}
          recommendations={state.controlConfig.pendingRecommendations}
        />
        <QualityDial bias={state.controlConfig.bias} />
      </div>

      {/* Control topology */}
      <ControlTopology topology={state.controlConfig.topology} />

      {/* Trust + Review side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrustTrajectories
          agents={state.project.agents}
          trustProfiles={state.trustProfiles}
          effectiveTick={effectiveTick}
        />
        <ReviewPatterns patterns={state.metrics.reviewPatterns} />
      </div>

      {/* Decision log */}
      <DecisionLog
        entries={state.decisionLog}
        decisions={state.decisions}
      />
    </div>
  )
}
