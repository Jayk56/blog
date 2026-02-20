import type { AuditLogEntry, OverridePatternReport } from './override-pattern-analyzer'
import { OverridePatternAnalyzer } from './override-pattern-analyzer'

/** Confidence level for a constraint suggestion. */
export type SuggestionConfidence = 'high' | 'medium' | 'low'

/** Source of evidence that led to the suggestion. */
export type SuggestionSource = 'override_pattern' | 'coherence_pattern' | 'domain_analysis'

/** A data-driven constraint suggestion inferred from audit log patterns. */
export interface ConstraintSuggestion {
  id: string
  text: string
  reasoning: string
  confidence: SuggestionConfidence
  source: SuggestionSource
  relatedEvidence: string[]
}

/** Minimal KnowledgeStore interface for audit log access. */
export interface ConstraintInferenceStore {
  listAuditLog(entityType?: string, entityId?: string): AuditLogEntry[]
  appendAuditLog(
    entityType: string,
    entityId: string,
    action: string,
    callerAgentId?: string,
    details?: unknown
  ): void
}

// Thresholds for suggestion generation
const WORKSTREAM_OVERRIDE_THRESHOLD = 3
const TOOL_OVERRIDE_THRESHOLD = 3
const COHERENCE_PAIR_THRESHOLD = 2
const HIGH_CONFIDENCE_THRESHOLD = 5
const MEDIUM_CONFIDENCE_THRESHOLD = 3

/**
 * Analyzes audit log patterns to infer useful project constraints.
 *
 * Inspects override patterns (via OverridePatternAnalyzer) and coherence
 * issues to generate data-driven constraint suggestions that humans
 * can accept or dismiss.
 */
export class ConstraintInferenceService {
  private readonly overrideAnalyzer = new OverridePatternAnalyzer()

  constructor(
    private readonly store: ConstraintInferenceStore
  ) {}

  /** Generate constraint suggestions from audit log patterns. */
  suggestConstraints(): ConstraintSuggestion[] {
    const auditRecords = this.store.listAuditLog()
    const suggestions: ConstraintSuggestion[] = []
    let idCounter = 0

    const nextId = () => `cs-${++idCounter}`

    // (a) Override pattern analysis
    const overrideReport = this.overrideAnalyzer.analyzeOverrides(auditRecords)
    this.suggestFromWorkstreamOverrides(overrideReport, nextId, suggestions)
    this.suggestFromToolOverrides(overrideReport, nextId, suggestions)

    // (b) Coherence pattern analysis
    this.suggestFromCoherencePatterns(auditRecords, nextId, suggestions)

    return suggestions
  }

  /** Record feedback on a suggestion (accepted or dismissed). */
  recordFeedback(suggestionId: string, accepted: boolean, suggestionText?: string): void {
    this.store.appendAuditLog(
      'constraint_feedback',
      suggestionId,
      accepted ? 'accepted' : 'dismissed',
      undefined,
      { suggestionId, accepted, suggestionText }
    )
  }

  // ── Workstream override suggestions ──────────────────────────────

  private suggestFromWorkstreamOverrides(
    report: OverridePatternReport,
    nextId: () => string,
    out: ConstraintSuggestion[]
  ): void {
    for (const [workstream, count] of Object.entries(report.overridesByWorkstream)) {
      if (count < WORKSTREAM_OVERRIDE_THRESHOLD) continue

      const confidence = this.assignConfidence(count)
      out.push({
        id: nextId(),
        text: `Require human review for all changes in the "${workstream}" workstream`,
        reasoning: `${count} override(s) detected in the "${workstream}" workstream, indicating agents frequently misjudge decisions in this area.`,
        confidence,
        source: 'override_pattern',
        relatedEvidence: [
          `${count} overrides in workstream "${workstream}"`,
          `Analysis window: ticks ${report.analysisWindow.startTick ?? '?'}–${report.analysisWindow.endTick ?? '?'}`,
        ],
      })
    }
  }

  // ── Tool override suggestions ────────────────────────────────────

  private suggestFromToolOverrides(
    report: OverridePatternReport,
    nextId: () => string,
    out: ConstraintSuggestion[]
  ): void {
    for (const [tool, count] of Object.entries(report.overridesByToolCategory)) {
      if (count < TOOL_OVERRIDE_THRESHOLD) continue

      const confidence = this.assignConfidence(count)
      out.push({
        id: nextId(),
        text: `Restrict use of "${tool}" tool — require explicit approval`,
        reasoning: `${count} override(s) on "${tool}" tool calls, suggesting agents misuse or misapply this tool.`,
        confidence,
        source: 'override_pattern',
        relatedEvidence: [
          `${count} overrides for tool "${tool}"`,
          `Total overrides in window: ${report.totalOverrides}`,
        ],
      })
    }
  }

  // ── Coherence pattern suggestions ────────────────────────────────

  private suggestFromCoherencePatterns(
    auditRecords: AuditLogEntry[],
    nextId: () => string,
    out: ConstraintSuggestion[]
  ): void {
    // Count coherence issues by affected workstream pairs
    const pairCounts = new Map<string, number>()
    const pairEvidence = new Map<string, string[]>()

    for (const entry of auditRecords) {
      if (entry.entityType !== 'coherence_issue') continue
      if (entry.action !== 'create') continue

      const details = entry.details as Record<string, unknown> | undefined
      if (!details) continue

      // Extract affected workstreams from coherence issue audit entries
      // The coherence_issue audit entries store the issueId as entityId
      // We need to look at the related data — coherence issues affect workstream pairs
      const workstreams = this.extractWorkstreamsFromCoherence(entry)
      if (workstreams.length < 2) continue

      // Generate all pairs
      for (let i = 0; i < workstreams.length; i++) {
        for (let j = i + 1; j < workstreams.length; j++) {
          const pair = [workstreams[i], workstreams[j]].sort().join('::')
          pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1)
          const existing = pairEvidence.get(pair) ?? []
          existing.push(`Issue ${entry.entityId}`)
          pairEvidence.set(pair, existing)
        }
      }
    }

    for (const [pair, count] of pairCounts) {
      if (count < COHERENCE_PAIR_THRESHOLD) continue

      const [ws1, ws2] = pair.split('::')
      const confidence = this.assignConfidence(count)
      const evidence = pairEvidence.get(pair) ?? []

      out.push({
        id: nextId(),
        text: `Add coordination checkpoint between "${ws1}" and "${ws2}" workstreams`,
        reasoning: `${count} coherence issue(s) detected between "${ws1}" and "${ws2}", indicating these workstreams produce conflicting or duplicated work.`,
        confidence,
        source: 'coherence_pattern',
        relatedEvidence: [
          `${count} coherence issues between "${ws1}" and "${ws2}"`,
          ...evidence.slice(0, 5),
        ],
      })
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private extractWorkstreamsFromCoherence(entry: AuditLogEntry): string[] {
    // Coherence issue audit entries may have details with affectedWorkstreams
    const details = entry.details
    if (typeof details !== 'object' || details === null) return []
    const obj = details as Record<string, unknown>
    if (Array.isArray(obj.affectedWorkstreams)) {
      return obj.affectedWorkstreams.filter((w): w is string => typeof w === 'string')
    }
    return []
  }

  private assignConfidence(count: number): SuggestionConfidence {
    if (count >= HIGH_CONFIDENCE_THRESHOLD) return 'high'
    if (count >= MEDIUM_CONFIDENCE_THRESHOLD) return 'medium'
    return 'low'
  }
}
