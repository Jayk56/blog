/**
 * Recent agent/system activity feed, filtered from the timeline.
 * Shows what agents have been doing autonomously.
 */

import type { TimelineEvent, Agent, EventCategory } from '../../types/index.js'

interface ActivityFeedProps {
  timeline: TimelineEvent[]
  agents: Agent[]
  currentTick: number
}

const CATEGORY_LABELS: Partial<Record<EventCategory, string>> = {
  decision_created: 'Surfaced decision',
  decision_resolved: 'Resolved decision',
  decision_reversed: 'Reversed decision',
  artifact_produced: 'Produced artifact',
  artifact_updated: 'Updated artifact',
  coherence_detected: 'Detected coherence issue',
  coherence_resolved: 'Resolved coherence issue',
  mode_changed: 'Mode changed',
  phase_changed: 'Phase changed',
  emergency_brake: 'Emergency brake',
  context_injected: 'Context injected',
  agent_activity: 'Agent activity',
  trust_changed: 'Trust changed',
  checkpoint_reached: 'Checkpoint reached',
}

function severityDot(severity: string) {
  switch (severity) {
    case 'critical':
      return 'bg-danger'
    case 'high':
      return 'bg-warning'
    case 'medium':
      return 'bg-info'
    case 'low':
      return 'bg-text-muted'
    default:
      return 'bg-text-muted'
  }
}

function sourceLabel(event: TimelineEvent, agentMap: Map<string, Agent>): string {
  if (event.source === 'human') return 'You'
  if (event.source === 'system') return 'System'
  if (event.agentId) {
    const agent = agentMap.get(event.agentId)
    return agent?.name ?? event.agentId
  }
  return 'Agent'
}

export default function ActivityFeed({ timeline, agents, currentTick }: ActivityFeedProps) {
  const agentMap = new Map(agents.map((a) => [a.id, a]))

  // Show last ~10 events, most recent first
  const recent = [...timeline]
    .sort((a, b) => b.tick - a.tick || b.id.localeCompare(a.id))
    .slice(0, 10)

  if (recent.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">Recent Activity</h2>
        <p className="text-sm text-text-muted">No activity recorded yet.</p>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">Recent Activity</h2>

      {/* Severity legend */}
      <div className="flex items-center gap-3 mb-3 text-[10px] text-text-muted">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-danger" /> Critical</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" /> High</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-info" /> Medium</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-text-muted" /> Low</span>
      </div>

      <div className="space-y-0">
        {recent.map((event) => (
          <div
            key={event.id}
            className="flex items-start gap-3 py-2.5 border-b border-border last:border-b-0"
          >
            {/* Timeline dot */}
            <div className="flex flex-col items-center pt-1.5">
              <div className={`w-2 h-2 rounded-full ${severityDot(event.severity)}`} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-text-primary font-medium truncate">
                  {event.title}
                </span>
                <span className="text-xs text-text-muted flex-shrink-0">
                  T{event.tick}
                  {event.tick === currentTick && (
                    <span className="ml-1 text-accent">now</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-text-muted">
                  {sourceLabel(event, agentMap)}
                </span>
                <span className="text-xs text-text-muted">
                  {CATEGORY_LABELS[event.category] ?? event.category}
                </span>
              </div>
              {event.description && (
                <p className="text-xs text-text-muted mt-1 line-clamp-2">
                  {event.description}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
