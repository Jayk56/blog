import {
  getTopologyPoints,
  getRecommendedPosition,
  positionToMode,
  generateModeRecommendation,
} from './topology.js';
import type {
  TopologyInput,
  ProjectState,
} from '../types/index.js';
import { initialState } from './reducer.js';

// ── Test helpers ──────────────────────────────────────────────────

function makeInput(overrides: Partial<TopologyInput> = {}): TopologyInput {
  return {
    phase: 'execution',
    riskLevel: 'medium',
    domainExpertise: 'shared',
    teamMaturity: 'established',
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
      persona: 'david',
      phase: 'execution',
      controlMode: 'adaptive',
      riskProfile: {
        level: 'medium',
        domainExpertise: 'shared',
        teamMaturity: 'established',
      },
      agents: [],
      workstreams: [],
      goals: [],
      constraints: [],
      currentTick: 5,
      emergencyBrakeEngaged: false,
      createdAt: '2025-01-01T00:00:00Z',
    },
    ...overrides,
  };
}

// ── getTopologyPoints ─────────────────────────────────────────────

describe('getTopologyPoints', () => {
  it('returns four topology points', () => {
    const points = getTopologyPoints(makeInput());
    expect(points).toHaveLength(4);
  });

  it('covers all four dimensions', () => {
    const points = getTopologyPoints(makeInput());
    const dimensions = points.map((p) => p.dimension);
    expect(dimensions).toContain('phase');
    expect(dimensions).toContain('risk');
    expect(dimensions).toContain('domain_expertise');
    expect(dimensions).toContain('team_maturity');
  });

  it('sets currentPosition equal to recommendedPosition', () => {
    const points = getTopologyPoints(makeInput());
    for (const point of points) {
      expect(point.currentPosition).toBe(point.recommendedPosition);
    }
  });

  it('returns low positions for orchestrator-leaning inputs', () => {
    const points = getTopologyPoints(makeInput({
      phase: 'kickoff',
      riskLevel: 'critical',
      teamMaturity: 'first_project',
    }));
    const phasePoint = points.find((p) => p.dimension === 'phase')!;
    const riskPoint = points.find((p) => p.dimension === 'risk')!;
    const maturityPoint = points.find((p) => p.dimension === 'team_maturity')!;

    expect(phasePoint.currentPosition).toBeLessThanOrEqual(30);
    expect(riskPoint.currentPosition).toBeLessThanOrEqual(15);
    expect(maturityPoint.currentPosition).toBeLessThanOrEqual(25);
  });

  it('returns high positions for ecosystem-leaning inputs', () => {
    const points = getTopologyPoints(makeInput({
      phase: 'exploration',
      riskLevel: 'low',
      teamMaturity: 'high_trust',
      domainExpertise: 'agent_expert',
    }));
    const phasePoint = points.find((p) => p.dimension === 'phase')!;
    const riskPoint = points.find((p) => p.dimension === 'risk')!;
    const maturityPoint = points.find((p) => p.dimension === 'team_maturity')!;

    expect(phasePoint.currentPosition).toBeGreaterThanOrEqual(70);
    expect(riskPoint.currentPosition).toBeGreaterThanOrEqual(80);
    expect(maturityPoint.currentPosition).toBeGreaterThanOrEqual(80);
  });

  it('includes human-readable labels for each point', () => {
    const points = getTopologyPoints(makeInput());
    for (const point of points) {
      expect(point.label).toBeTruthy();
      expect(typeof point.label).toBe('string');
    }
  });
});

// ── getRecommendedPosition ────────────────────────────────────────

describe('getRecommendedPosition', () => {
  it('returns a number between 0 and 100', () => {
    const position = getRecommendedPosition(makeInput());
    expect(position).toBeGreaterThanOrEqual(0);
    expect(position).toBeLessThanOrEqual(100);
  });

  it('returns a low position for orchestrator-leaning inputs', () => {
    const position = getRecommendedPosition(makeInput({
      phase: 'kickoff',
      riskLevel: 'critical',
      domainExpertise: 'shared',
      teamMaturity: 'first_project',
    }));
    expect(position).toBeLessThanOrEqual(25);
  });

  it('returns a high position for ecosystem-leaning inputs', () => {
    const position = getRecommendedPosition(makeInput({
      phase: 'exploration',
      riskLevel: 'low',
      domainExpertise: 'agent_expert',
      teamMaturity: 'high_trust',
    }));
    expect(position).toBeGreaterThanOrEqual(75);
  });

  it('weighs risk most heavily', () => {
    // Same inputs except risk — should make a big difference
    const lowRisk = getRecommendedPosition(makeInput({ riskLevel: 'low' }));
    const critRisk = getRecommendedPosition(makeInput({ riskLevel: 'critical' }));
    expect(lowRisk - critRisk).toBeGreaterThanOrEqual(20);
  });

  it('returns a rounded integer', () => {
    const position = getRecommendedPosition(makeInput());
    expect(position).toBe(Math.round(position));
  });
});

// ── positionToMode ───────────────────────────────────────────────

describe('positionToMode', () => {
  it('maps 0-35 to orchestrator', () => {
    expect(positionToMode(0)).toBe('orchestrator');
    expect(positionToMode(20)).toBe('orchestrator');
    expect(positionToMode(35)).toBe('orchestrator');
  });

  it('maps 36-65 to adaptive', () => {
    expect(positionToMode(36)).toBe('adaptive');
    expect(positionToMode(50)).toBe('adaptive');
    expect(positionToMode(65)).toBe('adaptive');
  });

  it('maps 66-100 to ecosystem', () => {
    expect(positionToMode(66)).toBe('ecosystem');
    expect(positionToMode(80)).toBe('ecosystem');
    expect(positionToMode(100)).toBe('ecosystem');
  });
});

// ── generateModeRecommendation ───────────────────────────────────

describe('generateModeRecommendation', () => {
  it('returns null when no project is loaded', () => {
    expect(generateModeRecommendation(initialState)).toBeNull();
  });

  it('returns null when current mode matches recommended', () => {
    // execution + medium risk + shared + established -> adaptive (~52)
    const state = makeProjectState({
      project: {
        id: 'proj-1',
        name: 'Test',
        description: '',
        persona: 'david',
        phase: 'execution',
        controlMode: 'adaptive', // matches recommendation
        riskProfile: { level: 'medium', domainExpertise: 'shared', teamMaturity: 'established' },
        agents: [],
        workstreams: [],
        goals: [],
        constraints: [],
        currentTick: 5,
        emergencyBrakeEngaged: false,
        createdAt: '2025-01-01T00:00:00Z',
      },
    });
    expect(generateModeRecommendation(state)).toBeNull();
  });

  it('returns recommendation when current mode is wrong', () => {
    // Low risk + exploration + high trust + agent expert -> ecosystem (~80)
    // But we set controlMode to 'orchestrator' to trigger recommendation
    const state = makeProjectState({
      project: {
        id: 'proj-1',
        name: 'Test',
        description: '',
        persona: 'rosa',
        phase: 'exploration',
        controlMode: 'orchestrator', // mismatch
        riskProfile: { level: 'low', domainExpertise: 'agent_expert', teamMaturity: 'high_trust' },
        agents: [],
        workstreams: [],
        goals: [],
        constraints: [],
        currentTick: 5,
        emergencyBrakeEngaged: false,
        createdAt: '2025-01-01T00:00:00Z',
      },
    });
    const rec = generateModeRecommendation(state);
    expect(rec).not.toBeNull();
    expect(rec!.recommendedMode).toBe('ecosystem');
    expect(rec!.currentMode).toBe('orchestrator');
    expect(rec!.rationale).toBeTruthy();
    expect(rec!.signals.length).toBeGreaterThan(0);
    expect(rec!.status).toBe('pending');
  });

  it('includes signals with source and observation', () => {
    const state = makeProjectState({
      project: {
        id: 'proj-1',
        name: 'Test',
        description: '',
        persona: 'david',
        phase: 'kickoff',
        controlMode: 'ecosystem', // mismatch with kickoff
        riskProfile: { level: 'critical', domainExpertise: 'shared', teamMaturity: 'first_project' },
        agents: [],
        workstreams: [],
        goals: [],
        constraints: [],
        currentTick: 1,
        emergencyBrakeEngaged: false,
        createdAt: '2025-01-01T00:00:00Z',
      },
    });
    const rec = generateModeRecommendation(state);
    expect(rec).not.toBeNull();
    expect(rec!.recommendedMode).toBe('orchestrator');

    for (const signal of rec!.signals) {
      expect(signal.source).toBeTruthy();
      expect(signal.observation).toBeTruthy();
      expect(typeof signal.weight).toBe('number');
    }
  });
});
