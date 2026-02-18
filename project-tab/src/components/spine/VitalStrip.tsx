import { Octagon, Play, ChevronRight, Pause, Wifi, WifiOff } from 'lucide-react'
import { useProject } from '../../lib/context.js'
import { scenarios } from '../../data/index.js'
import { useEffect, useRef } from 'react'

export default function VitalStrip() {
  const { state, dispatch, api, connected } = useProject()
  const isLive = api !== null
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const project = state.project
  const metrics = state.metrics

  // Auto-simulate tick advancement
  useEffect(() => {
    if (state.autoSimulate && project && !project.emergencyBrakeEngaged) {
      autoRef.current = setInterval(() => {
        if (api) {
          // Live mode: only advance locally if the backend succeeds
          api.advanceTick(1).then(() => {
            dispatch({ type: 'advance-tick' })
          }).catch(() => {})
        } else {
          // Mock mode: advance immediately
          dispatch({ type: 'advance-tick' })
        }
      }, 2000)
    }
    return () => {
      if (autoRef.current) clearInterval(autoRef.current)
    }
  }, [state.autoSimulate, project?.emergencyBrakeEngaged, dispatch, project, api])

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

        {/* Connection status (live mode) or Scenario switcher (mock mode) */}
        {isLive ? (
          <span
            className={`flex items-center gap-1.5 text-xs ${
              connected ? 'text-success' : 'text-warning'
            }`}
            title={connected ? 'Connected to backend' : 'Disconnected — reconnecting...'}
          >
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {connected ? 'Live' : 'Reconnecting'}
          </span>
        ) : (
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
        )}

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
            {/* Tick scrubber (temporal navigation) */}
            {project.currentTick > 1 && (
              <input
                type="range"
                min={1}
                max={project.currentTick}
                value={state.viewingTick ?? project.currentTick}
                aria-label="Tick scrubber"
                className="w-20 h-1 accent-accent cursor-pointer"
                onChange={(e) => {
                  const val = Number(e.target.value)
                  dispatch({
                    type: 'set-viewing-tick',
                    tick: val >= project.currentTick ? null : val,
                  })
                }}
              />
            )}

            {/* Tick label with live/history indicator */}
            <span
              className={`text-xs font-medium ${
                state.viewingTick !== null ? 'text-warning' : 'text-text-muted'
              }`}
            >
              T{state.viewingTick ?? project.currentTick}
            </span>
            {state.viewingTick === null ? (
              <span className="text-[10px] text-success font-medium">live</span>
            ) : (
              <button
                className="text-[10px] text-accent font-medium hover:underline"
                title="Return to live"
                aria-label="Return to live"
                onClick={() => dispatch({ type: 'set-viewing-tick', tick: null })}
              >
                Live
              </button>
            )}

            <button
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-2 text-text-muted hover:text-text-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Advance one tick"
              aria-label="Advance one tick"
              disabled={state.viewingTick !== null}
              onClick={() => {
                if (api) {
                  // Live mode: only advance locally if the backend succeeds
                  api.advanceTick(1).then(() => {
                    dispatch({ type: 'advance-tick' })
                  }).catch(() => {})
                } else {
                  // Mock mode: advance immediately
                  dispatch({ type: 'advance-tick' })
                }
              }}
            >
              <ChevronRight size={14} />
            </button>
            <button
              className={`w-6 h-6 flex items-center justify-center rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                state.autoSimulate
                  ? 'bg-accent/15 text-accent'
                  : 'hover:bg-surface-2 text-text-muted hover:text-text-secondary'
              }`}
              title={state.autoSimulate ? 'Pause auto-simulate' : 'Auto-simulate'}
              aria-label={state.autoSimulate ? 'Pause auto-simulate' : 'Auto-simulate'}
              disabled={state.viewingTick !== null}
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
            const newEngaged = !project.emergencyBrakeEngaged
            dispatch({ type: 'emergency-brake', engaged: newEngaged })
            if (api) {
              if (newEngaged) {
                api.engageBrake({
                  scope: { type: 'all' },
                  reason: 'Emergency brake engaged from UI',
                  behavior: 'pause',
                  initiatedBy: 'human',
                }).catch(() => {
                  // Rollback on failure
                  dispatch({ type: 'emergency-brake', engaged: !newEngaged })
                })
              } else {
                api.releaseBrake().catch(() => {
                  dispatch({ type: 'emergency-brake', engaged: !newEngaged })
                })
              }
            }
          }}
        >
          <Octagon size={12} />
          {project?.emergencyBrakeEngaged ? 'Resume' : 'Brake'}
        </button>
      </div>
    </header>
  )
}
