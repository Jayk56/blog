import type { CoherenceCategory, Severity } from '../types/events'
import {
  buildReviewPrompt,
  type ConfidenceLevel,
  type CoherenceCandidate,
  type CoherenceReviewRequest,
  type CoherenceReviewResult,
  type CoherenceReviewService,
  type LlmSweepArtifact,
  type LlmSweepIssue,
  type LlmSweepRequest,
  type LlmSweepService,
} from './coherence-review-service'

export interface LlmReviewConfig {
  provider: 'anthropic' | 'openai'
  apiKey: string
  model: string
  maxTokens: number
  temperature: number
  maxRetries: number
  retryBaseMs: number
  /** Enable adaptive thinking for Anthropic provider. Default: true. */
  enableThinking: boolean
  /** Optional overrides used by tests. */
  fetchImpl?: typeof fetch
  sleepFn?: (ms: number) => Promise<void>
}

const DEFAULT_CONFIG: Omit<LlmReviewConfig, 'apiKey'> = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  maxTokens: 16000,
  temperature: 0,
  maxRetries: 3,
  retryBaseMs: 1000,
  enableThinking: true,
}

interface ParsedReviewEntry {
  candidateId: string
  confirmed: boolean
  category?: CoherenceCategory
  severity?: Severity
  confidence?: ConfidenceLevel
  explanation: string
  suggestedResolution?: string
  notifyAgentIds: string[]
}

interface ParsedSweepEntry {
  artifactIdA: string
  artifactIdB: string
  category?: CoherenceCategory
  severity?: Severity
  confidence?: ConfidenceLevel
  explanation: string
  suggestedResolution?: string
  notifyAgentIds: string[]
}

export class LlmReviewService implements CoherenceReviewService, LlmSweepService {
  private readonly config: LlmReviewConfig
  private readonly fetchImpl: typeof fetch
  private readonly sleepFn: (ms: number) => Promise<void>

  constructor(config: Partial<LlmReviewConfig> & Pick<LlmReviewConfig, 'apiKey'>) {
    const merged: LlmReviewConfig = {
      ...DEFAULT_CONFIG,
      ...config,
    }

    if (!merged.apiKey?.trim()) {
      throw new Error('LlmReviewService requires a non-empty apiKey')
    }
    if (!merged.model?.trim()) {
      throw new Error('LlmReviewService requires a non-empty model')
    }
    if (merged.maxTokens <= 0) {
      throw new Error('LlmReviewService maxTokens must be > 0')
    }
    if (merged.maxRetries < 0) {
      throw new Error('LlmReviewService maxRetries must be >= 0')
    }

    this.config = merged
    this.fetchImpl = merged.fetchImpl ?? fetch
    this.sleepFn = merged.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async review(request: CoherenceReviewRequest): Promise<CoherenceReviewResult[]> {
    if (request.candidates.length === 0) return []

    const prompt = buildReviewPrompt(request)
    const raw = await this.requestTextCompletion(prompt)
    const parsed = parseReviewResults(raw)

    if (!parsed) {
      return request.candidates.map((candidate) => fallbackReviewResult(candidate, 'Response parsing failed; defaulting to confirmed for safety.'))
    }

    const parsedById = new Map(parsed.map((entry) => [entry.candidateId, entry]))

    return request.candidates.map((candidate) => {
      const entry = parsedById.get(candidate.candidateId)
      if (!entry) {
        return fallbackReviewResult(candidate, 'Response missing candidate entry; defaulting to confirmed for safety.')
      }

      return {
        candidateId: candidate.candidateId,
        confirmed: entry.confirmed,
        category: entry.category ?? candidate.candidateCategory,
        severity: entry.severity ?? 'medium',
        confidence: entry.confidence,
        explanation: entry.explanation,
        suggestedResolution: entry.suggestedResolution,
        notifyAgentIds: entry.notifyAgentIds,
      }
    })
  }

  async sweepCorpus(request: LlmSweepRequest): Promise<LlmSweepIssue[]> {
    if (request.artifacts.length === 0) return []

    const prompt = request.prompt || buildLayer1cPrompt(request.artifacts)
    const raw = await this.requestTextCompletion(prompt, request.model, true)
    const parsed = parseSweepResults(raw)
    if (!parsed) {
      return []
    }

    const dedupe = new Set<string>()
    const issues: LlmSweepIssue[] = []
    for (const entry of parsed) {
      if (!entry.artifactIdA || !entry.artifactIdB || !entry.explanation) continue
      const pairKey = [entry.artifactIdA, entry.artifactIdB].sort().join(':')
      if (dedupe.has(pairKey)) continue
      dedupe.add(pairKey)

      issues.push({
        artifactIdA: entry.artifactIdA,
        artifactIdB: entry.artifactIdB,
        category: entry.category ?? 'duplication',
        severity: entry.severity ?? 'medium',
        confidence: entry.confidence,
        explanation: entry.explanation,
        suggestedResolution: entry.suggestedResolution,
        notifyAgentIds: entry.notifyAgentIds,
      })
    }

    return issues
  }

  async requestTextCompletion(prompt: string, modelOverride?: string, disableThinking?: boolean): Promise<string> {
    let attempt = 0
    while (attempt <= this.config.maxRetries) {
      const response = await this.fetchProvider(prompt, modelOverride, disableThinking)
      if (response.ok) {
        return this.extractCompletionText(await response.json() as Record<string, unknown>)
      }

      const shouldRetry = response.status === 429 || response.status >= 500
      if (!shouldRetry || attempt === this.config.maxRetries) {
        const details = await safeReadText(response)
        throw new Error(`LLM request failed (${response.status}): ${details}`)
      }

      const waitMs = this.computeBackoffMs(attempt)
      await this.sleepFn(waitMs)
      attempt += 1
    }

    throw new Error('LLM request failed after retries')
  }

  private fetchProvider(prompt: string, modelOverride?: string, disableThinking?: boolean): Promise<Response> {
    if (this.config.provider === 'anthropic') {
      return this.fetchAnthropic(prompt, modelOverride, disableThinking)
    }
    return this.fetchOpenAi(prompt, modelOverride, disableThinking)
  }

  private fetchAnthropic(prompt: string, modelOverride?: string, disableThinking?: boolean): Promise<Response> {
    const body: Record<string, unknown> = {
      model: modelOverride ?? this.config.model,
      max_tokens: this.config.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }

    const useThinking = this.config.enableThinking && !disableThinking
    if (useThinking) {
      // Adaptive thinking — temperature must not be set
      body.thinking = { type: 'adaptive' }
    } else {
      body.temperature = this.config.temperature
    }

    return this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
  }

  private fetchOpenAi(prompt: string, modelOverride?: string, disableThinking?: boolean): Promise<Response> {
    const useThinking = this.config.enableThinking && !disableThinking
    const body: Record<string, unknown> = {
      model: modelOverride ?? this.config.model,
      messages: [{ role: 'user', content: prompt }],
    }

    // GPT-5.2 requires max_completion_tokens (not max_tokens)
    const isGpt5 = (modelOverride ?? this.config.model).startsWith('gpt-5')
    if (useThinking) {
      body.reasoning_effort = 'medium'
      body.max_completion_tokens = this.config.maxTokens
    } else if (isGpt5) {
      body.temperature = this.config.temperature
      body.max_completion_tokens = this.config.maxTokens
    } else {
      body.temperature = this.config.temperature
      body.max_tokens = this.config.maxTokens
    }

    return this.fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    })
  }

  private extractCompletionText(payload: Record<string, unknown>): string {
    if (this.config.provider === 'anthropic') {
      const content = payload.content
      if (Array.isArray(content)) {
        const textChunks = content
          .map((item) => {
            if (!item || typeof item !== 'object') return ''
            const record = item as Record<string, unknown>
            // Skip thinking blocks — only extract text blocks
            if (record.type !== undefined && record.type !== 'text') return ''
            return typeof record.text === 'string' ? record.text : ''
          })
          .filter(Boolean)

        return textChunks.join('\n').trim()
      }
      return ''
    }

    const choices = payload.choices
    if (!Array.isArray(choices) || choices.length === 0) return ''
    const firstChoice = choices[0] as Record<string, unknown>
    const message = firstChoice.message as Record<string, unknown> | undefined
    const content = message?.content
    if (typeof content === 'string') return content.trim()

    if (Array.isArray(content)) {
      const textChunks = content
        .map((item) => {
          if (!item || typeof item !== 'object') return ''
          const record = item as Record<string, unknown>
          return typeof record.text === 'string' ? record.text : ''
        })
        .filter(Boolean)
      return textChunks.join('\n').trim()
    }

    return ''
  }

  private computeBackoffMs(attempt: number): number {
    const base = this.config.retryBaseMs * (2 ** attempt)
    const jitter = Math.floor(base * Math.random() * 0.1)
    return base + jitter
  }
}

export function buildLayer1cPrompt(artifacts: LlmSweepArtifact[]): string {
  const grouped = new Map<string, LlmSweepArtifact[]>()
  for (const artifact of artifacts) {
    const list = grouped.get(artifact.workstream) ?? []
    list.push(artifact)
    grouped.set(artifact.workstream, list)
  }

  const lines: string[] = [
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
    'Return a JSON array. Each object must include:',
    '{"artifactIdA":"...","artifactIdB":"...","category":"duplication|contradiction|gap|dependency_violation","severity":"low|medium|high|critical","confidence":"high|likely|low","explanation":"...","suggestedResolution":"...","notifyAgentIds":[]}',
    '',
    `Valid artifact IDs: ${artifacts.map(a => a.artifactId).join(', ')}`,
    '',
  ]

  for (const [workstream, entries] of grouped) {
    lines.push(`## Workstream: ${workstream}`)
    for (const entry of entries) {
      lines.push(`### Artifact ${entry.artifactId}`)
      lines.push('```')
      lines.push(entry.content)
      lines.push('```')
      lines.push('')
    }
  }

  return lines.join('\n')
}

function fallbackReviewResult(candidate: CoherenceCandidate, explanation: string): CoherenceReviewResult {
  return {
    candidateId: candidate.candidateId,
    confirmed: true,
    category: candidate.candidateCategory,
    severity: 'medium',
    explanation,
    notifyAgentIds: [],
  }
}

function parseReviewResults(raw: string): ParsedReviewEntry[] | null {
  const parsed = parseJsonArray(raw)
  if (!parsed) return null

  const output: ParsedReviewEntry[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.candidateId !== 'string') continue
    if (typeof record.confirmed !== 'boolean') continue
    if (typeof record.explanation !== 'string') continue

    output.push({
      candidateId: record.candidateId,
      confirmed: record.confirmed,
      category: coerceCategory(record.category),
      severity: coerceSeverity(record.severity),
      confidence: coerceConfidence(record.confidence),
      explanation: record.explanation,
      suggestedResolution: typeof record.suggestedResolution === 'string' ? record.suggestedResolution : undefined,
      notifyAgentIds: Array.isArray(record.notifyAgentIds)
        ? record.notifyAgentIds.filter((id): id is string => typeof id === 'string')
        : [],
    })
  }

  return output.length > 0 ? output : null
}

function parseSweepResults(raw: string): ParsedSweepEntry[] | null {
  const parsed = parseJsonArray(raw)
  if (!parsed) return null

  const output: ParsedSweepEntry[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const artifactIdA = typeof record.artifactIdA === 'string'
      ? record.artifactIdA
      : (typeof record.artifactA === 'string' ? record.artifactA : undefined)
    const artifactIdB = typeof record.artifactIdB === 'string'
      ? record.artifactIdB
      : (typeof record.artifactB === 'string' ? record.artifactB : undefined)

    if (!artifactIdA || !artifactIdB) continue
    if (typeof record.explanation !== 'string') continue

    output.push({
      artifactIdA,
      artifactIdB,
      category: coerceCategory(record.category),
      severity: coerceSeverity(record.severity),
      confidence: coerceConfidence(record.confidence),
      explanation: record.explanation,
      suggestedResolution: typeof record.suggestedResolution === 'string' ? record.suggestedResolution : undefined,
      notifyAgentIds: Array.isArray(record.notifyAgentIds)
        ? record.notifyAgentIds.filter((id): id is string => typeof id === 'string')
        : [],
    })
  }

  return output.length > 0 ? output : null
}

function parseJsonArray(raw: string): unknown[] | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const direct = tryParseArray(trimmed)
  if (direct) return direct

  // Handle fenced code blocks.
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedMatch?.[1]) {
    const fenced = tryParseArray(fencedMatch[1].trim())
    if (fenced) return fenced
  }

  // Handle extra text around JSON.
  const firstBracket = trimmed.indexOf('[')
  const lastBracket = trimmed.lastIndexOf(']')
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const sliced = trimmed.slice(firstBracket, lastBracket + 1)
    const parsed = tryParseArray(sliced)
    if (parsed) return parsed
  }

  return null
}

function tryParseArray(text: string): unknown[] | null {
  try {
    const value = JSON.parse(text)
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function coerceCategory(value: unknown): CoherenceCategory | undefined {
  if (value === 'duplication' || value === 'contradiction' || value === 'gap' || value === 'dependency_violation') {
    return value
  }
  return undefined
}

function coerceSeverity(value: unknown): Severity | undefined {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical') {
    return value
  }
  return undefined
}

function coerceConfidence(value: unknown): ConfidenceLevel | undefined {
  if (value === 'high' || value === 'likely' || value === 'low') {
    return value
  }
  return undefined
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text || '<empty body>'
  } catch {
    return '<unreadable body>'
  }
}
