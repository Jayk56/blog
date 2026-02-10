import type { ArtifactEvent, ArtifactKind, CoherenceEvent, Severity } from '../types/events'
import type { EmbeddingService } from './embedding-service'
import { cosineSimilarity } from './embedding-service'
import type {
  CoherenceCandidate,
  CoherenceReviewService,
  CoherenceReviewResult
} from './coherence-review-service'
import { ReviewRateLimiter } from './coherence-review-service'
import type { TickService } from '../tick'

/** Configuration for the full coherence monitor (Layers 0, 1, 2). */
export interface CoherenceMonitorConfig {
  /** How often Layer 1 scans run, in ticks (default: 10). */
  layer1ScanIntervalTicks: number

  /** Cosine similarity threshold for promoting to Layer 2 (default: 0.85). */
  layer1PromotionThreshold: number

  /** Similarity threshold for auto-emitting advisory issues (default: 0.70). */
  layer1AdvisoryThreshold: number

  /** Max artifacts to scan per cycle (default: 500). */
  layer1MaxArtifactsPerScan: number

  /** Embedding model name (informational, used by real EmbeddingService). */
  embeddingModel: string

  /** Max Layer 2 reviews per hour (default: 10). */
  layer2MaxReviewsPerHour: number

  /** Layer 2 model name (informational). */
  layer2Model: string

  /** Whether Layer 2 is enabled (default: false — requires real LLM). */
  enableLayer2: boolean
}

/** Default configuration. */
const DEFAULT_CONFIG: CoherenceMonitorConfig = {
  layer1ScanIntervalTicks: 10,
  layer1PromotionThreshold: 0.85,
  layer1AdvisoryThreshold: 0.70,
  layer1MaxArtifactsPerScan: 500,
  embeddingModel: 'text-embedding-3-small',
  layer2MaxReviewsPerHour: 10,
  layer2Model: 'claude-sonnet-4-5-20250929',
  enableLayer2: false
}

/** Stored embedding for an artifact. */
interface ArtifactEmbedding {
  artifactId: string
  workstream: string
  embedding: number[]
  lastUpdatedTick: number
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
  private readonly changedArtifactIds = new Set<string>()
  private lastScanTick = 0
  private readonly candidates: CoherenceCandidate[] = []
  private candidateCounter = 0

  // --- Layer 2 state ---
  private reviewService: CoherenceReviewService | null = null
  private rateLimiter: ReviewRateLimiter
  private readonly reviewResults: CoherenceReviewResult[] = []
  private readonly dismissedCandidateIds = new Set<string>()

  // --- Tick subscription ---
  private tickHandler: ((tick: number) => void) | null = null

  // --- Artifact content provider (for Layer 2 context assembly) ---
  private artifactContentProvider: ((artifactId: string) => string | undefined) | null = null

  constructor(config: Partial<CoherenceMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
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

  /** Set a function that retrieves artifact content by ID (for Layer 2 context). */
  setArtifactContentProvider(provider: (artifactId: string) => string | undefined): void {
    this.artifactContentProvider = provider
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
    this.changedArtifactIds.clear()
    this.lastScanTick = 0
    this.candidates.length = 0
    this.candidateCounter = 0
    this.reviewResults.length = 0
    this.dismissedCandidateIds.clear()
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
    if (!this.embeddingService) return []

    const changedIds = Array.from(this.changedArtifactIds)
    this.changedArtifactIds.clear()
    this.lastScanTick = currentTick

    // Filter to embeddable artifacts, respect max scan limit
    const toEmbed: { artifactId: string; content: string; event: ArtifactEvent }[] = []

    for (const id of changedIds) {
      if (toEmbed.length >= this.config.layer1MaxArtifactsPerScan) break

      const event = artifactProvider(id)
      if (!event) continue
      if (!isEmbeddable(event.kind, event.mimeType)) continue

      const content = contentProvider(id)
      if (!content) continue

      toEmbed.push({ artifactId: id, content, event })
    }

    if (toEmbed.length === 0) return []

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
    const newCandidates: CoherenceCandidate[] = []
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
          // Check if we already have a candidate for this pair
          const pairKey = [changedEmb.artifactId, other.artifactId].sort().join(':')
          const existing = this.candidates.find((c) => {
            const key = [c.artifactIdA, c.artifactIdB].sort().join(':')
            return key === pairKey
          })

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

  /** Returns the set of artifact IDs that have changed since the last scan. */
  getChangedArtifactIds(): ReadonlySet<string> {
    return this.changedArtifactIds
  }

  /** Returns the tick of the last Layer 1 scan. */
  getLastScanTick(): number {
    return this.lastScanTick
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
    contentProvider: (artifactId: string) => string | undefined
  ): Promise<CoherenceReviewResult[]> {
    if (!this.reviewService || !this.config.enableLayer2) return []

    const pending = this.getPendingLayer2Candidates()
    if (pending.length === 0) return []

    const now = Date.now()
    if (!this.rateLimiter.canReview(now)) return []

    // Batch up to 5
    const batch = pending.slice(0, 5)

    // Assemble artifact contents
    const artifactContents = new Map<string, string>()
    for (const candidate of batch) {
      const contentA = contentProvider(candidate.artifactIdA)
      if (contentA) artifactContents.set(candidate.artifactIdA, contentA)
      const contentB = contentProvider(candidate.artifactIdB)
      if (contentB) artifactContents.set(candidate.artifactIdB, contentB)
    }

    const request = {
      candidates: batch,
      artifactContents,
      relevantDecisions: [],
      workstreamBriefs: []
    }

    this.rateLimiter.record(now)
    const results = await this.reviewService.review(request)

    for (const result of results) {
      this.reviewResults.push(result)

      if (result.confirmed) {
        // Emit a CoherenceEvent for confirmed issues
        const candidate = batch.find((c) => c.candidateId === result.candidateId)
        if (candidate) {
          this.issueCounter++
          const issue: CoherenceEvent = {
            type: 'coherence',
            agentId: 'system',
            issueId: `coherence-${this.issueCounter}`,
            title: `Confirmed: ${result.category ?? candidate.candidateCategory} between ${candidate.workstreamA} and ${candidate.workstreamB}`,
            description: result.explanation,
            category: result.category ?? candidate.candidateCategory,
            severity: result.severity ?? 'medium',
            affectedWorkstreams: [candidate.workstreamA, candidate.workstreamB],
            affectedArtifactIds: [candidate.artifactIdA, candidate.artifactIdB]
          }
          this.detectedIssues.push(issue)
        }
      }

      // Mark candidate as reviewed (dismissed or confirmed)
      this.dismissedCandidateIds.add(result.candidateId)
    }

    return results
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
