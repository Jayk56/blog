/**
 * Control topology visualization — the spectrum bars from the blog post.
 *
 * Four dimensions: phase, risk level, domain expertise, team maturity.
 * Each shows current position vs. system-recommended position on the
 * orchestrator/ecosystem spectrum (0 = orchestrator, 100 = ecosystem).
 */

import type { ControlTopologyPoint } from '../../types/index.js'

interface ControlTopologyProps {
  topology: ControlTopologyPoint[]
}

const dimensionLabels: Record<string, string> = {
  phase: 'By Project Phase',
  risk: 'By Risk Level',
  domain_expertise: 'By Domain Expertise',
  team_maturity: 'By Team Maturity',
}

export default function ControlTopology({ topology }: ControlTopologyProps) {
  if (topology.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
          Control Topology
        </h2>
        <div className="flex items-center gap-4 text-[10px] text-text-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-accent" /> Current
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-info/50 border border-info" /> Recommended
          </span>
        </div>
      </div>

      <div className="p-4 rounded-lg bg-surface-1 border border-border space-y-5">
        {/* Axis labels */}
        <div className="flex justify-between text-[10px] text-text-muted uppercase tracking-wider">
          <span>Orchestrator</span>
          <span>Ecosystem</span>
        </div>

        {topology.map((point) => (
          <div key={point.dimension} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">
                {dimensionLabels[point.dimension] ?? point.dimension}
              </span>
              <span className="text-xs text-text-muted">{point.label}</span>
            </div>

            {/* Spectrum bar */}
            <div className="relative h-3 bg-surface-3 rounded-full">
              {Math.abs(point.currentPosition - point.recommendedPosition) <= 3 ? (
                /* Combined indicator when positions overlap */
                <div
                  className="absolute top-0 h-full w-3 rounded-full bg-accent ring-2 ring-info/60 shadow-sm shadow-accent/30"
                  style={{ left: `calc(${point.currentPosition}% - 6px)` }}
                  title={`Current: ${point.currentPosition}% | Recommended: ${point.recommendedPosition}% (aligned)`}
                />
              ) : (
                <>
                  {/* Recommended position indicator */}
                  <div
                    className="absolute top-0 h-full w-3 rounded-full bg-info/20 border border-info/40"
                    style={{ left: `calc(${point.recommendedPosition}% - 6px)` }}
                    title={`Recommended: ${point.recommendedPosition}%`}
                  />
                  {/* Current position indicator */}
                  <div
                    className="absolute top-0 h-full w-3 rounded-full bg-accent shadow-sm shadow-accent/30"
                    style={{ left: `calc(${point.currentPosition}% - 6px)` }}
                    title={`Current: ${point.currentPosition}%`}
                  />
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
