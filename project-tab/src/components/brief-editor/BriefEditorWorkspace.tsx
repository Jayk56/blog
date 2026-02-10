/**
 * Brief Editor Workspace (M7).
 *
 * Intent specification editor — answers "Here's what I want to happen."
 * Displays and edits the project brief: goals, constraints, routing rules,
 * agent roster, and checkpoint gates.
 */

import { useProjectState } from '../../lib/context.js'
import ProjectBrief from './ProjectBrief.js'
import ConstraintsSection from './ConstraintsSection.js'
import CheckpointsSection from './CheckpointsSection.js'
import AgentsPanel from './AgentsPanel.js'

export default function BriefEditorWorkspace() {
  const state = useProjectState()

  if (!state.project) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-lg">
        No project loaded. Select a scenario to begin.
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">
          Brief Editor
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Define intent, constraints, and routing rules for {state.project.name}
        </p>
      </div>

      {/* Project brief (goals + description) */}
      <ProjectBrief project={state.project} />

      {/* Constraints */}
      <ConstraintsSection constraints={state.project.constraints} />

      {/* Checkpoints */}
      <CheckpointsSection checkpoints={state.controlConfig.checkpoints} />

      {/* Active agents */}
      <AgentsPanel
        agents={state.project.agents}
        trustProfiles={state.trustProfiles}
      />
    </div>
  )
}
