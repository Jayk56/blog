import * as path from 'node:path'
import { synthesizeFromFileNames } from './enrichment.js'

// ── Interfaces ───────────────────────────────────────────────────────

interface DescriptionRequest {
  workstreamName: string
  fileNames: string[]
  existingJsDocs: Array<{ fileName: string; text: string }>
  barrelExports?: string[]
  dependencies?: string[]
}

interface DescriptionResult {
  description: string
  source: 'llm' | 'heuristic'
}

interface DescriptionSynthesisService {
  synthesize(request: DescriptionRequest): Promise<DescriptionResult>
}

export type { DescriptionRequest, DescriptionResult, DescriptionSynthesisService }

// ── HeuristicDescriptionService ──────────────────────────────────────

/**
 * Improved heuristic description synthesis.
 * Scores JSDoc candidates by relevance rather than picking the longest.
 */
export class HeuristicDescriptionService implements DescriptionSynthesisService {
  async synthesize(request: DescriptionRequest): Promise<DescriptionResult> {
    const { workstreamName, fileNames, existingJsDocs } = request

    if (existingJsDocs.length === 0) {
      return {
        description: synthesizeFromFileNames(workstreamName, fileNames),
        source: 'heuristic',
      }
    }

    // Extract sibling concepts from file basenames (for cross-reference scoring)
    const siblingConcepts = fileNames
      .map(f => path.basename(f, '.ts'))
      .flatMap(n => n.split('-'))
      .filter(part => part.length >= 4) // skip short words like 'ts', 'the', etc.
      .map(part => part.toLowerCase())

    // Score each candidate
    const scored = existingJsDocs.map(candidate => {
      let score = 0

      // +10 if text mentions the workstream name (case-insensitive)
      if (candidate.text.toLowerCase().includes(workstreamName.toLowerCase())) {
        score += 10
      }

      // +5 if from a file matching the workstream name
      const baseName = path.basename(candidate.fileName, '.ts')
      if (baseName.toLowerCase().includes(workstreamName.toLowerCase())) {
        score += 5
      }

      // +3 if describes a class/interface (first non-whitespace word starts with capital letter)
      const firstWord = candidate.text.trimStart().split(/\s+/)[0]
      if (firstWord && /^[A-Z]/.test(firstWord)) {
        score += 3
      }

      // -5 if contains @param or @returns or TODO (implementation detail)
      if (/@param|@returns|TODO/i.test(candidate.text)) {
        score -= 5
      }

      // +2 for each sibling file concept mentioned in the text (breadth bonus)
      // A JSDoc that references concepts from multiple sibling files is more representative.
      // Only count concepts from OTHER files, not the candidate's own file.
      const candidateBaseParts = new Set(
        path.basename(candidate.fileName, '.ts').split('-').map(p => p.toLowerCase())
      )
      const textLower = candidate.text.toLowerCase()
      const mentionedConcepts = new Set<string>()
      for (const concept of siblingConcepts) {
        if (!candidateBaseParts.has(concept) && textLower.includes(concept)) {
          mentionedConcepts.add(concept)
        }
      }
      score += mentionedConcepts.size * 2

      return { candidate, score }
    })

    // Sort by score descending, then by text length descending (tiebreaker)
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.candidate.text.length - a.candidate.text.length
    })

    const best = scored[0].candidate.text
    // Extract first sentence
    const description = firstSentence(best)

    return { description, source: 'heuristic' }
  }
}

// ── LlmDescriptionService ────────────────────────────────────────────

/**
 * LLM-based description synthesis using Anthropic Messages API with Haiku.
 * Falls back to HeuristicDescriptionService on any error.
 */
export class LlmDescriptionService implements DescriptionSynthesisService {
  private readonly apiKey: string
  private readonly heuristicFallback = new HeuristicDescriptionService()

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async synthesize(request: DescriptionRequest): Promise<DescriptionResult> {
    try {
      const prompt = this.buildPrompt(request)
      const response = await this.callApi(prompt)
      const description = firstSentence(response)
      return { description, source: 'llm' }
    } catch {
      // Fall back to heuristic on ANY error
      return this.heuristicFallback.synthesize(request)
    }
  }

  private buildPrompt(request: DescriptionRequest): string {
    const parts: string[] = [
      `You are describing a software workstream named "${request.workstreamName}".`,
      `Write a single concise sentence (under 120 characters) describing what this workstream does.`,
      '',
      `Files in this workstream:`,
      ...request.fileNames.map(f => `  - ${path.basename(f)}`),
    ]

    if (request.existingJsDocs.length > 0) {
      parts.push('', 'JSDoc comments found in these files:')
      for (const doc of request.existingJsDocs.slice(0, 5)) {
        parts.push(`  [${path.basename(doc.fileName)}]: ${doc.text.slice(0, 200)}`)
      }
    }

    if (request.barrelExports && request.barrelExports.length > 0) {
      parts.push('', `Exported symbols: ${request.barrelExports.join(', ')}`)
    }

    if (request.dependencies && request.dependencies.length > 0) {
      parts.push('', `Dependencies: ${request.dependencies.join(', ')}`)
    }

    parts.push('', 'Respond with ONLY the description sentence, nothing else.')

    return parts.join('\n')
  }

  private async callApi(prompt: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 150,
        messages: [
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>
    }

    if (!data.content || data.content.length === 0 || !data.content[0].text) {
      throw new Error('Empty response from Anthropic API')
    }

    return data.content[0].text.trim()
  }
}

// ── MockDescriptionService ───────────────────────────────────────────

/**
 * Mock description service for testing.
 * Tracks calls and allows registering custom responses.
 */
export class MockDescriptionService implements DescriptionSynthesisService {
  callCount: number = 0
  lastRequest?: DescriptionRequest
  private readonly overrides = new Map<string, DescriptionResult>()
  private readonly heuristicFallback = new HeuristicDescriptionService()

  registerResponse(name: string, result: DescriptionResult): void {
    this.overrides.set(name, result)
  }

  async synthesize(request: DescriptionRequest): Promise<DescriptionResult> {
    this.callCount++
    this.lastRequest = request

    const override = this.overrides.get(request.workstreamName)
    if (override) {
      return override
    }

    return this.heuristicFallback.synthesize(request)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Extract up to first sentence-ending punctuation (. ! ?). */
function firstSentence(text: string): string {
  const match = text.match(/^(.*?[.!?])(?:\s|$)/)
  if (match) return match[1]
  const firstLine = text.split('\n')[0].trim()
  return firstLine
}
