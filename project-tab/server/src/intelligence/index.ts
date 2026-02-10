export { TrustEngine } from './trust-engine'
export type { TrustOutcome, TrustCalibrationConfig, CalibrationLogEntry } from './trust-engine'

export { DecisionQueue } from './decision-queue'
export type { DecisionTimeoutPolicy, DecisionStatus, QueuedDecision } from './decision-queue'

export { KnowledgeStore } from './knowledge-store'

export { CoherenceMonitor, isEmbeddable } from './coherence-monitor'
export type { CoherenceMonitorConfig } from './coherence-monitor'

export { cosineSimilarity, MockEmbeddingService, createVectorsWithSimilarity } from './embedding-service'
export type { EmbeddingService } from './embedding-service'

export { ReviewRateLimiter, MockCoherenceReviewService, buildReviewPrompt } from './coherence-review-service'
export type {
  CoherenceCandidate,
  CoherenceReviewRequest,
  CoherenceReviewResult,
  CoherenceReviewService
} from './coherence-review-service'
