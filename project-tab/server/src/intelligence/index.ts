export { TrustEngine } from './trust-engine'
export type {
  TrustOutcome,
  TrustCalibrationConfig,
  CalibrationLogEntry,
  TrustOutcomeContext,
  DomainOutcomeRecord
} from './trust-engine'

export { DecisionQueue } from './decision-queue'
export type { DecisionTimeoutPolicy, DecisionStatus, QueuedDecision } from './decision-queue'

export { KnowledgeStore } from './knowledge-store'

export { CoherenceMonitor } from './coherence-monitor'
export type {
  CoherenceMonitorConfig,
  CoherenceFeedbackLoopConfig,
  ThresholdAdjustmentRecord,
  FeedbackLoopStatus,
} from './coherence-monitor'

export type { EmbeddingService } from './embedding-service'
export { VoyageEmbeddingService } from './voyage-embedding-service'

export type {
  CoherenceCandidate,
  CoherenceReviewRequest,
  CoherenceReviewResult,
  CoherenceReviewService,
  LlmSweepArtifact,
  LlmSweepIssue,
  LlmSweepRequest,
  LlmSweepService
} from './coherence-review-service'

export { LlmReviewService } from './llm-review-service'
export type { LlmReviewConfig } from './llm-review-service'

export { InjectionOptimizer } from './injection-optimizer'
export type { InjectionEfficiencyReport, ReasonBreakdown, ModeRecommendation } from './injection-optimizer'

export { ContextInjectionService } from './context-injection-service'
export type { InjectionRecord, SelfTuningConfig } from './context-injection-service'

export { ConstraintInferenceService } from './constraint-inference-service'
export type { ConstraintSuggestion, SuggestionConfidence, SuggestionSource, ConstraintInferenceStore } from './constraint-inference-service'

export { RetrospectiveService } from './retrospective-service'
export type {
  PhaseRetrospective,
  PhaseMetrics,
  MetricsComparison,
  PhaseInsight,
  RetrospectiveStore,
} from './retrospective-service'

export { ReworkCausalLinker } from './rework-causal-linker'
export type {
  ReworkCausalReport,
  ReworkCausalLink,
  ReworkAggregate,
  ReworkCause,
  ReworkAnalysisStore,
} from './rework-causal-linker'

export { ControlModeROIService } from './control-mode-roi-service'
export type {
  ModeInterval,
  PerModeMetrics,
  ModeComparison,
  ModeRecommendation as ROIModeRecommendation,
  ControlModeROIReport,
} from './control-mode-roi-service'
