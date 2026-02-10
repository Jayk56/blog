/**
 * Agents panel in the Brief Editor.
 *
 * Shows the roster of agents on this project with their trust scores
 * and roles. Links to the Controls workspace for detailed trust trajectories.
 */

import { Link } from 'react-router-dom'
import type { Agent } from '../../types/index.js'
import type { TrustProfile } from '../../types/index.js'

interface AgentsPanelProps {
  agents: Agent[]
  trustProfiles: TrustProfile[]
}

function getTrustColor(score: number): string {
  if (score >= 0.85) return 'text-success'
  if (score >= 0.70) return 'text-warning'
  return 'text-danger'
}

function getTrustBarColor(score: number): string {
  if (score >= 0.85) return 'bg-success'
  if (score >= 0.70) return 'bg-warning'
  return 'bg-danger'
}

export default function AgentsPanel({ agents, trustProfiles }: AgentsPanelProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
          Active Agents
        </h2>
        <Link
          to="/controls"
          className="text-xs text-accent hover:text-accent-muted transition-colors"
        >
          View trust trajectories
        </Link>
      </div>

      <div className="space-y-2">
        {agents.filter(a => a.active).map((agent) => {
          const profile = trustProfiles.find(tp => tp.agentId === agent.id)
          const score = profile?.currentScore ?? agent.trustScore
          const trend = profile?.trend ?? 'stable'

          return (
            <div
              key={agent.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-surface-1 border border-border"
            >
              {/* Agent info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    {agent.name}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {trend === 'increasing' ? '↑' : trend === 'decreasing' ? '↓' : '→'}
                  </span>
                </div>
                <div className="text-xs text-text-muted">{agent.role}</div>
              </div>

              {/* Trust score */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-16 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${getTrustBarColor(score)}`}
                    style={{ width: `${score * 100}%` }}
                  />
                </div>
                <span className={`text-xs font-mono ${getTrustColor(score)}`}>
                  {Math.round(score * 100)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
