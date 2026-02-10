/**
 * Trust trajectories panel — per-agent sparkline showing trust score
 * over time, with current score and trend indicator.
 *
 * "Make trust visible. Show the PM their own trust patterns."
 */

import type { Agent, TrustProfile } from '../../types/index.js'

interface TrustTrajectoriesProps {
  agents: Agent[]
  trustProfiles: TrustProfile[]
}

/** Render a simple inline SVG sparkline from trust snapshots. */
function Sparkline({ profile }: { profile: TrustProfile }) {
  const { trajectory } = profile
  if (trajectory.length < 2) {
    return <span className="text-[10px] text-text-muted">insufficient data</span>
  }

  const width = 80
  const height = 20
  const padding = 2

  const scores = trajectory.map(s => s.score)
  const minScore = Math.min(...scores) - 0.05
  const maxScore = Math.max(...scores) + 0.05
  const range = maxScore - minScore || 1

  const points = trajectory.map((s, i) => {
    const x = padding + (i / (trajectory.length - 1)) * (width - 2 * padding)
    const y = height - padding - ((s.score - minScore) / range) * (height - 2 * padding)
    return `${x},${y}`
  }).join(' ')

  const color = profile.trend === 'increasing'
    ? 'var(--color-success)'
    : profile.trend === 'decreasing'
      ? 'var(--color-danger)'
      : 'var(--color-accent)'

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function getTrustColor(score: number): string {
  if (score >= 0.85) return 'text-success'
  if (score >= 0.70) return 'text-warning'
  return 'text-danger'
}

function trendArrow(trend: TrustProfile['trend']): string {
  switch (trend) {
    case 'increasing': return '↑'
    case 'decreasing': return '↓'
    case 'stable': return '→'
  }
}

export default function TrustTrajectories({ agents, trustProfiles }: TrustTrajectoriesProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
        Trust Trajectories
      </h2>

      <div className="space-y-2">
        {agents.filter(a => a.active).map((agent) => {
          const profile = trustProfiles.find(tp => tp.agentId === agent.id)
          if (!profile) return null
          const latest = profile.trajectory[profile.trajectory.length - 1]

          return (
            <div
              key={agent.id}
              className="p-3 rounded-lg bg-surface-1 border border-border"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    {agent.name}
                  </span>
                  <span className={`text-xs ${getTrustColor(profile.currentScore)}`}>
                    {Math.round(profile.currentScore * 100)}
                    {' '}{trendArrow(profile.trend)}
                  </span>
                </div>
                <Sparkline profile={profile} />
              </div>

              {/* Breakdown */}
              {latest && (
                <div className="flex gap-4 text-[10px] text-text-muted">
                  <span>
                    <span className="text-success">{latest.successCount}</span> success
                  </span>
                  <span>
                    <span className="text-warning">{latest.overrideCount}</span> override
                  </span>
                  <span>
                    <span className="text-danger">{latest.reworkCount}</span> rework
                  </span>
                  <span>
                    {latest.totalTasks} total
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
