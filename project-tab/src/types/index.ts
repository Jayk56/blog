/**
 * Barrel export for all project types.
 *
 * Import from '@/types' or '../types' to access any type
 * without knowing which specific file it lives in.
 */

// Project fundamentals
export type {
  Severity,
  ProjectPhase,
  ControlMode,
  RiskLevel,
  DomainExpertise,
  TeamMaturity,
  RiskProfile,
  Agent,
  Workstream,
  Project,
} from './project.js';

// Decision queue
export type {
  ActionKind,
  DecisionType,
  DecisionOption,
  BlastRadius,
  DecisionItem,
  DecisionResolution,
} from './decisions.js';

// Coherence tracking
export type {
  CoherenceCategory,
  CoherenceStatus,
  CoherenceIssue,
  CoherenceScore,
} from './coherence.js';

// Artifacts and provenance
export type {
  ArtifactKind,
  Provenance,
  Artifact,
} from './artifacts.js';

// Trust system
export type {
  TrustSnapshot,
  TrustProfile,
} from './trust.js';

// Timeline and decision log
export type {
  EventSource,
  EventCategory,
  TimelineEvent,
  DecisionLogEntry,
} from './timeline.js';

// Control system
export type {
  Checkpoint,
  ControlTopologyPoint,
  ModeShiftRecommendation,
  ModeShiftSignal,
  ThroughputQualityBias,
  ControlConfig,
  TopologyInput,
} from './control.js';

// Metrics and review patterns
export type {
  ReviewPattern,
  Metrics,
} from './metrics.js';

// Application state
export type {
  ProjectState,
  LoadScenarioAction,
  AdvanceTickAction,
  ResolveDecisionAction,
  ResolveCoherenceIssueAction,
  SetModeAction,
  SetBiasAction,
  EmergencyBrakeAction,
  InjectContextAction,
  ReverseDecisionAction,
  RetroactiveReviewAction,
  ToggleCheckpointAction,
  AcceptRecommendationAction,
  RejectRecommendationAction,
  ToggleAutoSimulateAction,
  SetViewingTickAction,
  UpdateDescriptionAction,
  UpdateGoalsAction,
  RemoveConstraintAction,
  EditConstraintAction,
  ServerStateSyncAction,
  ServerEventAction,
  ServerTrustUpdateAction,
  ServerDecisionResolvedAction,
  ServerBrakeAction,
  ProjectAction,
} from './state.js';
