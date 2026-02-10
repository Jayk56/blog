/**
 * Control topology engine.
 *
 * Maps project characteristics (phase, risk, domain expertise, team maturity)
 * to recommended positions on the orchestrator/ecosystem spectrum.
 *
 * Value scale: 0 = full orchestrator, 100 = full ecosystem.
 *
 * From the blog post: "Not a static PM tool, not a static control model,
 * but an adaptive control system that shifts management style based on
 * observed project dynamics."
 */

import type {
  ProjectPhase,
  RiskLevel,
  DomainExpertise,
  TeamMaturity,
  ControlTopologyPoint,
  ModeShiftRecommendation,
  ModeShiftSignal,
  ControlMode,
  TopologyInput,
  ProjectState,
} from '../types/index.js';

// ── Phase → Spectrum Position ─────────────────────────────────────

/**
 * Each phase has a natural position on the control spectrum.
 * Based on the blog post analysis:
 * - Kickoff: Define scope carefully → lean orchestrator
 * - Exploration: Let agents discover → lean ecosystem
 * - Execution: Structured but parallel → middle
 * - Integration: Human coherence review → lean orchestrator
 * - Polish: Agent thoroughness, human taste → middle-ecosystem
 * - Complete: Archived → neutral
 */
const PHASE_POSITION: Record<ProjectPhase, number> = {
  kickoff: 25,
  exploration: 75,
  execution: 50,
  integration: 20,
  polish: 65,
  complete: 50,
};

const PHASE_LABEL: Record<ProjectPhase, string> = {
  kickoff: 'Kickoff — define scope carefully',
  exploration: 'Exploration — let agents discover',
  execution: 'Execution — structured parallelism',
  integration: 'Integration — human coherence review',
  polish: 'Polish — agent thoroughness, human taste',
  complete: 'Complete — archived',
};

// ── Risk → Spectrum Position ──────────────────────────────────────

/**
 * Higher risk → lean orchestrator. Lower risk → lean ecosystem.
 */
const RISK_POSITION: Record<RiskLevel, number> = {
  critical: 10,
  high: 30,
  medium: 60,
  low: 85,
};

const RISK_LABEL: Record<RiskLevel, string> = {
  critical: 'Critical risk — review everything',
  high: 'High risk — review architecture, trust implementation',
  medium: 'Medium risk — trust heavily, spot-check',
  low: 'Low risk — let agents run',
};

// ── Domain Expertise → Spectrum Position ──────────────────────────

/**
 * When the human is the domain expert, they guide direction but can
 * trust agent execution → middle-ecosystem. When agents are the experts,
 * humans set goals and evaluate results → middle-ecosystem too but
 * from a different angle. Shared expertise → collaborate, checkpoint.
 */
const EXPERTISE_POSITION: Record<DomainExpertise, number> = {
  human_expert: 60,
  shared: 45,
  agent_expert: 70,
};

const EXPERTISE_LABEL: Record<DomainExpertise, string> = {
  human_expert: 'Human expert — guide direction, trust execution',
  shared: 'Shared expertise — collaborate, checkpoint',
  agent_expert: 'Agent expert — set goals, evaluate results',
};

// ── Team Maturity → Spectrum Position ─────────────────────────────

/**
 * First project → build trust → orchestrator.
 * Established → proven agents → middle.
 * High trust → exception-based → ecosystem.
 */
const MATURITY_POSITION: Record<TeamMaturity, number> = {
  first_project: 20,
  established: 55,
  high_trust: 85,
};

const MATURITY_LABEL: Record<TeamMaturity, string> = {
  first_project: 'First project — build trust, learn patterns',
  established: 'Established — proven agents, targeted review',
  high_trust: 'High trust — exception-based management',
};

// ── Topology Computation ──────────────────────────────────────────

/**
 * Get the four topology points for the current project state.
 * Each point shows the current and recommended positions on the
 * orchestrator/ecosystem spectrum for that dimension.
 */
export function getTopologyPoints(input: TopologyInput): ControlTopologyPoint[] {
  return [
    {
      dimension: 'phase',
      label: PHASE_LABEL[input.phase],
      currentPosition: PHASE_POSITION[input.phase],
      recommendedPosition: PHASE_POSITION[input.phase],
    },
    {
      dimension: 'risk',
      label: RISK_LABEL[input.riskLevel],
      currentPosition: RISK_POSITION[input.riskLevel],
      recommendedPosition: RISK_POSITION[input.riskLevel],
    },
    {
      dimension: 'domain_expertise',
      label: EXPERTISE_LABEL[input.domainExpertise],
      currentPosition: EXPERTISE_POSITION[input.domainExpertise],
      recommendedPosition: EXPERTISE_POSITION[input.domainExpertise],
    },
    {
      dimension: 'team_maturity',
      label: MATURITY_LABEL[input.teamMaturity],
      currentPosition: MATURITY_POSITION[input.teamMaturity],
      recommendedPosition: MATURITY_POSITION[input.teamMaturity],
    },
  ];
}

/**
 * Compute the overall recommended position on the spectrum (0-100).
 * Weighted average of all four dimensions.
 *
 * Risk is weighted most heavily (35%) because safety is non-negotiable.
 * Phase (25%), Team Maturity (25%), and Domain Expertise (15%) follow.
 */
export function getRecommendedPosition(input: TopologyInput): number {
  const riskWeight = 0.35;
  const phaseWeight = 0.25;
  const maturityWeight = 0.25;
  const expertiseWeight = 0.15;

  return Math.round(
    RISK_POSITION[input.riskLevel] * riskWeight +
      PHASE_POSITION[input.phase] * phaseWeight +
      MATURITY_POSITION[input.teamMaturity] * maturityWeight +
      EXPERTISE_POSITION[input.domainExpertise] * expertiseWeight,
  );
}

/**
 * Map a spectrum position (0-100) to a recommended control mode.
 * - 0-35: orchestrator
 * - 36-65: adaptive
 * - 66-100: ecosystem
 */
export function positionToMode(position: number): ControlMode {
  if (position <= 35) return 'orchestrator';
  if (position <= 65) return 'adaptive';
  return 'ecosystem';
}

/**
 * Generate a mode shift recommendation if the current mode doesn't
 * match what the topology engine suggests. Returns null if the
 * current mode is appropriate.
 */
export function generateModeRecommendation(
  state: ProjectState,
): ModeShiftRecommendation | null {
  if (!state.project) return null;

  const input: TopologyInput = {
    phase: state.project.phase,
    riskLevel: state.project.riskProfile.level,
    domainExpertise: state.project.riskProfile.domainExpertise,
    teamMaturity: state.project.riskProfile.teamMaturity,
  };

  const position = getRecommendedPosition(input);
  const recommendedMode = positionToMode(position);
  const currentMode = state.project.controlMode;

  // No recommendation needed if modes match
  if (recommendedMode === currentMode) return null;

  const signals: ModeShiftSignal[] = [];
  const points = getTopologyPoints(input);

  for (const point of points) {
    const currentModePosition =
      currentMode === 'orchestrator' ? 20 : currentMode === 'ecosystem' ? 80 : 50;
    const delta = Math.abs(point.recommendedPosition - currentModePosition);

    if (delta > 20) {
      signals.push({
        source: point.dimension,
        observation: `${point.label} suggests position ${point.recommendedPosition} (current mode implies ~${currentModePosition})`,
        weight: delta / 100,
      });
    }
  }

  // Build rationale from signals
  const modeLabels: Record<ControlMode, string> = {
    orchestrator: 'Orchestrator (tighter human control)',
    adaptive: 'Adaptive (context-sensitive)',
    ecosystem: 'Ecosystem (more agent autonomy)',
  };

  const rationale =
    `Based on the current project state, ${modeLabels[recommendedMode]} ` +
    `would be more appropriate than ${modeLabels[currentMode]}. ` +
    `The recommended spectrum position is ${position}/100.`;

  return {
    id: `rec-${Date.now()}`,
    recommendedMode,
    currentMode,
    rationale,
    signals,
    status: 'pending',
    createdAtTick: state.project.currentTick,
  };
}
