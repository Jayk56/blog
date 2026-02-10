import { buildBriefing, buildOneLiner } from './narrative.js';
import type {
  ProjectState,
  TimelineEvent,
  DecisionItem,
  CoherenceIssue,
} from '../types/index.js';
import { initialState } from './reducer.js';

// ── Test helpers ──────────────────────────────────────────────────

function makeProjectState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    ...initialState,
    project: {
      id: 'proj-1',
      name: 'Content Studio',
      description: 'A content production project',
      persona: 'maya',
      phase: 'execution',
      controlMode: 'adaptive',
      riskProfile: {
        level: 'medium',
        domainExpertise: 'human_expert',
        teamMaturity: 'established',
      },
      agents: [
        { id: 'agent-1', name: 'Writing Agent', role: 'writer', trustScore: 0.8, active: true },
        { id: 'agent-2', name: 'Research Agent', role: 'researcher', trustScore: 0.9, active: true },
      ],
      workstreams: [],
      goals: ['Publish weekly newsletter'],
      constraints: [],
      currentTick: 10,
      emergencyBrakeEngaged: false,
      createdAt: '2025-01-01T00:00:00Z',
    },
    metrics: {
      ...initialState.metrics,
      coherenceScore: 85,
      reworkRisk: 15,
    },
    ...overrides,
  };
}

function makeDecision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: 'dec-1',
    title: 'Choose article tone',
    summary: 'Should the article be formal or conversational?',
    type: 'content',
    severity: 'medium',
    confidence: 0.7,
    blastRadius: { artifactCount: 2, workstreamCount: 1, agentCount: 1, magnitude: 'small' },
    options: [],
    affectedArtifactIds: [],
    relatedWorkstreamIds: [],
    sourceAgentId: 'agent-1',
    attentionScore: 50,
    requiresRationale: false,
    createdAtTick: 1,
    dueByTick: null,
    resolved: false,
    resolution: null,
    ...overrides,
  };
}

function makeCoherenceIssue(overrides: Partial<CoherenceIssue> = {}): CoherenceIssue {
  return {
    id: 'issue-1',
    title: 'Tone inconsistency',
    description: 'Different articles use different voice',
    category: 'style_divergence',
    severity: 'medium',
    status: 'detected',
    workstreamIds: ['ws-1', 'ws-2'],
    agentIds: ['agent-1'],
    artifactIds: ['art-1'],
    suggestedResolution: null,
    detectedAtTick: 8,
    resolvedAtTick: null,
    ...overrides,
  };
}

function makeTimelineEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'evt-1',
    tick: 9,
    source: 'agent',
    agentId: 'agent-1',
    category: 'artifact_produced',
    severity: 'info',
    title: 'Produced draft article',
    description: 'Writing Agent produced a draft of the weekly newsletter',
    relatedArtifactIds: ['art-1'],
    relatedDecisionIds: [],
    relatedCoherenceIssueIds: [],
    ...overrides,
  };
}

// ── buildBriefing ─────────────────────────────────────────────────

describe('buildBriefing', () => {
  it('returns fallback text when no project is loaded', () => {
    const result = buildBriefing(initialState);
    expect(result).toContain('No project loaded');
  });

  it('includes project name and phase in opening summary', () => {
    const state = makeProjectState();
    const result = buildBriefing(state);
    expect(result).toContain('Content Studio');
    expect(result).toContain('execution');
  });

  it('includes control mode in opening summary', () => {
    const state = makeProjectState();
    const result = buildBriefing(state);
    expect(result).toContain('adaptive');
  });

  it('mentions coherence score', () => {
    const state = makeProjectState({
      metrics: { ...initialState.metrics, coherenceScore: 85 },
    });
    const result = buildBriefing(state);
    expect(result).toContain('85');
  });

  it('flags low coherence score', () => {
    const state = makeProjectState({
      metrics: { ...initialState.metrics, coherenceScore: 40, reworkRisk: 50 },
    });
    const result = buildBriefing(state);
    expect(result).toContain('low');
  });

  it('mentions elevated rework risk', () => {
    const state = makeProjectState({
      metrics: { ...initialState.metrics, coherenceScore: 85, reworkRisk: 60 },
    });
    const result = buildBriefing(state);
    expect(result).toContain('60');
  });

  it('includes recent activity section when events exist', () => {
    const state = makeProjectState({
      timeline: [
        makeTimelineEvent({ tick: 9, category: 'decision_resolved', title: 'Resolved a decision' }),
        makeTimelineEvent({ id: 'evt-2', tick: 8, category: 'artifact_produced', title: 'Produced artifact' }),
      ],
    });
    const result = buildBriefing(state);
    expect(result).toContain('Since your last visit');
  });

  it('includes attention section when pending decisions exist', () => {
    const state = makeProjectState({
      decisions: [makeDecision({ resolved: false, attentionScore: 80 })],
    });
    const result = buildBriefing(state);
    expect(result).toContain('Needs your attention');
    expect(result).toContain('Choose article tone');
  });

  it('highlights critical coherence issues', () => {
    const state = makeProjectState({
      coherenceIssues: [
        makeCoherenceIssue({
          severity: 'critical',
          title: 'API contract broken',
          status: 'detected',
        }),
      ],
    });
    const result = buildBriefing(state);
    expect(result).toContain('critical coherence issue');
    expect(result).toContain('API contract broken');
  });

  it('includes overdue decision warnings', () => {
    const state = makeProjectState({
      decisions: [makeDecision({ resolved: false, dueByTick: 5 })], // overdue at tick 10
    });
    const result = buildBriefing(state);
    expect(result).toContain('overdue');
  });

  it('includes agent activity section when agents have events', () => {
    const state = makeProjectState({
      timeline: [
        makeTimelineEvent({ tick: 9, source: 'agent', agentId: 'agent-1', title: 'Wrote draft' }),
      ],
    });
    const result = buildBriefing(state);
    expect(result).toContain('Agent activity');
    expect(result).toContain('Writing Agent');
  });

  it('includes control recommendation when pending', () => {
    const state = makeProjectState({
      controlConfig: {
        ...initialState.controlConfig,
        pendingRecommendations: [
          {
            id: 'rec-1',
            recommendedMode: 'ecosystem',
            currentMode: 'orchestrator',
            rationale: 'Project is mature enough',
            signals: [],
            status: 'pending',
            createdAtTick: 8,
          },
        ],
      },
    });
    const result = buildBriefing(state);
    expect(result).toContain('System recommendation');
    expect(result).toContain('ecosystem');
  });

  it('omits empty sections', () => {
    const state = makeProjectState({
      decisions: [],
      coherenceIssues: [],
      timeline: [],
      controlConfig: {
        ...initialState.controlConfig,
        pendingRecommendations: [],
      },
    });
    const result = buildBriefing(state);
    expect(result).not.toContain('Since your last visit');
    expect(result).not.toContain('Needs your attention');
    expect(result).not.toContain('Agent activity');
    expect(result).not.toContain('System recommendation');
  });
});

// ── buildOneLiner ─────────────────────────────────────────────────

describe('buildOneLiner', () => {
  it('returns fallback when no project loaded', () => {
    expect(buildOneLiner(initialState)).toBe('No project loaded');
  });

  it('shows all clear when no pending items', () => {
    const state = makeProjectState({
      decisions: [],
      coherenceIssues: [],
    });
    const result = buildOneLiner(state);
    expect(result).toContain('all clear');
    expect(result).toContain('Content Studio');
  });

  it('shows decision count when decisions are pending', () => {
    const state = makeProjectState({
      decisions: [
        makeDecision({ id: 'd1', resolved: false }),
        makeDecision({ id: 'd2', resolved: false }),
      ],
    });
    const result = buildOneLiner(state);
    expect(result).toContain('2 decisions');
  });

  it('highlights critical decisions specially', () => {
    const state = makeProjectState({
      decisions: [
        makeDecision({ id: 'd1', severity: 'critical', resolved: false }),
        makeDecision({ id: 'd2', severity: 'medium', resolved: false }),
      ],
    });
    const result = buildOneLiner(state);
    expect(result).toContain('critical decision');
  });

  it('shows coherence issue count', () => {
    const state = makeProjectState({
      decisions: [],
      coherenceIssues: [
        makeCoherenceIssue({ id: 'i1', status: 'detected' }),
        makeCoherenceIssue({ id: 'i2', status: 'confirmed' }),
      ],
    });
    const result = buildOneLiner(state);
    expect(result).toContain('2 coherence issues');
  });

  it('shows emergency brake message when engaged', () => {
    const state = makeProjectState();
    state.project!.emergencyBrakeEngaged = true;
    const result = buildOneLiner(state);
    expect(result).toContain('EMERGENCY BRAKE');
  });

  it('combines decisions and coherence issues with separator', () => {
    const state = makeProjectState({
      decisions: [makeDecision({ resolved: false })],
      coherenceIssues: [makeCoherenceIssue({ status: 'detected' })],
    });
    const result = buildOneLiner(state);
    expect(result).toContain('\u00b7'); // middle dot separator
  });
});
