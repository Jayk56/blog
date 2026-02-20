import type { ArtifactEvent, ArtifactKind, CoherenceEvent, Severity } from '../types/events'
import type { EmbeddingService } from './embedding-service'
import { cosineSimilarity } from './embedding-service'
import type {
  CoherenceCandidate,
  CoherenceReviewService,
  CoherenceReviewResult,
  LlmSweepArtifact,
  LlmSweepService,
} from './coherence-review-service'
import { ReviewRateLimiter } from './coherence-review-service'
import type { TickService } from '../tick'

/** Configuration for the full coherence monitor (Layers 0, 1, 2). */
export interface CoherenceMonitorConfig {
  /** How often Layer 1 scans run, in ticks (default: 10). */
  layer1ScanIntervalTicks: number

  /** Cosine similarity threshold for promoting to Layer 2 (default: 0.75). */
  layer1PromotionThreshold: number

  /** Similarity threshold for auto-emitting advisory issues (default: 0.65). */
  layer1AdvisoryThreshold: number

  /** Max artifacts to scan per cycle (default: 500). */
  layer1MaxArtifactsPerScan: number

  /** Embedding model name (informational, used by real EmbeddingService). */
  embeddingModel: string

  /** Max Layer 2 reviews per hour (default: 30). */
  layer2MaxReviewsPerHour: number

  /** Layer 2 model name (informational). */
  layer2Model: string

  /** Whether Layer 2 is enabled (default: false — requires real LLM). */
  enableLayer2: boolean

  /** Whether Layer 1c (periodic full-corpus LLM sweep) is enabled. */
  enableLayer1c: boolean

  /** Minimum ticks between Layer 1c sweeps. */
  layer1cScanIntervalTicks: number

  /** Maximum estimated corpus tokens allowed for Layer 1c. */
  layer1cMaxCorpusTokens: number

  /** Model name for Layer 1c sweeps. */
  layer1cModel: string

  /** Skip Layer 2 for embedding candidates — auto-emit them as confirmed (default: false). */
  skipLayer2ForEmbeddings: boolean
}

/** Configuration for the Layer 1→Layer 2 false-positive auto-tuning feedback loop. */
export interface CoherenceFeedbackLoopConfig {
  /** Whether the feedback loop is enabled (default: false). */
  enabled: boolean
  /** Minimum Layer 2 reviews in the 24h window before threshold adjustment triggers. */
  minReviewsBeforeAdjust: number
  /** FP rate above which the Layer 1 promotion threshold is raised. */
  fpThresholdHigh: number
  /** FP rate below which the Layer 1 promotion threshold is lowered. */
  fpThresholdLow: number
  /** Amount to increase the promotion threshold per adjustment. */
  increaseStep: number
  /** Amount to decrease the promotion threshold per adjustment. */
  decreaseStep: number
  /** Minimum allowed value for layer1PromotionThreshold. */
  minPromotionThreshold: number
  /** Maximum allowed value for layer1PromotionThreshold. */
  maxPromotionThreshold: number
}

const DEFAULT_FEEDBACK_LOOP_CONFIG: CoherenceFeedbackLoopConfig = {
  enabled: false,
  minReviewsBeforeAdjust: 20,
  fpThresholdHigh: 0.50,
  fpThresholdLow: 0.10,
  increaseStep: 0.02,
  decreaseStep: 0.01,
  minPromotionThreshold: 0.75,
  maxPromotionThreshold: 0.95,
}

/** A single threshold adjustment record. */
export interface ThresholdAdjustmentRecord {
  timestamp: string
  oldThreshold: number
  newThreshold: number
  fpRate: number
  reviewCount: number
}

/** Status snapshot of the feedback loop. */
export interface FeedbackLoopStatus {
  enabled: boolean
  fpRate: number | null
  reviewCount: number
  currentThreshold: number
  lastAdjustment: ThresholdAdjustmentRecord | null
  windowStart: string
}

/** Default configuration. */
const DEFAULT_CONFIG: CoherenceMonitorConfig = {
  layer1ScanIntervalTicks: 10,
  layer1PromotionThreshold: 0.75,
  layer1AdvisoryThreshold: 0.65,
  layer1MaxArtifactsPerScan: 500,
  embeddingModel: 'text-embedding-3-small',
  layer2MaxReviewsPerHour: 30,
  layer2Model: 'claude-sonnet-4-6',
  enableLayer2: false,
  enableLayer1c: false,
  layer1cScanIntervalTicks: 300,
  layer1cMaxCorpusTokens: 200_000,
  layer1cModel: 'claude-sonnet-4-6',
  skipLayer2ForEmbeddings: false,
}

/** Stored embedding for an artifact. */
interface ArtifactEmbedding {
  artifactId: string
  workstream: string
  embedding: number[]
  lastUpdatedTick: number
}

interface ContentHashEntry {
  artifactId: string
  workstream: string
  agentId: string
}

/** Check whether an artifact kind + mimeType is eligible for embedding. */
function isEmbeddable(kind: ArtifactKind, mimeType?: string): boolean {
  if (kind === 'design') return false
  if (kind === 'code' || kind === 'config' || kind === 'test') {
    return !mimeType || mimeType.startsWith('text/')
  }
  if (kind === 'document') {
    return !mimeType || mimeType.startsWith('text/') || mimeType === 'application/json'
  }
  // 'other' — skip unless explicitly text
  return mimeType?.startsWith('text/') ?? false
}

/**
 * Coherence Monitor with three detection layers.
 *
 * - **Layer 0**: Structural checks (file conflicts) — instant, deterministic, always-on.
 * - **Layer 1**: Embedding similarity — periodic scan on tick interval.
 * - **Layer 2**: LLM deep review — on-demand for promoted candidates.
 */
export class CoherenceMonitor {
  // --- Layer 0 state ---
  /** Maps sourcePath -> { agentId, artifactId } of the last writer. */
  private readonly pathOwnership = new Map<string, { agentId: string; artifactId: string }>()

  /** Accumulated coherence events detected by the monitor. */
  private readonly detectedIssues: CoherenceEvent[] = []

  private issueCounter = 0

  // --- Layer 1 state ---
  private readonly config: CoherenceMonitorConfig
  private embeddingService: EmbeddingService | null = null
  private readonly embeddings = new Map<string, ArtifactEmbedding>()
  private readonly contentHashIndex = new Map<string, ContentHashEntry[]>()
  private readonly artifactHashById = new Map<string, string>()
  private readonly changedArtifactIds = new Set<string>()
  private lastScanTick = 0
  private readonly candidates: CoherenceCandidate[] = []
  private candidateCounter = 0

  // --- Layer 2 state ---
  private reviewService: CoherenceReviewService | null = null
  private sweepService: LlmSweepService | null = null
  private rateLimiter: ReviewRateLimiter
  private readonly reviewResults: CoherenceReviewResult[] = []
  private readonly dismissedCandidateIds = new Set<string>()

  // --- Layer 1c state ---
  private lastLayer1cSweepTick = 0
  private layer1cDirty = false

  // --- Tick subscription ---
  private tickHandler: ((tick: number) => void) | null = null

  // --- Artifact content provider (for Layer 2 context assembly) ---
  private artifactContentProvider: ((artifactId: string) => string | undefined) | null = null
  private corpusArtifacts: { artifactId: string; workstream: string; content: string }[] | null = null

  // --- Feedback loop state ---
  private readonly feedbackLoopConfig: CoherenceFeedbackLoopConfig
  private feedbackWindow = { confirmed: 0, dismissed: 0, windowStart: new Date() }
  private readonly thresholdHistory: ThresholdAdjustmentRecord[] = []
  private auditLogger: ((entityType: string, entityId: string, action: string, callerAgentId?: string, details?: unknown) => void) | null = null

  constructor(config: Partial<CoherenceMonitorConfig> = {}, feedbackLoopConfig: Partial<CoherenceFeedbackLoopConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.feedbackLoopConfig = { ...DEFAULT_FEEDBACK_LOOP_CONFIG, ...feedbackLoopConfig }
    this.rateLimiter = new ReviewRateLimiter(this.config.layer2MaxReviewsPerHour)
  }

  /** Returns the active configuration. */
  getConfig(): Readonly<CoherenceMonitorConfig> {
    return { ...this.config }
  }

  // ─── Service wiring ──────────────────────────────────────────────

  /** Attach an embedding service for Layer 1 scanning. */
  setEmbeddingService(service: EmbeddingService): void {
    this.embeddingService = service
  }

  /** Attach a review service for Layer 2 deep review. */
  setReviewService(service: CoherenceReviewService): void {
    this.reviewService = service
  }

  /** Attach an LLM sweep service for Layer 1c periodic corpus reviews. */
  setSweepService(service: LlmSweepService): void {
    this.sweepService = service
  }

  /** Set a function that retrieves artifact content by ID (for Layer 2 context). */
  setArtifactContentProvider(provider: (artifactId: string) => string | undefined): void {
    this.artifactContentProvider = provider
  }

  /** Set full corpus artifacts for batch Layer 2 review context. */
  setCorpusArtifacts(artifacts: { artifactId: string; workstream: string; content: string }[]): void {
    this.corpusArtifacts = artifacts
  }

  /** Subscribe to TickService for periodic Layer 1 scans. */
  subscribeTo(tickService: TickService): void {
    this.tickHandler = (tick: number) => this.onTick(tick)
    tickService.onTick(this.tickHandler)
  }

  /** Unsubscribe from TickService. */
  unsubscribeFrom(tickService: TickService): void {
    if (this.tickHandler) {
      tickService.removeOnTick(this.tickHandler)
      this.tickHandler = null
    }
  }

  /** Attach an audit logger for persisting threshold change history. */
  setAuditLogger(logger: (entityType: string, entityId: string, action: string, callerAgentId?: string, details?: unknown) => void): void {
    this.auditLogger = logger
  }

  // ─── Feedback loop: Layer 1→Layer 2 FP auto-tuning ─────────────

  /** Returns the current feedback loop status. */
  getFeedbackLoopStatus(): FeedbackLoopStatus {
    const { confirmed, dismissed, windowStart } = this.feedbackWindow
    const total = confirmed + dismissed
    return {
      enabled: this.feedbackLoopConfig.enabled,
      fpRate: total > 0 ? dismissed / total : null,
      reviewCount: total,
      currentThreshold: this.config.layer1PromotionThreshold,
      lastAdjustment: this.thresholdHistory.length > 0
        ? this.thresholdHistory[this.thresholdHistory.length - 1]
        : null,
      windowStart: windowStart.toISOString(),
    }
  }

  /** Returns the full threshold adjustment history. */
  getThresholdHistory(): readonly ThresholdAdjustmentRecord[] {
    return this.thresholdHistory
  }

  /** Returns the feedback loop configuration. */
  getFeedbackLoopConfig(): Readonly<CoherenceFeedbackLoopConfig> {
    return { ...this.feedbackLoopConfig }
  }

  /**
   * Update the feedback window with Layer 2 review results and
   * potentially adjust the Layer 1 promotion threshold.
   *
   * Called internally after each Layer 2 review batch.
   */
  private updateFeedbackLoop(results: import('./coherence-review-service').CoherenceReviewResult[], now: Date = new Date()): void {
    if (!this.feedbackLoopConfig.enabled) return

    // Roll window if 24 hours have elapsed
    const msIn24h = 24 * 60 * 60 * 1000
    if (now.getTime() - this.feedbackWindow.windowStart.getTime() >= msIn24h) {
      this.feedbackWindow = { confirmed: 0, dismissed: 0, windowStart: now }
    }

    // Tally results
    for (const result of results) {
      if (result.confirmed) {
        this.feedbackWindow.confirmed++
      } else {
        this.feedbackWindow.dismissed++
      }
    }

    // Check if we have enough reviews to adjust
    const total = this.feedbackWindow.confirmed + this.feedbackWindow.dismissed
    if (total < this.feedbackLoopConfig.minReviewsBeforeAdjust) return

    const fpRate = this.feedbackWindow.dismissed / total
    const oldThreshold = this.config.layer1PromotionThreshold

    if (fpRate > this.feedbackLoopConfig.fpThresholdHigh) {
      // Too many false positives — raise the bar
      this.config.layer1PromotionThreshold = Math.min(
        this.config.layer1PromotionThreshold + this.feedbackLoopConfig.increaseStep,
        this.feedbackLoopConfig.maxPromotionThreshold
      )
    } else if (fpRate < this.feedbackLoopConfig.fpThresholdLow) {
      // Very few false positives — lower the bar
      this.config.layer1PromotionThreshold = Math.max(
        this.config.layer1PromotionThreshold - this.feedbackLoopConfig.decreaseStep,
        this.feedbackLoopConfig.minPromotionThreshold
      )
    } else {
      // In the dead zone — no adjustment
      return
    }

    // Only record if the threshold actually changed
    if (this.config.layer1PromotionThreshold === oldThreshold) return

    const record: ThresholdAdjustmentRecord = {
      timestamp: now.toISOString(),
      oldThreshold,
      newThreshold: this.config.layer1PromotionThreshold,
      fpRate,
      reviewCount: total,
    }
    this.thresholdHistory.push(record)

    if (this.auditLogger) {
      this.auditLogger('coherence_feedback_loop', 'layer1_threshold', 'threshold_adjusted', undefined, record)
    }
  }

  // ─── Layer 0: Structural checks ──────────────────────────────────

  /**
   * Process an artifact event. If the artifact has a sourcePath that is
   * already claimed by a different agent, emit a CoherenceEvent.
   *
   * Also marks the artifact as changed for the next Layer 1 scan.
   *
   * Returns the CoherenceEvent if a conflict was detected, undefined otherwise.
   */
  processArtifact(event: ArtifactEvent): CoherenceEvent | undefined {
    // Track change for Layer 1
    this.changedArtifactIds.add(event.artifactId)
    this.layer1cDirty = true
    this.updateContentHashIndex(event)

    const sourcePath = event.provenance.sourcePath
    if (!sourcePath) return undefined

    const existing = this.pathOwnership.get(sourcePath)

    if (existing && existing.agentId !== event.agentId) {
      const issue = this.createConflictEvent(event, existing, sourcePath)
      this.detectedIssues.push(issue)

      // Update ownership to the latest writer
      this.pathOwnership.set(sourcePath, {
        agentId: event.agentId,
        artifactId: event.artifactId
      })

      return issue
    }

    // Register or update ownership
    this.pathOwnership.set(sourcePath, {
      agentId: event.agentId,
      artifactId: event.artifactId
    })

    return undefined
  }

  /** Returns all detected coherence issues. */
  getDetectedIssues(): readonly CoherenceEvent[] {
    return this.detectedIssues
  }

  /** Clears all tracked path ownership and detected issues. */
  reset(): void {
    this.pathOwnership.clear()
    this.detectedIssues.length = 0
    this.issueCounter = 0
    this.embeddings.clear()
    this.contentHashIndex.clear()
    this.artifactHashById.clear()
    this.changedArtifactIds.clear()
    this.lastScanTick = 0
    this.candidates.length = 0
    this.candidateCounter = 0
    this.reviewResults.length = 0
    this.dismissedCandidateIds.clear()
    this.lastLayer1cSweepTick = 0
    this.layer1cDirty = false
    this.feedbackWindow = { confirmed: 0, dismissed: 0, windowStart: new Date() }
    this.thresholdHistory.length = 0
  }

  /** Returns the current path ownership map for debugging. */
  getPathOwnership(): ReadonlyMap<string, { agentId: string; artifactId: string }> {
    return this.pathOwnership
  }

  // ─── Layer 1: Embedding similarity ───────────────────────────────

  /**
   * Run a Layer 1 scan: compute embeddings for changed artifacts and find
   * cross-workstream pairs above the similarity threshold.
   *
   * Called automatically on tick intervals, but can also be called manually.
   *
   * @param currentTick The current logical tick
   * @param artifactProvider Function to retrieve an ArtifactEvent by ID
   * @param contentProvider Function to retrieve artifact text content by ID
   * @returns Array of new CoherenceCandidate entries found in this scan
   */
  async runLayer1Scan(
    currentTick: number,
    artifactProvider: (artifactId: string) => ArtifactEvent | undefined,
    contentProvider: (artifactId: string) => string | undefined
  ): Promise<CoherenceCandidate[]> {
    const changedIds = Array.from(this.changedArtifactIds)
    if (changedIds.length === 0) return []

    this.changedArtifactIds.clear()
    this.lastScanTick = currentTick

    const newCandidates: CoherenceCandidate[] = []

    // Filter to embeddable artifacts, respect max scan limit
    const toEmbed: { artifactId: string; content: string; event: ArtifactEvent }[] = []

    if (this.embeddingService) {
      for (const id of changedIds) {
        if (toEmbed.length >= this.config.layer1MaxArtifactsPerScan) break

        const event = artifactProvider(id)
        if (!event) continue
        if (!isEmbeddable(event.kind, event.mimeType)) continue

        const content = contentProvider(id)
        if (!content) continue

        toEmbed.push({ artifactId: id, content, event })
      }
    }

    if (this.embeddingService && toEmbed.length > 0) {
      // Compute embeddings in batch
      const texts = toEmbed.map((a) => a.content)
      const vectors = await this.embeddingService.embedBatch(texts)

      // Store embeddings
      for (let i = 0; i < toEmbed.length; i++) {
        this.embeddings.set(toEmbed[i].artifactId, {
          artifactId: toEmbed[i].artifactId,
          workstream: toEmbed[i].event.workstream,
          embedding: vectors[i],
          lastUpdatedTick: currentTick
        })
      }

      // Cross-workstream comparison: compare changed artifacts against all other workstreams
      const allEmbeddings = Array.from(this.embeddings.values())

      for (const changed of toEmbed) {
        const changedEmb = this.embeddings.get(changed.artifactId)
        if (!changedEmb) continue

        for (const other of allEmbeddings) {
          // Skip same artifact
          if (other.artifactId === changed.artifactId) continue
          // Skip same workstream
          if (other.workstream === changedEmb.workstream) continue

          const similarity = cosineSimilarity(changedEmb.embedding, other.embedding)

          if (similarity >= this.config.layer1AdvisoryThreshold) {
            const existing = this.findCandidateByPair(changedEmb.artifactId, other.artifactId)
            if (existing) {
              // Update similarity score
              existing.similarityScore = similarity
              existing.promotedToLayer2 = similarity >= this.config.layer1PromotionThreshold
              continue
            }

            const promoted = similarity >= this.config.layer1PromotionThreshold

            this.candidateCounter++
            const candidate: CoherenceCandidate = {
              candidateId: `candidate-${this.candidateCounter}`,
              artifactIdA: changedEmb.artifactId,
              artifactIdB: other.artifactId,
              workstreamA: changedEmb.workstream,
              workstreamB: other.workstream,
              similarityScore: similarity,
              candidateCategory: 'duplication',
              detectedAt: new Date().toISOString(),
              promotedToLayer2: promoted
            }

            this.candidates.push(candidate)
            newCandidates.push(candidate)

            // Auto-emit advisory for medium-similarity candidates
            if (!promoted && similarity > this.config.layer1AdvisoryThreshold) {
              this.issueCounter++
              const advisory: CoherenceEvent = {
                type: 'coherence',
                agentId: 'system',
                issueId: `coherence-${this.issueCounter}`,
                title: `Potential overlap: ${changedEmb.artifactId} / ${other.artifactId}`,
                description: `Cross-workstream similarity score ${similarity.toFixed(3)} detected between artifacts in ${changedEmb.workstream} and ${other.workstream}. Below promotion threshold — advisory only.`,
                category: 'duplication',
                severity: 'low',
                affectedWorkstreams: [changedEmb.workstream, other.workstream],
                affectedArtifactIds: [changedEmb.artifactId, other.artifactId]
              }
              this.detectedIssues.push(advisory)
            }
          }
        }
      }
    }

    const hashCandidates = this.runContentHashComparison(changedIds, artifactProvider)
    newCandidates.push(...hashCandidates)

    return newCandidates
  }

  /** Returns all current coherence candidates (from Layer 1). */
  getCandidates(): readonly CoherenceCandidate[] {
    return this.candidates
  }

  /** Returns candidates promoted to Layer 2 that haven't been reviewed yet. */
  getPendingLayer2Candidates(): CoherenceCandidate[] {
    return this.candidates.filter(
      (c) => c.promotedToLayer2 && !this.dismissedCandidateIds.has(c.candidateId)
    )
  }

  /** Returns stored embeddings (for debugging/testing). */
  getEmbeddings(): ReadonlyMap<string, ArtifactEmbedding> {
    return this.embeddings
  }

  /** Returns the Layer 1b content-hash index (for debugging/testing). */
  getContentHashIndex(): ReadonlyMap<string, ContentHashEntry[]> {
    return this.contentHashIndex
  }

  /** Returns the set of artifact IDs that have changed since the last scan. */
  getChangedArtifactIds(): ReadonlySet<string> {
    return this.changedArtifactIds
  }

  /** Returns the tick of the last Layer 1 scan. */
  getLastScanTick(): number {
    return this.lastScanTick
  }

  /** Returns whether Layer 1c sweep has pending changes. */
  isLayer1cDirty(): boolean {
    return this.layer1cDirty
  }

  /** Returns the tick at which Layer 1c last ran. */
  getLastLayer1cSweepTick(): number {
    return this.lastLayer1cSweepTick
  }

  /** Check if Layer 1c should run on the current tick. */
  shouldRunLayer1cSweep(currentTick: number): boolean {
    if (!this.config.enableLayer1c) return false
    if (!this.sweepService) return false
    if (!this.layer1cDirty) return false
    return (currentTick - this.lastLayer1cSweepTick) >= this.config.layer1cScanIntervalTicks
  }

  /**
   * Run Layer 1c full-corpus sweep.
   *
   * When Layer 2 is enabled, produces CoherenceCandidate objects for Layer 2 review.
   * When Layer 2 is disabled, emits CoherenceEvent objects directly (backward compat).
   *
   * @returns Array of new candidates (Layer 2 enabled) or events (Layer 2 disabled)
   */
  async runLayer1cSweep(
    currentTick: number,
    listArtifacts: () => ArtifactEvent[],
    contentProvider: (artifactId: string) => string | undefined
  ): Promise<CoherenceCandidate[]> {
    if (!this.shouldRunLayer1cSweep(currentTick)) return []

    const artifacts = listArtifacts()
    const corpus: LlmSweepArtifact[] = []
    let totalEstimatedTokens = 0

    for (const artifact of artifacts) {
      const content = contentProvider(artifact.artifactId)
      if (!content) continue

      totalEstimatedTokens += Math.ceil(content.length / 4)
      corpus.push({
        artifactId: artifact.artifactId,
        workstream: artifact.workstream,
        content,
      })
    }

    if (corpus.length === 0) {
      this.lastLayer1cSweepTick = currentTick
      this.layer1cDirty = false
      return []
    }
    if (totalEstimatedTokens > this.config.layer1cMaxCorpusTokens) {
      this.lastLayer1cSweepTick = currentTick
      this.layer1cDirty = false
      return []
    }

    const issues = await this.sweepService!.sweepCorpus({
      artifacts: corpus,
      prompt: this.buildLayer1cPrompt(corpus),
      model: this.config.layer1cModel,
    })

    this.lastLayer1cSweepTick = currentTick
    this.layer1cDirty = false

    // Build O(1) lookup for corpus artifact IDs and workstreams
    const artifactById = new Map<string, ArtifactEvent>()
    for (const a of artifacts) {
      artifactById.set(a.artifactId, a)
    }

    const newCandidates: CoherenceCandidate[] = []
    const dedupePairs = new Set<string>()

    for (const issue of issues) {
      if (issue.artifactIdA === issue.artifactIdB) continue

      const pairKey = [issue.artifactIdA, issue.artifactIdB].sort().join(':')
      if (dedupePairs.has(pairKey)) continue
      dedupePairs.add(pairKey)
      if (this.hasExistingIssueForPair(issue.artifactIdA, issue.artifactIdB)) continue

      const artifactA = artifactById.get(issue.artifactIdA)
      const artifactB = artifactById.get(issue.artifactIdB)
      if (!artifactA || !artifactB) continue
      if (artifactA.workstream === artifactB.workstream) continue

      // Check if embeddings already created a candidate for this pair
      const existing = this.findCandidateByPair(issue.artifactIdA, issue.artifactIdB)
      if (existing) {
        // Update existing candidate with sweep context and promote to Layer 2
        existing.promotedToLayer2 = true
        existing.source = existing.source ?? 'sweep'
        existing.sweepExplanation = issue.explanation
        existing.sweepConfidence = issue.confidence
        newCandidates.push(existing)
        continue
      }

      if (this.config.enableLayer2) {
        // Layer 2 enabled: create candidate for review
        this.candidateCounter += 1
        const candidate: CoherenceCandidate = {
          candidateId: `candidate-${this.candidateCounter}`,
          artifactIdA: issue.artifactIdA,
          artifactIdB: issue.artifactIdB,
          workstreamA: artifactA.workstream,
          workstreamB: artifactB.workstream,
          similarityScore: 0,
          candidateCategory: issue.category,
          detectedAt: new Date().toISOString(),
          promotedToLayer2: true,
          source: 'sweep',
          sweepExplanation: issue.explanation,
          sweepConfidence: issue.confidence,
        }
        this.candidates.push(candidate)
        newCandidates.push(candidate)
      } else {
        // Layer 2 disabled: emit directly as CoherenceEvent (backward compat)
        this.issueCounter += 1
        const coherenceIssue: CoherenceEvent = {
          type: 'coherence',
          agentId: 'system',
          issueId: `coherence-${this.issueCounter}`,
          title: `Layer 1c sweep issue: ${issue.artifactIdA} / ${issue.artifactIdB}`,
          description: issue.explanation,
          category: issue.category,
          severity: issue.severity,
          affectedWorkstreams: [artifactA.workstream, artifactB.workstream],
          affectedArtifactIds: [issue.artifactIdA, issue.artifactIdB],
        }
        this.detectedIssues.push(coherenceIssue)

        // Still return a candidate shape for the caller
        this.candidateCounter += 1
        const candidate: CoherenceCandidate = {
          candidateId: `candidate-${this.candidateCounter}`,
          artifactIdA: issue.artifactIdA,
          artifactIdB: issue.artifactIdB,
          workstreamA: artifactA.workstream,
          workstreamB: artifactB.workstream,
          similarityScore: 0,
          candidateCategory: issue.category,
          detectedAt: new Date().toISOString(),
          promotedToLayer2: false,
          source: 'sweep',
          sweepExplanation: issue.explanation,
          sweepConfidence: issue.confidence,
        }
        newCandidates.push(candidate)
      }
    }

    return newCandidates
  }

  // ─── Layer 2: LLM deep review ────────────────────────────────────

  /**
   * Run Layer 2 review on pending promoted candidates.
   *
   * Batches up to 5 candidates per review call (per design doc).
   * Respects rate limiting.
   *
   * @param contentProvider Retrieves artifact text content by ID
   * @returns Array of review results
   */
  async runLayer2Review(
    contentProvider?: (artifactId: string) => string | undefined
  ): Promise<CoherenceReviewResult[]> {
    if (!this.reviewService || !this.config.enableLayer2) return []
    const resolvedContentProvider = contentProvider ?? this.artifactContentProvider
    if (!resolvedContentProvider) return []

    const pending = this.getPendingLayer2Candidates()
    if (pending.length === 0) return []

    // When skipLayer2ForEmbeddings is enabled, auto-emit embedding candidates
    // and only send sweep candidates through L2 review
    const embeddingCandidates = this.config.skipLayer2ForEmbeddings
      ? pending.filter(c => c.source !== 'sweep')
      : []
    const sweepCandidates = this.config.skipLayer2ForEmbeddings
      ? pending.filter(c => c.source === 'sweep')
      : pending

    const autoResults: CoherenceReviewResult[] = []
    for (const candidate of embeddingCandidates) {
      this.issueCounter++
      const issue: CoherenceEvent = {
        type: 'coherence',
        agentId: 'system',
        issueId: `coherence-${this.issueCounter}`,
        title: `Detected: ${candidate.candidateCategory} between ${candidate.workstreamA} and ${candidate.workstreamB}`,
        description: `Embedding similarity ${candidate.similarityScore.toFixed(3)}`,
        category: candidate.candidateCategory,
        severity: 'medium',
        affectedWorkstreams: [candidate.workstreamA, candidate.workstreamB],
        affectedArtifactIds: [candidate.artifactIdA, candidate.artifactIdB]
      }
      this.detectedIssues.push(issue)
      this.dismissedCandidateIds.add(candidate.candidateId)
      autoResults.push({
        candidateId: candidate.candidateId,
        confirmed: true,
        confidence: 'high',
        explanation: issue.description,
        notifyAgentIds: [],
      })
    }

    if (sweepCandidates.length === 0) return autoResults

    const now = Date.now()
    if (!this.rateLimiter.canReview(now)) return autoResults

    // Batch up to 5 sweep candidates for L2 review
    const batch = sweepCandidates.slice(0, 5)

    // Assemble artifact contents
    const artifactContents = new Map<string, string>()
    for (const candidate of batch) {
      const contentA = resolvedContentProvider(candidate.artifactIdA)
      if (contentA) artifactContents.set(candidate.artifactIdA, contentA)
      const contentB = resolvedContentProvider(candidate.artifactIdB)
      if (contentB) artifactContents.set(candidate.artifactIdB, contentB)
    }

    const request: import('./coherence-review-service').CoherenceReviewRequest = {
      candidates: batch,
      artifactContents,
      relevantDecisions: [],
      workstreamBriefs: [],
      corpusArtifacts: this.corpusArtifacts ?? undefined,
    }

    this.rateLimiter.record(now)
    const results = await this.reviewService.review(request)

    for (const result of results) {
      this.reviewResults.push(result)

      if (result.confirmed && result.confidence !== 'low') {
        const candidate = batch.find((c) => c.candidateId === result.candidateId)
        if (candidate) {
          this.issueCounter++
          const isAdvisory = result.confidence === 'likely'
          const issue: CoherenceEvent = {
            type: 'coherence',
            agentId: 'system',
            issueId: `coherence-${this.issueCounter}`,
            title: isAdvisory
              ? `Advisory: ${result.category ?? candidate.candidateCategory} between ${candidate.workstreamA} and ${candidate.workstreamB}`
              : `Confirmed: ${result.category ?? candidate.candidateCategory} between ${candidate.workstreamA} and ${candidate.workstreamB}`,
            description: result.explanation,
            category: result.category ?? candidate.candidateCategory,
            severity: isAdvisory ? 'low' : (result.severity ?? 'medium'),
            affectedWorkstreams: [candidate.workstreamA, candidate.workstreamB],
            affectedArtifactIds: [candidate.artifactIdA, candidate.artifactIdB]
          }
          this.detectedIssues.push(issue)
        }
      }

      // Mark candidate as reviewed (dismissed or confirmed)
      this.dismissedCandidateIds.add(result.candidateId)
    }

    const allResults = [...autoResults, ...results]
    this.updateFeedbackLoop(allResults)
    return allResults
  }

  /** Returns all Layer 2 review results. */
  getReviewResults(): readonly CoherenceReviewResult[] {
    return this.reviewResults
  }

  /** Returns the rate limiter for testing/monitoring. */
  getRateLimiter(): ReviewRateLimiter {
    return this.rateLimiter
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private updateContentHashIndex(event: ArtifactEvent): void {
    const previousHash = this.artifactHashById.get(event.artifactId)
    if (previousHash) {
      const previousEntries = this.contentHashIndex.get(previousHash) ?? []
      const remaining = previousEntries.filter((entry) => entry.artifactId !== event.artifactId)
      if (remaining.length === 0) {
        this.contentHashIndex.delete(previousHash)
      } else {
        this.contentHashIndex.set(previousHash, remaining)
      }
    }

    if (!event.contentHash) {
      this.artifactHashById.delete(event.artifactId)
      return
    }

    const entries = this.contentHashIndex.get(event.contentHash) ?? []
    entries.push({
      artifactId: event.artifactId,
      workstream: event.workstream,
      agentId: event.agentId,
    })
    this.contentHashIndex.set(event.contentHash, entries)
    this.artifactHashById.set(event.artifactId, event.contentHash)
  }

  private runContentHashComparison(
    changedArtifactIds: string[],
    artifactProvider: (artifactId: string) => ArtifactEvent | undefined
  ): CoherenceCandidate[] {
    const newCandidates: CoherenceCandidate[] = []
    const emittedPairs = new Set<string>()

    for (const changedArtifactId of changedArtifactIds) {
      const hash = this.artifactHashById.get(changedArtifactId)
      if (!hash) continue

      const changedArtifact = artifactProvider(changedArtifactId)
      if (!changedArtifact) continue

      const entries = this.contentHashIndex.get(hash) ?? []
      for (const other of entries) {
        if (other.artifactId === changedArtifactId) continue
        if (other.workstream === changedArtifact.workstream) continue
        if (other.agentId === changedArtifact.agentId) continue

        const pairKey = [changedArtifactId, other.artifactId].sort().join(':')
        if (emittedPairs.has(pairKey)) continue
        emittedPairs.add(pairKey)

        const existing = this.findCandidateByPair(changedArtifactId, other.artifactId)
        if (existing) {
          existing.similarityScore = Math.max(existing.similarityScore, 1.0)
          existing.promotedToLayer2 = true
          continue
        }

        this.candidateCounter += 1
        const candidate: CoherenceCandidate = {
          candidateId: `candidate-${this.candidateCounter}`,
          artifactIdA: changedArtifactId,
          artifactIdB: other.artifactId,
          workstreamA: changedArtifact.workstream,
          workstreamB: other.workstream,
          similarityScore: 1.0,
          candidateCategory: 'duplication',
          detectedAt: new Date().toISOString(),
          promotedToLayer2: true,
        }
        this.candidates.push(candidate)
        newCandidates.push(candidate)
      }
    }

    return newCandidates
  }

  private findCandidateByPair(artifactIdA: string, artifactIdB: string): CoherenceCandidate | undefined {
    const pairKey = [artifactIdA, artifactIdB].sort().join(':')
    return this.candidates.find((candidate) => {
      const candidateKey = [candidate.artifactIdA, candidate.artifactIdB].sort().join(':')
      return candidateKey === pairKey
    })
  }

  private hasExistingIssueForPair(artifactIdA: string, artifactIdB: string): boolean {
    const pairKey = [artifactIdA, artifactIdB].sort().join(':')
    return this.detectedIssues.some((issue) => {
      if (issue.affectedArtifactIds.length !== 2) return false
      const issueKey = [...issue.affectedArtifactIds].sort().join(':')
      return issueKey === pairKey
    })
  }

  private buildLayer1cPrompt(artifacts: LlmSweepArtifact[]): string {
    const grouped = new Map<string, LlmSweepArtifact[]>()
    for (const artifact of artifacts) {
      const entries = grouped.get(artifact.workstream) ?? []
      entries.push(artifact)
      grouped.set(artifact.workstream, entries)
    }

    const sections: string[] = [
      'You are a coherence monitor for a multi-agent project. Review ALL artifacts below',
      'and identify ANY cases of: duplication, contradiction, dependency violation, or',
      'configuration drift between artifacts in DIFFERENT workstreams.',
      '',
      'Focus especially on:',
      '- Functions or classes that appear in multiple files across workstreams',
      '- Contradictory assumptions or decisions',
      '- API contracts that do not match between consumer and producer',
      '',
      'DO NOT flag these as issues — they are normal and expected:',
      '- Documentation that references or describes code from another workstream',
      '- Security docs discussing authentication code — that is documentation, not duplication',
      '- Deployment docs referencing infrastructure configuration — that is documentation',
      '- Different workstreams having validation for their own domain',
      '- Intentional environment-specific differences (e.g., dev vs prod settings)',
      '- Test files that mirror production code structure',
      '',
      'If no issues are found, return an empty array: []',
      '',
      'Return ONLY a JSON array. Each object must include:',
      '{\"artifactIdA\":\"...\",\"artifactIdB\":\"...\",\"category\":\"duplication|contradiction|gap|dependency_violation\",\"severity\":\"low|medium|high|critical\",\"confidence\":\"high|likely|low\",\"explanation\":\"...\",\"suggestedResolution\":\"...\",\"notifyAgentIds\":[]}',
      '',
      `Valid artifact IDs: ${artifacts.map(a => a.artifactId).join(', ')}`,
      '',
    ]

    for (const [workstream, entries] of grouped) {
      sections.push(`## Workstream: ${workstream}`)
      for (const entry of entries) {
        sections.push(`### Artifact ${entry.artifactId}`)
        sections.push('```')
        sections.push(entry.content)
        sections.push('```')
        sections.push('')
      }
    }

    return sections.join('\n')
  }

  private onTick(_tick: number): void {
    // Layer 1 scanning is triggered by tick but runs asynchronously.
    // The actual scan is invoked by the owner (index.ts) who has access
    // to the artifact/content providers. The tick handler only tracks
    // whether a scan is due.
    //
    // The owner checks shouldRunLayer1Scan() and calls runLayer1Scan()
    // if true. This avoids the monitor needing direct access to the
    // KnowledgeStore.
  }

  /** Check if a Layer 1 scan is due based on tick interval. */
  shouldRunLayer1Scan(currentTick: number): boolean {
    if (!this.embeddingService) return false
    if (this.changedArtifactIds.size === 0) return false
    return (currentTick - this.lastScanTick) >= this.config.layer1ScanIntervalTicks
  }

  private createConflictEvent(
    newEvent: ArtifactEvent,
    existing: { agentId: string; artifactId: string },
    sourcePath: string
  ): CoherenceEvent {
    this.issueCounter += 1
    const issueId = `coherence-${this.issueCounter}`

    // Determine affected workstreams from both artifacts
    const affectedWorkstreams = new Set<string>()
    affectedWorkstreams.add(newEvent.workstream)
    // We don't have the old artifact's workstream readily available
    // so we just include the new one. The knowledge store can enrich later.

    return {
      type: 'coherence',
      agentId: newEvent.agentId,
      issueId,
      title: `File conflict: ${sourcePath}`,
      description: `Agent "${newEvent.agentId}" is writing to "${sourcePath}" which was previously claimed by agent "${existing.agentId}" (artifact ${existing.artifactId}). New artifact: ${newEvent.artifactId}.`,
      category: 'duplication',
      severity: 'high',
      affectedWorkstreams: Array.from(affectedWorkstreams),
      affectedArtifactIds: [existing.artifactId, newEvent.artifactId]
    }
  }
}

export { isEmbeddable }
