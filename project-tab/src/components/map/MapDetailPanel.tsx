/**
 * Map detail panel — side panel for coherence issues, workstreams, and artifacts.
 */

import { X, Bot, FileText } from 'lucide-react'
import type { CoherenceIssue, Workstream, Artifact } from '../../types/index.js'
import { useProjectState, useProjectDispatch } from '../../lib/context.js'

type Selection =
  | { kind: 'issue'; data: CoherenceIssue }
  | { kind: 'workstream'; data: Workstream }
  | { kind: 'artifact'; data: Artifact }

interface Props {
  selection: Selection
  onClose: () => void
}

export default function MapDetailPanel({ selection, onClose }: Props) {
  return (
    <div className="w-80 flex-shrink-0 border-l border-border bg-surface-1 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary capitalize">{selection.kind} Detail</h3>
        <button
          onClick={onClose}
          aria-label="Close detail panel"
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-2 text-text-muted"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-4">
        {selection.kind === 'issue' && <IssueDetail issue={selection.data} />}
        {selection.kind === 'workstream' && <WorkstreamDetail workstream={selection.data} />}
        {selection.kind === 'artifact' && <ArtifactDetail artifact={selection.data} />}
      </div>
    </div>
  )
}

export type { Selection }

// ── Sub-components ────────────────────────────────────────────────

function IssueDetail({ issue }: { issue: CoherenceIssue }) {
  const state = useProjectState()
  const dispatch = useProjectDispatch()

  const agents = state.project?.agents.filter((a) => issue.agentIds.includes(a.id)) ?? []
  const artifacts = state.artifacts.filter((a) => issue.artifactIds.includes(a.id))

  const isActive = ['detected', 'confirmed', 'in_progress'].includes(issue.status)

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-text-primary mb-1">{issue.title}</h4>
        <p className="text-xs text-text-secondary">{issue.description}</p>
      </div>

      <div className="flex items-center gap-3 text-xs text-text-muted">
        <span className="capitalize">{issue.category.replace(/_/g, ' ')}</span>
        <span>&middot;</span>
        <span className="capitalize">{issue.severity}</span>
        <span>&middot;</span>
        <span className="capitalize">{issue.status}</span>
      </div>

      {issue.suggestedResolution && (
        <div className="p-3 bg-accent/5 border border-accent/20 rounded">
          <div className="text-[10px] uppercase text-text-muted mb-1">Suggested Resolution</div>
          <p className="text-xs text-text-secondary">{issue.suggestedResolution}</p>
        </div>
      )}

      {agents.length > 0 && (
        <div>
          <div className="text-[10px] uppercase text-text-muted mb-2">Involved Agents</div>
          {agents.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-xs text-text-primary mb-1">
              <Bot size={12} className="text-text-muted" />
              {a.name}
            </div>
          ))}
        </div>
      )}

      {artifacts.length > 0 && (
        <div>
          <div className="text-[10px] uppercase text-text-muted mb-2">Affected Artifacts</div>
          {artifacts.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-xs text-text-primary mb-1">
              <FileText size={12} className="text-text-muted" />
              {a.name}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {isActive && (
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => dispatch({ type: 'resolve-issue', issueId: issue.id, newStatus: 'resolved' })}
            className="px-3 py-1.5 bg-success/20 text-success text-xs rounded hover:bg-success/30 transition-colors"
          >
            Resolve
          </button>
          <button
            onClick={() => dispatch({ type: 'resolve-issue', issueId: issue.id, newStatus: 'accepted' })}
            className="px-3 py-1.5 bg-surface-3 text-text-secondary text-xs rounded hover:bg-border transition-colors"
          >
            Accept
          </button>
          <button
            onClick={() => dispatch({ type: 'resolve-issue', issueId: issue.id, newStatus: 'dismissed' })}
            className="px-3 py-1.5 bg-surface-3 text-text-muted text-xs rounded hover:bg-border transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

function WorkstreamDetail({ workstream }: { workstream: Workstream }) {
  const state = useProjectState()

  const agents = state.project?.agents.filter((a) => workstream.agentIds.includes(a.id)) ?? []
  const artifacts = state.artifacts.filter((a) => a.workstreamId === workstream.id)
  const issues = state.coherenceIssues.filter((i) => i.workstreamIds.includes(workstream.id))

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-text-primary mb-1">{workstream.name}</h4>
        <p className="text-xs text-text-secondary">{workstream.description}</p>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className={`capitalize px-1.5 py-0.5 rounded ${
          workstream.status === 'active' ? 'bg-success/15 text-success' :
          workstream.status === 'blocked' ? 'bg-danger/15 text-danger' :
          'bg-surface-3 text-text-muted'
        }`}>
          {workstream.status}
        </span>
      </div>

      {agents.length > 0 && (
        <div>
          <div className="text-[10px] uppercase text-text-muted mb-2">Agents</div>
          {agents.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-xs mb-1">
              <span className="flex items-center gap-2 text-text-primary">
                <Bot size={12} className="text-text-muted" />
                {a.name}
              </span>
              <span className="text-text-muted">Trust: {Math.round(a.trustScore * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      {artifacts.length > 0 && (
        <div>
          <div className="text-[10px] uppercase text-text-muted mb-2">Artifacts ({artifacts.length})</div>
          {artifacts.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-xs text-text-primary mb-1">
              <FileText size={12} className="text-text-muted" />
              <span className="truncate">{a.name}</span>
              <span className="text-text-muted ml-auto capitalize">{a.status.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}

      {issues.length > 0 && (
        <div>
          <div className="text-[10px] uppercase text-text-muted mb-2">Coherence Issues ({issues.length})</div>
          {issues.map((i) => (
            <div key={i.id} className="text-xs text-text-primary mb-1">
              <span className={
                i.status === 'resolved' ? 'line-through text-text-muted' : ''
              }>
                {i.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ArtifactDetail({ artifact }: { artifact: Artifact }) {
  const state = useProjectState()

  const producer = state.project?.agents.find((a) => a.id === artifact.provenance.producerAgentId)
  const validators = state.project?.agents.filter((a) =>
    artifact.provenance.validatorAgentIds.includes(a.id),
  )

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-text-primary mb-1">{artifact.name}</h4>
        <p className="text-xs text-text-secondary">{artifact.description}</p>
      </div>

      <div className="flex items-center gap-3 text-xs text-text-muted">
        <span className="capitalize">{artifact.kind}</span>
        <span>&middot;</span>
        <span className="capitalize">{artifact.status.replace(/_/g, ' ')}</span>
        <span>&middot;</span>
        <span>Quality: {Math.round(artifact.qualityScore * 100)}%</span>
      </div>

      <div>
        <div className="text-[10px] uppercase text-text-muted mb-2">Produced By</div>
        <div className="flex items-center gap-2 text-xs text-text-primary">
          <Bot size={12} className="text-accent" />
          {producer?.name ?? artifact.provenance.producerAgentId}
          <span className="text-text-muted ml-auto">T{artifact.provenance.producedAtTick}</span>
        </div>
      </div>

      {validators && validators.length > 0 && (
        <div>
          <div className="text-[10px] uppercase text-text-muted mb-2">Validated By</div>
          {validators.map((v) => (
            <div key={v.id} className="flex items-center gap-2 text-xs text-text-primary mb-1">
              <Bot size={12} className="text-info" />
              {v.name}
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase text-text-muted mb-1">Human Reviewer</div>
        <span className="text-xs text-text-primary">
          {artifact.provenance.humanReviewerId ?? 'Not yet reviewed'}
        </span>
      </div>
    </div>
  )
}
