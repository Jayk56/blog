import { projectReducer, initialState } from './reducer.js';
import type {
  ProjectState,
  DecisionItem,
  CoherenceIssue,
  Checkpoint,
  ModeShiftRecommendation,
} from '../types/index.js';

// ── Test helpers ──────────────────────────────────────────────────

function makeDecision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: 'dec-1',
    title: 'Test decision',
    summary: 'A test decision',
    type: 'architectural',
    severity: 'medium',
    confidence: 0.7,
    blastRadius: { artifactCount: 2, workstreamCount: 1, agentCount: 1, magnitude: 'small' },
    options: [
      { id: 'opt-a', label: 'Option A', description: 'First option', consequence: 'Consequence A', recommended: true, actionKind: 'approve' },
      { id: 'opt-b', label: 'Option B', description: 'Second option', consequence: 'Consequence B', recommended: false, actionKind: 'reject' },
    ],
    affectedArtifactIds: ['art-1'],
    relatedWorkstreamIds: ['ws-1'],
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
    title: 'Dependency conflict',
    description: 'Duplicate date libraries',
    category: 'dependency_conflict',
    severity: 'high',
    status: 'detected',
    workstreamIds: ['ws-1', 'ws-2'],
    agentIds: ['agent-1', 'agent-2'],
    artifactIds: ['art-1'],
    suggestedResolution: 'Standardize on date-fns',
    detectedAtTick: 2,
    resolvedAtTick: null,
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'cp-1',
    name: 'Phase transition gate',
    trigger: 'phase_transition',
    description: 'Review before moving to next phase',
    enabled: true,
    customCondition: null,
    ...overrides,
  };
}

function makeRecommendation(overrides: Partial<ModeShiftRecommendation> = {}): ModeShiftRecommendation {
  return {
    id: 'rec-1',
    recommendedMode: 'ecosystem',
    currentMode: 'orchestrator',
    rationale: 'Project is mature enough for more autonomy',
    signals: [{ source: 'team_maturity', observation: 'High trust established', weight: 0.8 }],
    status: 'pending',
    createdAtTick: 3,
    ...overrides,
  };
}

function makeLoadedState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    ...initialState,
    project: {
      id: 'proj-1',
      name: 'Test Project',
      description: 'A test project',
      persona: 'david',
      phase: 'execution',
      controlMode: 'adaptive',
      riskProfile: { level: 'medium', domainExpertise: 'shared', teamMaturity: 'established' },
      agents: [
        { id: 'agent-1', name: 'Code Agent', role: 'code', trustScore: 0.8, active: true },
        { id: 'agent-2', name: 'Docs Agent', role: 'docs', trustScore: 0.7, active: true },
      ],
      workstreams: [
        { id: 'ws-1', name: 'Backend', description: 'Backend work', agentIds: ['agent-1'], dependsOn: [], status: 'active' },
      ],
      goals: ['Ship v1'],
      constraints: ['No breaking API changes'],
      currentTick: 5,
      emergencyBrakeEngaged: false,
      createdAt: '2025-01-01T00:00:00Z',
    },
    decisions: [makeDecision()],
    coherenceIssues: [makeCoherenceIssue()],
    trustProfiles: [
      { agentId: 'agent-1', currentScore: 0.8, trend: 'stable', trajectory: [], scoreByDomain: {} },
    ],
    controlConfig: {
      mode: 'adaptive',
      topology: [],
      checkpoints: [makeCheckpoint()],
      bias: { value: 50 },
      riskAwareGating: true,
      pendingRecommendations: [makeRecommendation()],
    },
    ...overrides,
  };
}

// ── initialState ──────────────────────────────────────────────────

describe('initialState', () => {
  it('has null project', () => {
    expect(initialState.project).toBeNull();
  });

  it('has empty collections', () => {
    expect(initialState.decisions).toEqual([]);
    expect(initialState.coherenceIssues).toEqual([]);
    expect(initialState.artifacts).toEqual([]);
    expect(initialState.timeline).toEqual([]);
    expect(initialState.decisionLog).toEqual([]);
  });

  it('defaults to adaptive mode', () => {
    expect(initialState.controlConfig.mode).toBe('adaptive');
  });

  it('defaults coherence score to 100', () => {
    expect(initialState.metrics.coherenceScore).toBe(100);
  });

  it('defaults autoSimulate to false', () => {
    expect(initialState.autoSimulate).toBe(false);
  });
});

// ── advance-tick ──────────────────────────────────────────────────

describe('advance-tick', () => {
  it('increments the project tick by 1', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, { type: 'advance-tick' });
    expect(next.project!.currentTick).toBe(6);
  });

  it('does nothing when no project is loaded', () => {
    const next = projectReducer(initialState, { type: 'advance-tick' });
    expect(next.project).toBeNull();
  });

  it('does nothing when emergency brake is engaged', () => {
    const state = makeLoadedState();
    state.project!.emergencyBrakeEngaged = true;
    const next = projectReducer(state, { type: 'advance-tick' });
    expect(next.project!.currentTick).toBe(5); // unchanged
  });
});

// ── resolve-decision ──────────────────────────────────────────────

describe('resolve-decision', () => {
  it('marks the decision as resolved', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, {
      type: 'resolve-decision',
      decisionId: 'dec-1',
      chosenOptionId: 'opt-a',
      actionKind: 'approve',
      rationale: 'Option A is better',
    });
    const decision = next.decisions.find((d) => d.id === 'dec-1')!;
    expect(decision.resolved).toBe(true);
    expect(decision.resolution).not.toBeNull();
    expect(decision.resolution!.chosenOptionId).toBe('opt-a');
    expect(decision.resolution!.actionKind).toBe('approve');
    expect(decision.resolution!.rationale).toBe('Option A is better');
  });

  it('adds a timeline event', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, {
      type: 'resolve-decision',
      decisionId: 'dec-1',
      chosenOptionId: 'opt-a',
      actionKind: 'approve',
      rationale: 'Looks good',
    });
    expect(next.timeline.length).toBeGreaterThan(state.timeline.length);
    const event = next.timeline[next.timeline.length - 1];
    expect(event.category).toBe('decision_resolved');
    expect(event.source).toBe('human');
  });

  it('adds a decision log entry', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, {
      type: 'resolve-decision',
      decisionId: 'dec-1',
      chosenOptionId: 'opt-a',
      actionKind: 'approve',
      rationale: 'Test rationale',
    });
    expect(next.decisionLog.length).toBeGreaterThan(state.decisionLog.length);
    const entry = next.decisionLog[next.decisionLog.length - 1];
    expect(entry.actionKind).toBe('approve');
    expect(entry.rationale).toBe('Test rationale');
  });

  it('does nothing when no project is loaded', () => {
    const next = projectReducer(initialState, {
      type: 'resolve-decision',
      decisionId: 'dec-1',
      chosenOptionId: 'opt-a',
      actionKind: 'approve',
      rationale: 'test',
    });
    expect(next).toEqual(initialState);
  });
});

// ── resolve-issue ─────────────────────────────────────────────────

describe('resolve-issue', () => {
  it('updates the issue status', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, {
      type: 'resolve-issue',
      issueId: 'issue-1',
      newStatus: 'resolved',
    });
    const issue = next.coherenceIssues.find((i) => i.id === 'issue-1')!;
    expect(issue.status).toBe('resolved');
  });

  it('sets resolvedAtTick for terminal statuses', () => {
    const state = makeLoadedState();
    for (const status of ['resolved', 'accepted', 'dismissed'] as const) {
      const next = projectReducer(state, {
        type: 'resolve-issue',
        issueId: 'issue-1',
        newStatus: status,
      });
      const issue = next.coherenceIssues.find((i) => i.id === 'issue-1')!;
      expect(issue.resolvedAtTick).toBe(5);
    }
  });

  it('does not set resolvedAtTick for non-terminal statuses', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, {
      type: 'resolve-issue',
      issueId: 'issue-1',
      newStatus: 'confirmed',
    });
    const issue = next.coherenceIssues.find((i) => i.id === 'issue-1')!;
    expect(issue.resolvedAtTick).toBeNull();
  });

  it('adds a timeline event', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, {
      type: 'resolve-issue',
      issueId: 'issue-1',
      newStatus: 'resolved',
    });
    const event = next.timeline[next.timeline.length - 1];
    expect(event.category).toBe('coherence_resolved');
  });
});

// ── set-mode ──────────────────────────────────────────────────────

describe('set-mode', () => {
  it('changes the project control mode', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, { type: 'set-mode', mode: 'ecosystem' });
    expect(next.project!.controlMode).toBe('ecosystem');
    expect(next.controlConfig.mode).toBe('ecosystem');
  });

  it('adds a timeline event for mode change', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, { type: 'set-mode', mode: 'orchestrator' });
    const event = next.timeline[next.timeline.length - 1];
    expect(event.category).toBe('mode_changed');
    expect(event.title).toContain('orchestrator');
  });

  it('does nothing when no project is loaded', () => {
    const next = projectReducer(initialState, { type: 'set-mode', mode: 'ecosystem' });
    expect(next.controlConfig.mode).toBe('adaptive'); // unchanged from initial
  });
});

// ── set-bias ──────────────────────────────────────────────────────

describe('set-bias', () => {
  it('updates the throughput/quality bias', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, { type: 'set-bias', bias: { value: 80 } });
    expect(next.controlConfig.bias.value).toBe(80);
  });

  it('preserves other control config values', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, { type: 'set-bias', bias: { value: 20 } });
    expect(next.controlConfig.riskAwareGating).toBe(state.controlConfig.riskAwareGating);
    expect(next.controlConfig.checkpoints).toEqual(state.controlConfig.checkpoints);
  });
});

// ── emergency-brake ───────────────────────────────────────────────

describe('emergency-brake', () => {
  it('engages the emergency brake', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, { type: 'emergency-brake', engaged: true });
    expect(next.project!.emergencyBrakeEngaged).toBe(true);
  });

  it('disengages the emergency brake', () => {
    const state = makeLoadedState();
    state.project!.emergencyBrakeEngaged = true;
    const next = projectReducer(state, { type: 'emergency-brake', engaged: false });
    expect(next.project!.emergencyBrakeEngaged).toBe(false);
  });

  it('turns off auto-simulate when brake is engaged', () => {
    const state = makeLoadedState();
    state.autoSimulate = true;
    const next = projectReducer(state, { type: 'emergency-brake', engaged: true });
    expect(next.autoSimulate).toBe(false);
  });

  it('adds a timeline event with critical severity', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, { type: 'emergency-brake', engaged: true });
    const event = next.timeline[next.timeline.length - 1];
    expect(event.category).toBe('emergency_brake');
    expect(event.severity).toBe('critical');
  });
});

// ── inject-context ────────────────────────────────────────────────

describe('inject-context', () => {
  it('adds context to project constraints', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, {
      type: 'inject-context',
      context: 'New requirement: support dark mode',
    });
    expect(next.project!.constraints).toContain('New requirement: support dark mode');
  });

  it('preserves existing constraints', () => {
    const state = makeLoadedState();
    const originalConstraints = [...state.project!.constraints];
    const next = projectReducer(state, {
      type: 'inject-context',
      context: 'Additional constraint',
    });
    for (const c of originalConstraints) {
      expect(next.project!.constraints).toContain(c);
    }
  });

  it('adds a timeline event', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, {
      type: 'inject-context',
      context: 'Requirements changed',
    });
    const event = next.timeline[next.timeline.length - 1];
    expect(event.category).toBe('context_injected');
    expect(event.description).toBe('Requirements changed');
  });
});

// ── reverse-decision ──────────────────────────────────────────────

describe('reverse-decision', () => {
  it('marks the decision as unresolved and its resolution as reversed', () => {
    const state = makeLoadedState({
      decisions: [
        makeDecision({
          id: 'dec-1',
          resolved: true,
          resolution: {
            chosenOptionId: 'opt-a',
            actionKind: 'approve',
            rationale: 'Good',
            resolvedAtTick: 3,
            reversed: false,
          },
        }),
      ],
    });
    const next = projectReducer(state, {
      type: 'reverse-decision',
      decisionId: 'dec-1',
      reason: 'Changed requirements',
    });
    const decision = next.decisions.find((d) => d.id === 'dec-1')!;
    expect(decision.resolved).toBe(false);
    expect(decision.resolution!.reversed).toBe(true);
  });

  it('adds a timeline event with high severity', () => {
    const state = makeLoadedState({
      decisions: [
        makeDecision({
          id: 'dec-1',
          resolved: true,
          resolution: {
            chosenOptionId: 'opt-a',
            actionKind: 'approve',
            rationale: 'Good',
            resolvedAtTick: 3,
            reversed: false,
          },
        }),
      ],
    });
    const next = projectReducer(state, {
      type: 'reverse-decision',
      decisionId: 'dec-1',
      reason: 'Wrong choice',
    });
    const event = next.timeline[next.timeline.length - 1];
    expect(event.category).toBe('decision_reversed');
    expect(event.severity).toBe('high');
  });
});

// ── retroactive-review ───────────────────────────────────────────

describe('retroactive-review', () => {
  it('flags the decision log entry for review', () => {
    const state = makeLoadedState({
      decisions: [makeDecision({ id: 'dec-1', title: 'Test decision' })],
      decisionLog: [
        {
          id: 'log-1',
          tick: 3,
          source: 'human',
          agentId: null,
          title: 'Test decision',
          summary: 'Chose Option A',
          actionKind: 'approve',
          rationale: 'Good',
          reversible: true,
          reversed: false,
          flaggedForReview: false,
        },
      ],
    });
    const next = projectReducer(state, {
      type: 'retroactive-review',
      decisionId: 'dec-1',
    });
    const entry = next.decisionLog.find((d) => d.title === 'Test decision')!;
    expect(entry.flaggedForReview).toBe(true);
  });
});

// ── toggle-checkpoint ─────────────────────────────────────────────

describe('toggle-checkpoint', () => {
  it('disables a checkpoint', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, {
      type: 'toggle-checkpoint',
      checkpointId: 'cp-1',
      enabled: false,
    });
    const cp = next.controlConfig.checkpoints.find((c) => c.id === 'cp-1')!;
    expect(cp.enabled).toBe(false);
  });

  it('enables a checkpoint', () => {
    const state = makeLoadedState();
    state.controlConfig.checkpoints[0].enabled = false;
    const next = projectReducer(state, {
      type: 'toggle-checkpoint',
      checkpointId: 'cp-1',
      enabled: true,
    });
    const cp = next.controlConfig.checkpoints.find((c) => c.id === 'cp-1')!;
    expect(cp.enabled).toBe(true);
  });

  it('does not affect other checkpoints', () => {
    const state = makeLoadedState({
      controlConfig: {
        ...makeLoadedState().controlConfig,
        checkpoints: [
          makeCheckpoint({ id: 'cp-1', enabled: true }),
          makeCheckpoint({ id: 'cp-2', enabled: true }),
        ],
      },
    });
    const next = projectReducer(state, {
      type: 'toggle-checkpoint',
      checkpointId: 'cp-1',
      enabled: false,
    });
    const cp2 = next.controlConfig.checkpoints.find((c) => c.id === 'cp-2')!;
    expect(cp2.enabled).toBe(true);
  });
});

// ── accept-recommendation ─────────────────────────────────────────

describe('accept-recommendation', () => {
  it('marks the recommendation as accepted and applies the mode', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, {
      type: 'accept-recommendation',
      recommendationId: 'rec-1',
    });
    const rec = next.controlConfig.pendingRecommendations.find((r) => r.id === 'rec-1')!;
    expect(rec.status).toBe('accepted');
    expect(next.project!.controlMode).toBe('ecosystem'); // from the recommendation
    expect(next.controlConfig.mode).toBe('ecosystem');
  });

  it('does nothing for unknown recommendation', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, {
      type: 'accept-recommendation',
      recommendationId: 'nonexistent',
    });
    expect(next.project!.controlMode).toBe(state.project!.controlMode);
  });
});

// ── reject-recommendation ─────────────────────────────────────────

describe('reject-recommendation', () => {
  it('marks the recommendation as rejected without changing mode', () => {
    const state = makeLoadedState();
    const originalMode = state.project!.controlMode;
    const next = projectReducer(state, {
      type: 'reject-recommendation',
      recommendationId: 'rec-1',
    });
    const rec = next.controlConfig.pendingRecommendations.find((r) => r.id === 'rec-1')!;
    expect(rec.status).toBe('rejected');
    expect(next.project!.controlMode).toBe(originalMode);
  });
});

// ── toggle-auto-simulate ──────────────────────────────────────────

describe('toggle-auto-simulate', () => {
  it('toggles autoSimulate from false to true', () => {
    const state = makeLoadedState();
    state.autoSimulate = false;
    const next = projectReducer(state, { type: 'toggle-auto-simulate' });
    expect(next.autoSimulate).toBe(true);
  });

  it('toggles autoSimulate from true to false', () => {
    const state = makeLoadedState();
    state.autoSimulate = true;
    const next = projectReducer(state, { type: 'toggle-auto-simulate' });
    expect(next.autoSimulate).toBe(false);
  });
});

// ── Derived value recomputation ──────────────────────────────────

describe('derived value recomputation', () => {
  it('recomputes metrics after every action', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, { type: 'advance-tick' });
    // Metrics should reflect the current state
    expect(next.metrics.pendingDecisionCount).toBe(
      next.decisions.filter((d) => !d.resolved).length,
    );
  });

  it('recomputes briefing after every action', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, { type: 'advance-tick' });
    expect(next.briefing).toBeTruthy();
    expect(next.briefing).toContain('Test Project');
  });

  it('recomputes topology after every action', () => {
    const state = makeLoadedState();
    const next = projectReducer(state, { type: 'advance-tick' });
    expect(next.controlConfig.topology).toHaveLength(4);
  });
});
