/**
 * Layer 2: LLM-based coherence review service.
 *
 * Accepts promoted candidates from Layer 1 (or manual promotion) and uses
 * an LLM to confirm/dismiss, classify, and recommend resolution.
 */

import type { CoherenceCategory, Severity } from '../types/events'

/** A candidate coherence issue detected by Layer 1 (or promoted from Layer 0). */
export interface CoherenceCandidate {
  candidateId: string
  artifactIdA: string
  artifactIdB: string
  workstreamA: string
  workstreamB: string
  similarityScore: number
  candidateCategory: CoherenceCategory
  detectedAt: string
  promotedToLayer2: boolean
  source?: 'embedding' | 'content_hash' | 'sweep'
  sweepExplanation?: string
  sweepConfidence?: ConfidenceLevel
}

/** Request payload for a Layer 2 review. */
export interface CoherenceReviewRequest {
  candidates: CoherenceCandidate[]
  artifactContents: Map<string, string>
  relevantDecisions: { id: string; title: string; agentId: string }[]
  workstreamBriefs: { id: string; name: string; goals: string[] }[]
  /** Optional full corpus context — when provided, all artifacts are included in the prompt for richer review. */
  corpusArtifacts?: { artifactId: string; workstream: string; content: string }[]
}

/** Confidence level from LLM review. */
export type ConfidenceLevel = 'high' | 'likely' | 'low'

/** Result from a Layer 2 LLM review of a single candidate. */
export interface CoherenceReviewResult {
  candidateId: string
  confirmed: boolean
  category?: CoherenceCategory
  severity?: Severity
  confidence?: ConfidenceLevel
  explanation: string
  suggestedResolution?: string
  notifyAgentIds: string[]
}

/** Service interface for Layer 2 coherence reviews. */
export interface CoherenceReviewService {
  /**
   * Review a batch of coherence candidates using an LLM.
   * Returns results for each candidate in the request.
   * Implementations must respect rate limiting externally (the caller manages the rate).
   */
  review(request: CoherenceReviewRequest): Promise<CoherenceReviewResult[]>
}

/** Artifact input for full-corpus Layer 1c sweeps. */
export interface LlmSweepArtifact {
  artifactId: string
  workstream: string
  content: string
}

/** Request payload for a Layer 1c full-corpus sweep. */
export interface LlmSweepRequest {
  artifacts: LlmSweepArtifact[]
  prompt?: string
  model?: string
}

/** Result payload for a Layer 1c sweep issue. */
export interface LlmSweepIssue {
  artifactIdA: string
  artifactIdB: string
  category: CoherenceCategory
  severity: Severity
  confidence?: ConfidenceLevel
  explanation: string
  suggestedResolution?: string
  notifyAgentIds: string[]
}

/** Service interface for Layer 1c full-corpus sweeps. */
export interface LlmSweepService {
  sweepCorpus(request: LlmSweepRequest): Promise<LlmSweepIssue[]>
}

/**
 * Rate limiter for Layer 2 reviews.
 * Tracks review invocations and enforces a maximum reviews-per-hour cap.
 */
export class ReviewRateLimiter {
  private readonly maxPerHour: number
  private readonly timestamps: number[] = []

  constructor(maxPerHour: number) {
    this.maxPerHour = maxPerHour
  }

  /** Check whether a review is allowed right now. */
  canReview(now = Date.now()): boolean {
    this.prune(now)
    return this.timestamps.length < this.maxPerHour
  }

  /** Record that a review was performed. */
  record(now = Date.now()): void {
    this.timestamps.push(now)
  }

  /** Returns the number of reviews performed in the current window. */
  reviewsInWindow(now = Date.now()): number {
    this.prune(now)
    return this.timestamps.length
  }

  /** Returns remaining allowed reviews. */
  remaining(now = Date.now()): number {
    this.prune(now)
    return Math.max(0, this.maxPerHour - this.timestamps.length)
  }

  private prune(now: number): void {
    const oneHourAgo = now - 3_600_000
    while (this.timestamps.length > 0 && this.timestamps[0] < oneHourAgo) {
      this.timestamps.shift()
    }
  }
}

/**
 * Build the structured LLM prompt for coherence review.
 * This is the prompt template used by real implementations. Exposed for testing.
 */
export function buildReviewPrompt(request: CoherenceReviewRequest): string {
  const sections: string[] = []

  sections.push('You are a coherence reviewer for a multi-agent software project.')
  sections.push('Review the following artifact pairs that were flagged as potentially conflicting.')
  sections.push('')

  // Workstream context
  if (request.workstreamBriefs.length > 0) {
    sections.push('## Workstreams')
    for (const ws of request.workstreamBriefs) {
      sections.push(`- **${ws.name}** (${ws.id}): ${ws.goals.join('; ')}`)
    }
    sections.push('')
  }

  // Candidates
  sections.push('## Candidates to Review')
  for (const candidate of request.candidates) {
    sections.push(`### Candidate ${candidate.candidateId}`)
    sections.push(`- Artifacts: ${candidate.artifactIdA} (${candidate.workstreamA}) <-> ${candidate.artifactIdB} (${candidate.workstreamB})`)
    sections.push(`- Similarity score: ${candidate.similarityScore.toFixed(3)}`)
    sections.push(`- Preliminary category: ${candidate.candidateCategory}`)
    if (candidate.source === 'sweep' && candidate.sweepExplanation) {
      sections.push(`- Initial sweep finding: ${candidate.sweepExplanation}`)
    }

    const contentA = request.artifactContents.get(candidate.artifactIdA)
    const contentB = request.artifactContents.get(candidate.artifactIdB)

    if (contentA) {
      sections.push(`\nArtifact A content:\n\`\`\`\n${contentA}\n\`\`\``)
    }
    if (contentB) {
      sections.push(`\nArtifact B content:\n\`\`\`\n${contentB}\n\`\`\``)
    }
    sections.push('')
  }

  // Full corpus context (when provided)
  if (request.corpusArtifacts && request.corpusArtifacts.length > 0) {
    // Exclude artifacts already shown in candidate pairs to avoid duplication
    const shownIds = new Set<string>()
    for (const c of request.candidates) {
      shownIds.add(c.artifactIdA)
      shownIds.add(c.artifactIdB)
    }
    const additional = request.corpusArtifacts.filter(a => !shownIds.has(a.artifactId))
    if (additional.length > 0) {
      const grouped = new Map<string, typeof additional>()
      for (const a of additional) {
        const list = grouped.get(a.workstream) ?? []
        list.push(a)
        grouped.set(a.workstream, list)
      }
      sections.push('## Full Project Context')
      sections.push('The following artifacts are from the same project. Use them to understand the broader context when reviewing candidates above.')
      sections.push('')
      for (const [ws, artifacts] of grouped) {
        sections.push(`### Workstream: ${ws}`)
        for (const a of artifacts) {
          sections.push(`#### ${a.artifactId}`)
          sections.push('```')
          sections.push(a.content)
          sections.push('```')
          sections.push('')
        }
      }
    }
  }

  // Recent decisions
  if (request.relevantDecisions.length > 0) {
    sections.push('## Recent Decisions')
    for (const d of request.relevantDecisions) {
      sections.push(`- [${d.id}] "${d.title}" by agent ${d.agentId}`)
    }
    sections.push('')
  }

  sections.push('## Instructions')
  sections.push('For each candidate, respond with a JSON array of objects:')
  sections.push('```json')
  sections.push('[{')
  sections.push('  "candidateId": "...",')
  sections.push('  "confirmed": true/false,')
  sections.push('  "category": "contradiction" | "duplication" | "gap" | "dependency_violation",')
  sections.push('  "severity": "low" | "medium" | "high" | "critical",')
  sections.push('  "confidence": "high" | "likely" | "low",')
  sections.push('  "explanation": "...",')
  sections.push('  "suggestedResolution": "...",')
  sections.push('  "notifyAgentIds": ["..."]')
  sections.push('}]')
  sections.push('```')
  sections.push('')
  sections.push('Confidence levels:')
  sections.push('- "high": Clear issue requiring resolution')
  sections.push('- "likely": Probable issue but could be intentional — flag as advisory')
  sections.push('- "low": Insufficient evidence — dismiss')

  return sections.join('\n')
}

/**
 * Mock implementation of CoherenceReviewService for testing.
 *
 * By default, confirms all candidates with 'duplication' category and 'medium' severity.
 * You can register custom responses per candidate ID.
 */
export class MockCoherenceReviewService implements CoherenceReviewService {
  public callCount = 0
  public lastRequest: CoherenceReviewRequest | null = null
  private readonly customResponses = new Map<string, Partial<CoherenceReviewResult>>()

  /** Register a custom response for a specific candidate ID. */
  registerResponse(candidateId: string, response: Partial<CoherenceReviewResult>): void {
    this.customResponses.set(candidateId, response)
  }

  async review(request: CoherenceReviewRequest): Promise<CoherenceReviewResult[]> {
    this.callCount++
    this.lastRequest = request

    return request.candidates.map((candidate) => {
      const custom = this.customResponses.get(candidate.candidateId)

      return {
        candidateId: candidate.candidateId,
        confirmed: custom?.confirmed ?? true,
        category: custom?.category ?? candidate.candidateCategory,
        severity: custom?.severity ?? 'medium',
        confidence: custom?.confidence ?? 'high',
        explanation: custom?.explanation ?? `Mock review: artifacts ${candidate.artifactIdA} and ${candidate.artifactIdB} appear to overlap`,
        suggestedResolution: custom?.suggestedResolution ?? 'Consolidate overlapping work',
        notifyAgentIds: custom?.notifyAgentIds ?? []
      }
    })
  }

  /** Reset call tracking. */
  resetCounters(): void {
    this.callCount = 0
    this.lastRequest = null
  }
}
