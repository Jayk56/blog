/**
 * Tests for the state adapter module.
 * Validates all backend-to-frontend type mappings.
 */

import {
  adaptSeverity,
  adaptBlastRadius,
  adaptControlMode,
  adaptAgentHandle,
  adaptArtifactSummary,
  adaptCoherenceIssueSummary,
  adaptDecisionSummary,
  adaptOptionDecisionEvent,
  adaptWorkstreamSummary,
  adaptStateSyncToState,
  adaptEnvelopeToTimelineEvent,
  adaptFrontendResolution,
  adaptBrakeAction,
} from './state-adapter.js';
import type {
  StateSyncMessage,
  ServerAgentHandle,
  ServerArtifactSummary,
  ServerCoherenceIssueSummary,
  ServerDecisionSummary,
  ServerOptionDecisionEvent,
  ServerWorkstreamSummary,
  ServerEventEnvelope,
  ServerBrakeAction,
} from '../types/server.js';

// ── adaptSeverity ────────────────────────────────────────────────

describe('adaptSeverity', () => {
  it('maps "warning" to "info"', () => {
    expect(adaptSeverity('warning')).toBe('info');
  });

  it('passes through "critical"', () => {
    expect(adaptSeverity('critical')).toBe('critical');
  });

  it('passes through "high"', () => {
    expect(adaptSeverity('high')).toBe('high');
  });

  it('passes through "medium"', () => {
    expect(adaptSeverity('medium')).toBe('medium');
  });

  it('passes through "low"', () => {
    expect(adaptSeverity('low')).toBe('low');
  });
});

// ── adaptBlastRadius ────────────────────────────────────────────

describe('adaptBlastRadius', () => {
  it('maps "trivial" to small magnitude', () => {
    const result = adaptBlastRadius('trivial');
    expect(result.magnitude).toBe('small');
    expect(result.artifactCount).toBeGreaterThan(0);
  });

  it('maps "large" to large magnitude', () => {
    const result = adaptBlastRadius('large');
    expect(result.magnitude).toBe('large');
    expect(result.artifactCount).toBeGreaterThan(4);
  });

  it('maps "unknown" to medium magnitude', () => {
    const result = adaptBlastRadius('unknown');
    expect(result.magnitude).toBe('medium');
  });

  it('always produces positive counts', () => {
    for (const size of ['trivial', 'small', 'medium', 'large', 'unknown'] as const) {
      const result = adaptBlastRadius(size);
      expect(result.artifactCount).toBeGreaterThan(0);
      expect(result.workstreamCount).toBeGreaterThan(0);
      expect(result.agentCount).toBeGreaterThan(0);
    }
  });
});

// ── adaptControlMode ────────────────────────────────────────────

describe('adaptControlMode', () => {
  it('passes through all valid modes', () => {
    expect(adaptControlMode('orchestrator')).toBe('orchestrator');
    expect(adaptControlMode('adaptive')).toBe('adaptive');
    expect(adaptControlMode('ecosystem')).toBe('ecosystem');
  });
});

// ── adaptAgentHandle ────────────────────────────────────────────

describe('adaptAgentHandle', () => {
  const handle: ServerAgentHandle = {
    id: 'agent-1',
    pluginName: 'openai',
    status: 'running',
    sessionId: 'sess-1',
  };

  it('maps id correctly', () => {
    const agent = adaptAgentHandle(handle);
    expect(agent.id).toBe('agent-1');
  });

  it('derives a display name from pluginName', () => {
    const agent = adaptAgentHandle(handle);
    expect(agent.name).toContain('openai');
  });

  it('marks running agents as active', () => {
    const agent = adaptAgentHandle(handle);
    expect(agent.active).toBe(true);
  });

  it('marks paused agents as inactive', () => {
    const agent = adaptAgentHandle({ ...handle, status: 'paused' });
    expect(agent.active).toBe(false);
  });

  it('marks waiting_on_human agents as active', () => {
    const agent = adaptAgentHandle({ ...handle, status: 'waiting_on_human' });
    expect(agent.active).toBe(true);
  });

  it('uses provided trust score', () => {
    const agent = adaptAgentHandle(handle, 85);
    expect(agent.trustScore).toBe(0.85);
  });

  it('defaults trust score to 0.5 when not provided', () => {
    const agent = adaptAgentHandle(handle);
    expect(agent.trustScore).toBe(0.5);
  });
});

// ── adaptArtifactSummary ────────────────────────────────────────

describe('adaptArtifactSummary', () => {
  const summary: ServerArtifactSummary = {
    id: 'art-1',
    name: 'component.ts',
    kind: 'code',
    status: 'approved',
    workstream: 'ws-frontend',
  };

  it('maps id and name', () => {
    const artifact = adaptArtifactSummary(summary);
    expect(artifact.id).toBe('art-1');
    expect(artifact.name).toBe('component.ts');
  });

  it('maps backend "code" kind to frontend "code"', () => {
    const artifact = adaptArtifactSummary(summary);
    expect(artifact.kind).toBe('code');
  });

  it('maps backend "config" kind to frontend "configuration"', () => {
    const artifact = adaptArtifactSummary({ ...summary, kind: 'config' });
    expect(artifact.kind).toBe('configuration');
  });

  it('maps "approved" status correctly', () => {
    const artifact = adaptArtifactSummary(summary);
    expect(artifact.status).toBe('approved');
  });

  it('maps "rejected" to "needs_rework"', () => {
    const artifact = adaptArtifactSummary({ ...summary, status: 'rejected' });
    expect(artifact.status).toBe('needs_rework');
  });

  it('assigns a quality score based on status', () => {
    const approved = adaptArtifactSummary({ ...summary, status: 'approved' });
    const draft = adaptArtifactSummary({ ...summary, status: 'draft' });
    expect(approved.qualityScore).toBeGreaterThan(draft.qualityScore);
  });

  it('fills in provenance defaults', () => {
    const artifact = adaptArtifactSummary(summary);
    expect(artifact.provenance.sourceArtifactIds).toEqual([]);
    expect(artifact.provenance.humanReviewerId).toBeNull();
  });
});

// ── adaptCoherenceIssueSummary ──────────────────────────────────

describe('adaptCoherenceIssueSummary', () => {
  const issue: ServerCoherenceIssueSummary = {
    id: 'coh-1',
    title: 'Duplicate dependency',
    severity: 'high',
    category: 'contradiction',
    affectedWorkstreams: ['ws-1', 'ws-2'],
  };

  it('maps id and title', () => {
    const result = adaptCoherenceIssueSummary(issue);
    expect(result.id).toBe('coh-1');
    expect(result.title).toBe('Duplicate dependency');
  });

  it('adapts severity from backend to frontend', () => {
    const result = adaptCoherenceIssueSummary({ ...issue, severity: 'warning' });
    expect(result.severity).toBe('info');
  });

  it('maps workstream IDs', () => {
    const result = adaptCoherenceIssueSummary(issue);
    expect(result.workstreamIds).toEqual(['ws-1', 'ws-2']);
  });

  it('defaults status to "detected"', () => {
    const result = adaptCoherenceIssueSummary(issue);
    expect(result.status).toBe('detected');
  });
});

// ── adaptDecisionSummary ────────────────────────────────────────

describe('adaptDecisionSummary', () => {
  const summary: ServerDecisionSummary = {
    id: 'dec-1',
    title: 'Choose framework',
    severity: 'high',
    agentId: 'agent-1',
    subtype: 'option',
  };

  it('maps id and title', () => {
    const result = adaptDecisionSummary(summary, 5);
    expect(result.id).toBe('dec-1');
    expect(result.title).toBe('Choose framework');
  });

  it('sets createdAtTick from provided tick', () => {
    const result = adaptDecisionSummary(summary, 5);
    expect(result.createdAtTick).toBe(5);
  });

  it('marks decision as unresolved', () => {
    const result = adaptDecisionSummary(summary, 5);
    expect(result.resolved).toBe(false);
    expect(result.resolution).toBeNull();
  });

  it('adapts severity', () => {
    const result = adaptDecisionSummary(summary, 5);
    expect(result.severity).toBe('high');
  });
});

// ── adaptOptionDecisionEvent ────────────────────────────────────

describe('adaptOptionDecisionEvent', () => {
  const event: ServerOptionDecisionEvent = {
    type: 'decision',
    subtype: 'option',
    agentId: 'agent-1',
    decisionId: 'dec-1',
    title: 'Choose DB',
    summary: 'Pick a database',
    severity: 'critical',
    confidence: 0.3,
    blastRadius: 'large',
    options: [
      { id: 'opt-1', label: 'Postgres', description: 'Relational DB' },
      { id: 'opt-2', label: 'Mongo', description: 'Document DB' },
    ],
    recommendedOptionId: 'opt-1',
    affectedArtifactIds: ['art-1', 'art-2'],
    requiresRationale: true,
  };

  it('maps decision fields', () => {
    const result = adaptOptionDecisionEvent(event, 10);
    expect(result.id).toBe('dec-1');
    expect(result.title).toBe('Choose DB');
    expect(result.summary).toBe('Pick a database');
  });

  it('maps options with recommended flag', () => {
    const result = adaptOptionDecisionEvent(event, 10);
    expect(result.options).toHaveLength(2);
    expect(result.options[0].recommended).toBe(true);
    expect(result.options[1].recommended).toBe(false);
  });

  it('adapts severity and blast radius', () => {
    const result = adaptOptionDecisionEvent(event, 10);
    expect(result.severity).toBe('critical');
    expect(result.blastRadius.magnitude).toBe('large');
  });

  it('computes attention score from severity and confidence', () => {
    const result = adaptOptionDecisionEvent(event, 10);
    // Critical severity + low confidence = high attention score
    expect(result.attentionScore).toBeGreaterThan(80);
  });

  it('sets requiresRationale', () => {
    const result = adaptOptionDecisionEvent(event, 10);
    expect(result.requiresRationale).toBe(true);
  });
});

// ── adaptWorkstreamSummary ──────────────────────────────────────

describe('adaptWorkstreamSummary', () => {
  const ws: ServerWorkstreamSummary = {
    id: 'ws-1',
    name: 'Frontend',
    status: 'active',
    activeAgentIds: ['agent-1', 'agent-2'],
    artifactCount: 5,
    pendingDecisionCount: 2,
    recentActivity: 'Building components',
  };

  it('maps id and name', () => {
    const result = adaptWorkstreamSummary(ws);
    expect(result.id).toBe('ws-1');
    expect(result.name).toBe('Frontend');
  });

  it('maps agent IDs', () => {
    const result = adaptWorkstreamSummary(ws);
    expect(result.agentIds).toEqual(['agent-1', 'agent-2']);
  });

  it('maps status', () => {
    const result = adaptWorkstreamSummary(ws);
    expect(result.status).toBe('active');
  });
});

// ── adaptStateSyncToState ───────────────────────────────────────

describe('adaptStateSyncToState', () => {
  const msg: StateSyncMessage = {
    type: 'state_sync',
    snapshot: {
      version: 10,
      generatedAt: '2024-01-01T00:00:00Z',
      workstreams: [
        { id: 'ws-1', name: 'Frontend', status: 'active', activeAgentIds: ['a1'], artifactCount: 2, pendingDecisionCount: 1, recentActivity: 'coding' },
      ],
      pendingDecisions: [
        { id: 'dec-1', title: 'Choose lib', severity: 'high', agentId: 'a1', subtype: 'option' },
      ],
      recentCoherenceIssues: [
        { id: 'coh-1', title: 'API drift', severity: 'medium', category: 'gap', affectedWorkstreams: ['ws-1'] },
      ],
      artifactIndex: [
        { id: 'art-1', name: 'app.ts', kind: 'code', status: 'draft', workstream: 'ws-1' },
      ],
      activeAgents: [
        { id: 'a1', role: 'coder', workstream: 'ws-1', status: 'running', pluginName: 'openai' },
      ],
      estimatedTokens: 1000,
    },
    activeAgents: [
      { id: 'a1', pluginName: 'openai', status: 'running', sessionId: 'sess-1' },
    ],
    trustScores: [
      { agentId: 'a1', score: 75 },
    ],
    controlMode: 'adaptive',
  };

  it('produces a project with the correct tick', () => {
    const state = adaptStateSyncToState(msg);
    expect(state.project?.currentTick).toBe(10);
  });

  it('produces the correct control mode', () => {
    const state = adaptStateSyncToState(msg);
    expect(state.project?.controlMode).toBe('adaptive');
    expect(state.controlConfig?.mode).toBe('adaptive');
  });

  it('adapts agents with trust scores', () => {
    const state = adaptStateSyncToState(msg);
    expect(state.project?.agents).toHaveLength(1);
    expect(state.project?.agents[0].id).toBe('a1');
    expect(state.project?.agents[0].trustScore).toBe(0.75);
  });

  it('adapts artifacts', () => {
    const state = adaptStateSyncToState(msg);
    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts?.[0].id).toBe('art-1');
  });

  it('adapts coherence issues', () => {
    const state = adaptStateSyncToState(msg);
    expect(state.coherenceIssues).toHaveLength(1);
    expect(state.coherenceIssues?.[0].id).toBe('coh-1');
  });

  it('adapts decisions', () => {
    const state = adaptStateSyncToState(msg);
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions?.[0].id).toBe('dec-1');
  });

  it('builds trust profiles', () => {
    const state = adaptStateSyncToState(msg);
    expect(state.trustProfiles).toHaveLength(1);
    expect(state.trustProfiles?.[0].agentId).toBe('a1');
    // Trust scores from backend are 0-100, frontend is 0-1
    expect(state.trustProfiles?.[0].currentScore).toBe(0.75);
  });
});

// ── adaptEnvelopeToTimelineEvent ────────────────────────────────

describe('adaptEnvelopeToTimelineEvent', () => {
  const baseEnvelope: Omit<ServerEventEnvelope, 'event'> = {
    sourceEventId: 'evt-1',
    sourceSequence: 1,
    sourceOccurredAt: '2024-01-01T00:00:00Z',
    runId: 'run-1',
    ingestedAt: '2024-01-01T00:00:01Z',
  };

  it('maps status events to agent_activity', () => {
    const envelope: ServerEventEnvelope = {
      ...baseEnvelope,
      event: { type: 'status', agentId: 'a1', message: 'Working on task' },
    };
    const result = adaptEnvelopeToTimelineEvent(envelope, 5);
    expect(result.category).toBe('agent_activity');
    expect(result.agentId).toBe('a1');
  });

  it('maps decision events to decision_created', () => {
    const envelope: ServerEventEnvelope = {
      ...baseEnvelope,
      event: {
        type: 'decision',
        subtype: 'option',
        agentId: 'a1',
        decisionId: 'dec-1',
        title: 'Choose DB',
        summary: 'Pick one',
        severity: 'high',
        confidence: 0.5,
        blastRadius: 'medium',
        options: [],
        affectedArtifactIds: [],
        requiresRationale: false,
      },
    };
    const result = adaptEnvelopeToTimelineEvent(envelope, 5);
    expect(result.category).toBe('decision_created');
    expect(result.relatedDecisionIds).toContain('dec-1');
  });

  it('maps artifact events', () => {
    const envelope: ServerEventEnvelope = {
      ...baseEnvelope,
      event: {
        type: 'artifact',
        agentId: 'a1',
        artifactId: 'art-1',
        name: 'app.ts',
        kind: 'code',
        workstream: 'ws-1',
        status: 'draft',
        qualityScore: 0.8,
        provenance: { createdBy: 'a1', createdAt: '2024-01-01T00:00:00Z' },
      },
    };
    const result = adaptEnvelopeToTimelineEvent(envelope, 5);
    expect(result.category).toBe('artifact_produced');
    expect(result.relatedArtifactIds).toContain('art-1');
  });

  it('maps coherence events', () => {
    const envelope: ServerEventEnvelope = {
      ...baseEnvelope,
      event: {
        type: 'coherence',
        agentId: 'a1',
        issueId: 'coh-1',
        title: 'API drift',
        description: 'Mismatch',
        category: 'gap',
        severity: 'medium',
        affectedWorkstreams: ['ws-1'],
        affectedArtifactIds: [],
      },
    };
    const result = adaptEnvelopeToTimelineEvent(envelope, 5);
    expect(result.category).toBe('coherence_detected');
    expect(result.relatedCoherenceIssueIds).toContain('coh-1');
  });

  it('maps lifecycle events', () => {
    const envelope: ServerEventEnvelope = {
      ...baseEnvelope,
      event: {
        type: 'lifecycle',
        agentId: 'a1',
        action: 'started',
      },
    };
    const result = adaptEnvelopeToTimelineEvent(envelope, 5);
    expect(result.category).toBe('agent_activity');
    expect(result.severity).toBe('info');
  });

  it('maps crash events as high severity', () => {
    const envelope: ServerEventEnvelope = {
      ...baseEnvelope,
      event: {
        type: 'lifecycle',
        agentId: 'a1',
        action: 'crashed',
        reason: 'OOM',
      },
    };
    const result = adaptEnvelopeToTimelineEvent(envelope, 5);
    expect(result.severity).toBe('high');
  });

  it('preserves tick', () => {
    const envelope: ServerEventEnvelope = {
      ...baseEnvelope,
      event: { type: 'status', agentId: 'a1', message: 'test' },
    };
    const result = adaptEnvelopeToTimelineEvent(envelope, 42);
    expect(result.tick).toBe(42);
  });
});

// ── adaptFrontendResolution ─────────────────────────────────────

describe('adaptFrontendResolution', () => {
  it('creates an option resolution', () => {
    const result = adaptFrontendResolution('opt-1', 'approve', 'Looks good');
    expect(result.type).toBe('option');
    if (result.type === 'option') {
      expect(result.chosenOptionId).toBe('opt-1');
      expect(result.rationale).toBe('Looks good');
    }
  });

  it('maps frontend actionKind to backend actionKind', () => {
    const result = adaptFrontendResolution('opt-1', 'approve', 'ok');
    expect(result.actionKind).toBe('review');
  });

  it('maps override to update', () => {
    const result = adaptFrontendResolution('opt-1', 'override', 'custom');
    expect(result.actionKind).toBe('update');
  });
});

// ── adaptBrakeAction ────────────────────────────────────────────

describe('adaptBrakeAction', () => {
  it('returns engaged: true', () => {
    const action: ServerBrakeAction = {
      scope: { type: 'all' },
      reason: 'Safety concern',
      behavior: 'pause',
      initiatedBy: 'human',
      timestamp: '2024-01-01T00:00:00Z',
    };
    const result = adaptBrakeAction(action);
    expect(result.engaged).toBe(true);
    expect(result.reason).toBe('Safety concern');
  });
});
