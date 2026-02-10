import {
  attentionPriority,
  coherenceScore,
  coherenceTrend,
  buildCoherenceScore,
  reworkRisk,
  trustScore,
  trustTrend,
  averageTrustScore,
  highSeverityMissRate,
  humanInterventionRate,
  computeReviewPatterns,
  computeMetrics,
} from './scoring.js';
import type {
  DecisionItem,
  CoherenceIssue,
  TrustProfile,
  TrustSnapshot,
  Artifact,
  ProjectState,
} from '../types/index.js';
import { initialState } from './reducer.js';

// ── Test helpers ──────────────────────────────────────────────────

function makeDecision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: 'dec-1',
    title: 'Test decision',
    summary: 'A test decision',
    type: 'architectural',
    severity: 'medium',
    confidence: 0.7,
    blastRadius: {
      artifactCount: 2,
      workstreamCount: 1,
      agentCount: 1,
      magnitude: 'small',
    },
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
    title: 'Test issue',
    description: 'A test coherence issue',
    category: 'dependency_conflict',
    severity: 'medium',
    status: 'detected',
    workstreamIds: ['ws-1', 'ws-2'],
    agentIds: ['agent-1'],
    artifactIds: ['art-1'],
    suggestedResolution: null,
    detectedAtTick: 1,
    resolvedAtTick: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<TrustSnapshot> = {}): TrustSnapshot {
  return {
    tick: 1,
    score: 0.8,
    successCount: 8,
    overrideCount: 1,
    reworkCount: 1,
    totalTasks: 10,
    ...overrides,
  };
}

function makeTrustProfile(overrides: Partial<TrustProfile> = {}): TrustProfile {
  return {
    agentId: 'agent-1',
    currentScore: 0.8,
    trend: 'stable',
    trajectory: [makeSnapshot()],
    scoreByDomain: {},
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art-1',
    name: 'test-file.ts',
    kind: 'code',
    description: 'A test file',
    workstreamId: 'ws-1',
    provenance: {
      sourceArtifactIds: [],
      producerAgentId: 'agent-1',
      validatorAgentIds: [],
      humanReviewerId: null,
      relatedDecisionIds: [],
      producedAtTick: 1,
      lastModifiedAtTick: 1,
    },
    qualityScore: 0.9,
    status: 'approved',
    ...overrides,
  };
}

function makeProjectState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    ...initialState,
    project: {
      id: 'proj-1',
      name: 'Test Project',
      description: 'A test project',
      persona: 'maya',
      phase: 'execution',
      controlMode: 'adaptive',
      riskProfile: {
        level: 'medium',
        domainExpertise: 'shared',
        teamMaturity: 'established',
      },
      agents: [{ id: 'agent-1', name: 'Code Agent', role: 'code', trustScore: 0.8, active: true }],
      workstreams: [],
      goals: ['Ship v1'],
      constraints: [],
      currentTick: 5,
      emergencyBrakeEngaged: false,
      createdAt: '2025-01-01T00:00:00Z',
    },
    ...overrides,
  };
}

// ── attentionPriority ─────────────────────────────────────────────

describe('attentionPriority', () => {
  it('returns higher priority for critical severity', () => {
    const critical = makeDecision({ severity: 'critical' });
    const low = makeDecision({ severity: 'low' });
    expect(attentionPriority(critical, 5)).toBeGreaterThan(attentionPriority(low, 5));
  });

  it('returns higher priority for low confidence', () => {
    const lowConf = makeDecision({ confidence: 0.1 });
    const highConf = makeDecision({ confidence: 0.9 });
    expect(attentionPriority(lowConf, 5)).toBeGreaterThan(attentionPriority(highConf, 5));
  });

  it('returns higher priority for large blast radius', () => {
    const large = makeDecision({
      blastRadius: { artifactCount: 10, workstreamCount: 5, agentCount: 5, magnitude: 'large' },
    });
    const small = makeDecision({
      blastRadius: { artifactCount: 1, workstreamCount: 1, agentCount: 1, magnitude: 'small' },
    });
    expect(attentionPriority(large, 5)).toBeGreaterThan(attentionPriority(small, 5));
  });

  it('gives max urgency score for overdue decisions', () => {
    const overdue = makeDecision({ dueByTick: 3 }); // due at tick 3, current is 5
    const notDue = makeDecision({ dueByTick: null });
    expect(attentionPriority(overdue, 5)).toBeGreaterThan(attentionPriority(notDue, 5));
  });

  it('gives partial urgency for approaching deadline', () => {
    const approaching = makeDecision({ dueByTick: 7 }); // 2 ticks away
    const farAway = makeDecision({ dueByTick: 100 });
    expect(attentionPriority(approaching, 5)).toBeGreaterThan(attentionPriority(farAway, 5));
  });

  it('caps the score at 100', () => {
    const extreme = makeDecision({
      severity: 'critical',
      confidence: 0,
      blastRadius: { artifactCount: 20, workstreamCount: 10, agentCount: 10, magnitude: 'large' },
      dueByTick: 1,
    });
    expect(attentionPriority(extreme, 5)).toBeLessThanOrEqual(100);
  });

  it('returns a rounded integer', () => {
    const dec = makeDecision({ confidence: 0.33 });
    const score = attentionPriority(dec, 5);
    expect(score).toBe(Math.round(score));
  });
});

// ── coherenceScore ────────────────────────────────────────────────

describe('coherenceScore', () => {
  it('returns 100 when there are no issues', () => {
    expect(coherenceScore([])).toBe(100);
  });

  it('returns 100 when all issues are resolved', () => {
    const issues = [
      makeCoherenceIssue({ status: 'resolved' }),
      makeCoherenceIssue({ id: 'issue-2', status: 'accepted' }),
      makeCoherenceIssue({ id: 'issue-3', status: 'dismissed' }),
    ];
    expect(coherenceScore(issues)).toBe(100);
  });

  it('decrements by severity weight for active issues', () => {
    // medium severity = 10 points penalty
    const issues = [makeCoherenceIssue({ severity: 'medium', status: 'detected' })];
    expect(coherenceScore(issues)).toBe(90);
  });

  it('stacks penalties for multiple active issues', () => {
    const issues = [
      makeCoherenceIssue({ id: 'i1', severity: 'medium', status: 'detected' }), // -10
      makeCoherenceIssue({ id: 'i2', severity: 'high', status: 'confirmed' }),   // -20
    ];
    expect(coherenceScore(issues)).toBe(70);
  });

  it('floors at 0', () => {
    const issues = Array.from({ length: 10 }, (_, i) =>
      makeCoherenceIssue({ id: `i-${i}`, severity: 'critical', status: 'detected' }),
    );
    expect(coherenceScore(issues)).toBe(0);
  });

  it('counts in_progress issues as active', () => {
    const issues = [makeCoherenceIssue({ severity: 'high', status: 'in_progress' })];
    expect(coherenceScore(issues)).toBe(80); // 100 - 20
  });
});

// ── coherenceTrend ───────────────────────────────────────────────

describe('coherenceTrend', () => {
  it('returns improving when score increased by more than 2', () => {
    expect(coherenceTrend(85, 80)).toBe('improving');
  });

  it('returns declining when score dropped by more than 2', () => {
    expect(coherenceTrend(75, 80)).toBe('declining');
  });

  it('returns stable when change is within 2', () => {
    expect(coherenceTrend(81, 80)).toBe('stable');
    expect(coherenceTrend(79, 80)).toBe('stable');
    expect(coherenceTrend(80, 80)).toBe('stable');
  });

  it('returns stable at exactly +2 delta', () => {
    expect(coherenceTrend(82, 80)).toBe('stable');
  });

  it('returns improving at +3 delta', () => {
    expect(coherenceTrend(83, 80)).toBe('improving');
  });
});

// ── buildCoherenceScore ──────────────────────────────────────────

describe('buildCoherenceScore', () => {
  it('returns the correct structure', () => {
    const issues = [
      makeCoherenceIssue({ id: 'i1', severity: 'high', status: 'detected' }),
      makeCoherenceIssue({ id: 'i2', severity: 'medium', status: 'confirmed' }),
      makeCoherenceIssue({ id: 'i3', severity: 'low', status: 'resolved' }),
    ];
    const result = buildCoherenceScore(issues, 100);
    expect(result.value).toBe(70); // 100 - 20 - 10
    expect(result.trend).toBe('declining');
    expect(result.openIssuesBySeverity.high).toBe(1);
    expect(result.openIssuesBySeverity.medium).toBe(1);
    expect(result.openIssuesBySeverity.low).toBe(0); // resolved, not counted
    expect(result.openIssuesBySeverity.critical).toBe(0);
    expect(result.openIssuesBySeverity.info).toBe(0);
  });
});

// ── trustScore ────────────────────────────────────────────────────

describe('trustScore', () => {
  it('returns 0.5 for zero-task agents (neutral start)', () => {
    expect(trustScore(makeSnapshot({ totalTasks: 0 }))).toBe(0.5);
  });

  it('returns high score for mostly successful agents', () => {
    const snap = makeSnapshot({
      successCount: 9,
      overrideCount: 0,
      reworkCount: 1,
      totalTasks: 10,
    });
    const score = trustScore(snap);
    // successRate = 0.9, overrideRate = 0, reworkRate = 0.1
    // score = 0.9 - 0 - 0.05 = 0.85
    expect(score).toBeCloseTo(0.85, 2);
  });

  it('penalizes overrides and rework', () => {
    const good = makeSnapshot({
      successCount: 10,
      overrideCount: 0,
      reworkCount: 0,
      totalTasks: 10,
    });
    const bad = makeSnapshot({
      successCount: 5,
      overrideCount: 3,
      reworkCount: 2,
      totalTasks: 10,
    });
    expect(trustScore(good)).toBeGreaterThan(trustScore(bad));
  });

  it('clamps to [0, 1]', () => {
    const terrible = makeSnapshot({
      successCount: 0,
      overrideCount: 10,
      reworkCount: 10,
      totalTasks: 10,
    });
    expect(trustScore(terrible)).toBe(0);

    const perfect = makeSnapshot({
      successCount: 10,
      overrideCount: 0,
      reworkCount: 0,
      totalTasks: 10,
    });
    expect(trustScore(perfect)).toBeLessThanOrEqual(1);
  });
});

// ── trustTrend ───────────────────────────────────────────────────

describe('trustTrend', () => {
  it('returns stable with fewer than 2 snapshots', () => {
    expect(trustTrend([])).toBe('stable');
    expect(trustTrend([makeSnapshot()])).toBe('stable');
  });

  it('returns increasing when score is trending up', () => {
    const trajectory = [
      makeSnapshot({ tick: 1, score: 0.6 }),
      makeSnapshot({ tick: 2, score: 0.7 }),
      makeSnapshot({ tick: 3, score: 0.8 }),
    ];
    expect(trustTrend(trajectory)).toBe('increasing');
  });

  it('returns decreasing when score is trending down', () => {
    const trajectory = [
      makeSnapshot({ tick: 1, score: 0.8 }),
      makeSnapshot({ tick: 2, score: 0.7 }),
      makeSnapshot({ tick: 3, score: 0.6 }),
    ];
    expect(trustTrend(trajectory)).toBe('decreasing');
  });

  it('returns stable when score is flat', () => {
    const trajectory = [
      makeSnapshot({ tick: 1, score: 0.8 }),
      makeSnapshot({ tick: 2, score: 0.8 }),
      makeSnapshot({ tick: 3, score: 0.81 }),
    ];
    expect(trustTrend(trajectory)).toBe('stable');
  });

  it('only looks at the last 3 snapshots', () => {
    const trajectory = [
      makeSnapshot({ tick: 1, score: 0.3 }),
      makeSnapshot({ tick: 2, score: 0.4 }),
      makeSnapshot({ tick: 3, score: 0.8 }),
      makeSnapshot({ tick: 4, score: 0.81 }),
      makeSnapshot({ tick: 5, score: 0.82 }),
    ];
    // Last 3: 0.8, 0.81, 0.82 -> delta = 0.02 < 0.05 -> stable
    expect(trustTrend(trajectory)).toBe('stable');
  });
});

// ── averageTrustScore ────────────────────────────────────────────

describe('averageTrustScore', () => {
  it('returns 0.5 for empty profiles', () => {
    expect(averageTrustScore([])).toBe(0.5);
  });

  it('computes average correctly', () => {
    const profiles = [
      makeTrustProfile({ agentId: 'a1', currentScore: 0.6 }),
      makeTrustProfile({ agentId: 'a2', currentScore: 0.8 }),
    ];
    expect(averageTrustScore(profiles)).toBeCloseTo(0.7, 5);
  });

  it('handles single profile', () => {
    const profiles = [makeTrustProfile({ currentScore: 0.9 })];
    expect(averageTrustScore(profiles)).toBe(0.9);
  });
});

// ── reworkRisk ───────────────────────────────────────────────────

describe('reworkRisk', () => {
  it('returns 0 when no project is loaded', () => {
    expect(reworkRisk(initialState)).toBe(0);
  });

  it('returns 0 when everything is healthy', () => {
    const state = makeProjectState({
      coherenceIssues: [],
      trustProfiles: [makeTrustProfile({ currentScore: 0.9 })],
      decisionLog: [],
    });
    expect(reworkRisk(state)).toBeLessThanOrEqual(10);
  });

  it('increases with high-severity coherence issues', () => {
    const healthy = makeProjectState({ coherenceIssues: [] });
    const unhealthy = makeProjectState({
      coherenceIssues: [
        makeCoherenceIssue({ id: 'i1', severity: 'critical', status: 'detected' }),
        makeCoherenceIssue({ id: 'i2', severity: 'high', status: 'confirmed' }),
      ],
    });
    expect(reworkRisk(unhealthy)).toBeGreaterThan(reworkRisk(healthy));
  });

  it('increases with low trust scores', () => {
    const highTrust = makeProjectState({
      trustProfiles: [makeTrustProfile({ currentScore: 0.95 })],
    });
    const lowTrust = makeProjectState({
      trustProfiles: [makeTrustProfile({ currentScore: 0.1 })],
    });
    expect(reworkRisk(lowTrust)).toBeGreaterThan(reworkRisk(highTrust));
  });

  it('caps at 100', () => {
    const state = makeProjectState({
      coherenceIssues: Array.from({ length: 10 }, (_, i) =>
        makeCoherenceIssue({ id: `i-${i}`, severity: 'critical', status: 'detected' }),
      ),
      trustProfiles: [makeTrustProfile({ currentScore: 0 })],
      decisionLog: Array.from({ length: 10 }, (_, i) => ({
        id: `log-${i}`,
        tick: i,
        source: 'human' as const,
        agentId: null,
        title: `Decision ${i}`,
        summary: 'Overridden',
        actionKind: 'override' as const,
        rationale: 'test',
        reversible: true,
        reversed: true,
        flaggedForReview: false,
      })),
    });
    expect(reworkRisk(state)).toBeLessThanOrEqual(100);
  });
});

// ── highSeverityMissRate ─────────────────────────────────────────

describe('highSeverityMissRate', () => {
  it('returns 0 when no high-severity decisions exist', () => {
    const state = makeProjectState({
      decisions: [makeDecision({ severity: 'low', resolved: true, resolution: { chosenOptionId: 'o1', actionKind: 'approve', rationale: '', resolvedAtTick: 2, reversed: false } })],
    });
    expect(highSeverityMissRate(state)).toBe(0);
  });

  it('returns 0 when no decisions are resolved', () => {
    const state = makeProjectState({
      decisions: [makeDecision({ severity: 'critical', resolved: false })],
    });
    expect(highSeverityMissRate(state)).toBe(0);
  });

  it('calculates percentage of delegated high-severity decisions', () => {
    const state = makeProjectState({
      decisions: [
        makeDecision({ id: 'd1', severity: 'critical', resolved: true, resolution: { chosenOptionId: 'o1', actionKind: 'delegate', rationale: '', resolvedAtTick: 2, reversed: false } }),
        makeDecision({ id: 'd2', severity: 'high', resolved: true, resolution: { chosenOptionId: 'o1', actionKind: 'approve', rationale: '', resolvedAtTick: 3, reversed: false } }),
      ],
    });
    expect(highSeverityMissRate(state)).toBe(50);
  });

  it('returns 100 when all high-severity decisions were delegated', () => {
    const state = makeProjectState({
      decisions: [
        makeDecision({ id: 'd1', severity: 'critical', resolved: true, resolution: { chosenOptionId: 'o1', actionKind: 'delegate', rationale: '', resolvedAtTick: 2, reversed: false } }),
      ],
    });
    expect(highSeverityMissRate(state)).toBe(100);
  });
});

// ── humanInterventionRate ────────────────────────────────────────

describe('humanInterventionRate', () => {
  it('returns 0 when no decisions in log', () => {
    const state = makeProjectState({ decisionLog: [] });
    expect(humanInterventionRate(state)).toBe(0);
  });

  it('returns 100 when all decisions are human-made', () => {
    const state = makeProjectState({
      decisionLog: [
        { id: 'l1', tick: 1, source: 'human', agentId: null, title: 'D1', summary: '', actionKind: 'approve', rationale: '', reversible: true, reversed: false, flaggedForReview: false },
        { id: 'l2', tick: 2, source: 'human', agentId: null, title: 'D2', summary: '', actionKind: 'reject', rationale: '', reversible: true, reversed: false, flaggedForReview: false },
      ],
    });
    expect(humanInterventionRate(state)).toBe(100);
  });

  it('returns 50 when split between human and agent', () => {
    const state = makeProjectState({
      decisionLog: [
        { id: 'l1', tick: 1, source: 'human', agentId: null, title: 'D1', summary: '', actionKind: 'approve', rationale: '', reversible: true, reversed: false, flaggedForReview: false },
        { id: 'l2', tick: 2, source: 'agent', agentId: 'a1', title: 'D2', summary: '', actionKind: 'approve', rationale: '', reversible: true, reversed: false, flaggedForReview: false },
      ],
    });
    expect(humanInterventionRate(state)).toBe(50);
  });

  it('excludes system events from the calculation', () => {
    const state = makeProjectState({
      decisionLog: [
        { id: 'l1', tick: 1, source: 'human', agentId: null, title: 'D1', summary: '', actionKind: 'approve', rationale: '', reversible: true, reversed: false, flaggedForReview: false },
        { id: 'l2', tick: 2, source: 'system', agentId: null, title: 'D2', summary: '', actionKind: 'approve', rationale: '', reversible: true, reversed: false, flaggedForReview: false },
      ],
    });
    // Only 1 human, 0 agent -> 100% of non-system = human
    expect(humanInterventionRate(state)).toBe(100);
  });
});

// ── computeReviewPatterns ────────────────────────────────────────

describe('computeReviewPatterns', () => {
  it('returns empty array when no artifacts', () => {
    expect(computeReviewPatterns([], [])).toEqual([]);
  });

  it('groups artifacts by kind', () => {
    const artifacts = [
      makeArtifact({ id: 'a1', kind: 'code' }),
      makeArtifact({ id: 'a2', kind: 'code' }),
      makeArtifact({ id: 'a3', kind: 'document' }),
    ];
    const patterns = computeReviewPatterns(artifacts, []);
    expect(patterns.length).toBe(2);
    const kinds = patterns.map((p) => p.artifactKind);
    expect(kinds).toContain('code');
    expect(kinds).toContain('document');
  });

  it('computes review rate correctly', () => {
    const artifacts = [
      makeArtifact({ id: 'a1', kind: 'code', provenance: { sourceArtifactIds: [], producerAgentId: 'ag1', validatorAgentIds: [], humanReviewerId: 'human-1', relatedDecisionIds: [], producedAtTick: 1, lastModifiedAtTick: 1 } }),
      makeArtifact({ id: 'a2', kind: 'code', provenance: { sourceArtifactIds: [], producerAgentId: 'ag1', validatorAgentIds: [], humanReviewerId: null, relatedDecisionIds: [], producedAtTick: 1, lastModifiedAtTick: 1 } }),
    ];
    const patterns = computeReviewPatterns(artifacts, []);
    const codePattern = patterns.find((p) => p.artifactKind === 'code')!;
    expect(codePattern.reviewRate).toBe(50);
  });

  it('suggests reducing review rate when miss rate is low', () => {
    const artifacts = Array.from({ length: 10 }, (_, i) =>
      makeArtifact({
        id: `a${i}`,
        kind: 'document',
        status: 'approved',
        provenance: {
          sourceArtifactIds: [],
          producerAgentId: 'ag1',
          validatorAgentIds: [],
          humanReviewerId: 'human-1', // all reviewed
          relatedDecisionIds: [],
          producedAtTick: 1,
          lastModifiedAtTick: 1,
        },
      }),
    );
    const patterns = computeReviewPatterns(artifacts, []);
    const docPattern = patterns.find((p) => p.artifactKind === 'document')!;
    expect(docPattern.reviewRate).toBe(100);
    // missRate is 0 and reviewRate > 60, so should suggest reducing
    expect(docPattern.suggestedReviewRate).toBeLessThan(100);
  });
});

// ── computeMetrics ──────────────────────────────────────────────

describe('computeMetrics', () => {
  it('computes all metric fields from project state', () => {
    const state = makeProjectState({
      decisions: [
        makeDecision({ id: 'd1', resolved: false }),
        makeDecision({ id: 'd2', resolved: true, resolution: { chosenOptionId: 'o1', actionKind: 'approve', rationale: '', resolvedAtTick: 2, reversed: false } }),
      ],
      coherenceIssues: [
        makeCoherenceIssue({ id: 'i1', status: 'detected', severity: 'high' }),
      ],
      trustProfiles: [makeTrustProfile({ currentScore: 0.75 })],
      artifacts: [makeArtifact()],
    });

    const metrics = computeMetrics(state);

    expect(metrics.pendingDecisionCount).toBe(1);
    expect(metrics.openCoherenceIssueCount).toBe(1);
    expect(metrics.coherenceScore).toBe(80); // 100 - 20 (high severity)
    expect(metrics.averageTrustScore).toBe(0.75);
    expect(metrics.totalArtifactCount).toBe(1);
    expect(typeof metrics.reworkRisk).toBe('number');
    expect(typeof metrics.humanInterventionRate).toBe('number');
    expect(typeof metrics.highSeverityMissRate).toBe('number');
  });
});
