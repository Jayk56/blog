import { Octagon, Play, ChevronRight, Pause } from 'lucide-react'
import { useProject } from '../../lib/context.js'
import { scenarios } from '../../data/index.js'
import { useEffect, useRef } from 'react'

export default function VitalStrip() {
  const { state, dispatch } = useProject()
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const project = state.project
  const metrics = state.metrics

  // Auto-simulate tick advancement
  useEffect(() => {
    if (state.autoSimulate && project && !project.emergencyBrakeEngaged) {
      autoRef.current = setInterval(() => {
        dispatch({ type: 'advance-tick' })
      }, 2000)
    }
    return () => {
      if (autoRef.current) clearInterval(autoRef.current)
    }
  }, [state.autoSimulate, project?.emergencyBrakeEngaged, dispatch, project])

  const trendArrow = (trend: string) => {
    if (trend === 'improving') return '\u2191'
    if (trend === 'declining') return '\u2193'
    return '\u2192'
  }

  return (
    <header className="h-11 flex-shrink-0 bg-surface-1 border-b border-border px-4 flex items-center justify-between text-sm">
      <div className="flex items-center gap-4">
        <span className="font-semibold text-text-primary">Project Tab</span>
        <span className="text-text-muted">|</span>

        {/* Scenario switcher */}
        <select
          aria-label="Select scenario"
          className="bg-surface-2 border border-border rounded px-2 py-0.5 text-xs text-text-secondary appearance-none cursor-pointer pr-6"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237a7a8a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
          value={state.activeScenarioId ?? ''}
          onChange={(e) => dispatch({ type: 'load-scenario', scenarioId: e.target.value })}
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        {project && (
          <>
            <span className="text-text-muted">|</span>
            <span className="text-xs text-text-muted capitalize">{project.phase}</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                project.controlMode === 'orchestrator'
                  ? 'bg-info/15 text-info'
                  : project.controlMode === 'ecosystem'
                    ? 'bg-success/15 text-success'
                    : 'bg-warning/15 text-warning'
              }`}
            >
              {project.controlMode}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Metrics */}
        {project && (
          <div className="hidden md:flex items-center gap-3 text-xs text-text-muted">
            <span>
              Coherence: {metrics.coherenceScore}{' '}
              {trendArrow(metrics.coherenceTrend)}
            </span>
            <span>Risk: {metrics.reworkRisk}%</span>
            <span>Decisions: {metrics.pendingDecisionCount}</span>
          </div>
        )}

        {/* Simulation controls */}
        {project && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted">T{project.currentTick}</span>
            <button
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-2 text-text-muted hover:text-text-secondary transition-colors"
              title="Advance one tick"
              aria-label="Advance one tick"
              onClick={() => dispatch({ type: 'advance-tick' })}
            >
              <ChevronRight size={14} />
            </button>
            <button
              className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                state.autoSimulate
                  ? 'bg-accent/15 text-accent'
                  : 'hover:bg-surface-2 text-text-muted hover:text-text-secondary'
              }`}
              title={state.autoSimulate ? 'Pause auto-simulate' : 'Auto-simulate'}
              aria-label={state.autoSimulate ? 'Pause auto-simulate' : 'Auto-simulate'}
              onClick={() => dispatch({ type: 'toggle-auto-simulate' })}
            >
              {state.autoSimulate ? <Pause size={12} /> : <Play size={12} />}
            </button>
          </div>
        )}

        {/* Emergency brake */}
        <button
          disabled={!project}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-colors ${
            project?.emergencyBrakeEngaged
              ? 'bg-danger border-danger text-white animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.4)]'
              : 'bg-danger/10 border-danger/30 text-danger hover:bg-danger/20 disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
          title="Emergency Brake — halt all agents"
          aria-label={project?.emergencyBrakeEngaged ? 'Resume agents' : 'Emergency Brake — halt all agents'}
          onClick={() => {
            if (!project) return
            dispatch({
              type: 'emergency-brake',
              engaged: !project.emergencyBrakeEngaged,
            })
          }}
        >
          <Octagon size={12} />
          {project?.emergencyBrakeEngaged ? 'Resume' : 'Brake'}
        </button>
      </div>
    </header>
  )
}
