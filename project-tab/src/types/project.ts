/**
 * Core project types.
 *
 * A Project is the top-level container. It has phases, a control mode
 * (orchestrator vs. ecosystem), a risk profile, and metadata about the
 * human-agent team working on it.
 */

/** Severity levels used across decisions, coherence issues, and alerts. */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Project lifecycle phases. The control topology recommends different
 * positions on the orchestrator/ecosystem spectrum for each phase.
 *
 * - kickoff: Define scope carefully (lean orchestrator)
 * - exploration: Let agents discover (lean ecosystem)
 * - execution: Structured but parallel (middle)
 * - integration: Human coherence review (lean orchestrator)
 * - polish: Agent thoroughness, human taste (middle-ecosystem)
 * - complete: Archived / delivered
 */
export type ProjectPhase =
  | 'kickoff'
  | 'exploration'
  | 'execution'
  | 'integration'
  | 'polish'
  | 'complete';

/**
 * The two philosophies of control from the blog post, plus an adaptive
 * middle ground that shifts based on project signals.
 *
 * - orchestrator: Human retains directive control. Every output is reviewed.
 *   Maps to Mintzberg's Machine Bureaucracy.
 * - ecosystem: Human sets direction and boundaries; agents self-organize.
 *   Maps to Mintzberg's Adhocracy.
 * - adaptive: System recommends and shifts between modes based on observed
 *   project dynamics (rework rate, trust scores, risk level).
 */
export type ControlMode = 'orchestrator' | 'adaptive' | 'ecosystem';

/**
 * Risk profile for a project or domain. Determines default control
 * tightness and review gate density.
 *
 * From the control topology:
 * - critical: Review everything (patient safety, financial systems)
 * - high: Review architecture, trust implementation (production code)
 * - medium: Trust heavily, spot-check (internal docs)
 * - low: Let agents run (prototypes, experiments)
 */
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

/** Domain expertise relationship between human and agents. */
export type DomainExpertise =
  | 'human_expert'    // Human guides direction, trusts execution
  | 'shared'          // Collaborate, checkpoint
  | 'agent_expert';   // Set goals, evaluate results

/** Team maturity level — how established is the human-agent working relationship. */
export type TeamMaturity =
  | 'first_project'    // Build trust, learn patterns (lean orchestrator)
  | 'established'      // Proven agents, targeted review (middle)
  | 'high_trust';      // Exception-based management (lean ecosystem)

/** Risk profile combining multiple dimensions that affect control recommendations. */
export interface RiskProfile {
  /** Overall risk level for this project. */
  level: RiskLevel;
  /** Domain expertise relationship. */
  domainExpertise: DomainExpertise;
  /** How established is the human-agent team. */
  teamMaturity: TeamMaturity;
}

/**
 * An agent participating in the project. Agents can be specialists
 * (code, research, writing) or coordinators.
 */
export interface Agent {
  id: string;
  /** Display name, e.g. "Code Agent", "Research Agent". */
  name: string;
  /** What kind of work this agent does. */
  role: string;
  /** Current trust score (0-1). Computed from historical performance. */
  trustScore: number;
  /** Whether this agent is currently active on the project. */
  active: boolean;
}

/**
 * A workstream is a logical grouping of related work within a project.
 * Multiple agents may contribute to a workstream, and workstreams
 * can have dependencies on each other (Thompson's interdependence types).
 */
export interface Workstream {
  id: string;
  name: string;
  /** Brief description of what this workstream covers. */
  description: string;
  /** IDs of agents contributing to this workstream. */
  agentIds: string[];
  /** IDs of workstreams this one depends on. */
  dependsOn: string[];
  /** Current status. */
  status: 'active' | 'blocked' | 'complete' | 'paused';
}

/**
 * The top-level project container. Represents a single project that
 * a human PM is managing with agent assistance.
 *
 * Inspired by the five personas: Maya (solo creator), David (team lead),
 * Priya (product manager), Rosa (research director), Sam (consultant).
 */
export interface Project {
  id: string;
  /** Human-readable project name. */
  name: string;
  /** One-line description shown in portfolio views. */
  description: string;
  /** Which persona/scenario this project belongs to (for the prototype). */
  persona: string;
  /** Current lifecycle phase. */
  phase: ProjectPhase;
  /** Active control mode. */
  controlMode: ControlMode;
  /** Risk profile driving control recommendations. */
  riskProfile: RiskProfile;
  /** Agents participating in this project. */
  agents: Agent[];
  /** Logical workstreams within the project. */
  workstreams: Workstream[];
  /** Project goals — the "specification of intent". */
  goals: string[];
  /** Active constraints injected into agent context. */
  constraints: string[];
  /**
   * The current simulation tick. Each tick represents a unit of project
   * time progression in the prototype.
   */
  currentTick: number;
  /** Whether the emergency brake is engaged (all agents paused). */
  emergencyBrakeEngaged: boolean;
  /** ISO timestamp of project creation. */
  createdAt: string;
}
