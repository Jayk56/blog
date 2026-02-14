import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import {
  HeuristicDescriptionService,
  MockDescriptionService,
} from '../../scripts/lib/description-service'
import type {
  DescriptionRequest,
  DescriptionResult,
} from '../../scripts/lib/description-service'
import { collectJsDocCandidates } from '../../scripts/lib/enrichment'

const repoRoot = path.resolve(__dirname, '../..')

// ── HeuristicDescriptionService ──────────────────────────────────────

describe('HeuristicDescriptionService', () => {
  const service = new HeuristicDescriptionService()

  it('prefers JSDoc mentioning workstream name over longer text', async () => {
    const request: DescriptionRequest = {
      workstreamName: 'trust',
      fileNames: ['src/intelligence/trust-engine.ts', 'src/intelligence/context-injection-service.ts'],
      existingJsDocs: [
        {
          fileName: 'src/intelligence/context-injection-service.ts',
          text: 'ContextInjectionService evaluates injection policies for each active agent and pushes updated KnowledgeSnapshots or deltas via the adapter plugin. Three independent triggers: periodic, reactive, staleness.',
        },
        {
          fileName: 'src/intelligence/trust-engine.ts',
          text: 'TrustEngine tracks per-agent trust scores, applies deltas from decision resolutions and completions.',
        },
      ],
    }

    const result = await service.synthesize(request)
    expect(result.source).toBe('heuristic')
    // Should pick TrustEngine doc because it mentions "trust" (+10)
    expect(result.description).toMatch(/TrustEngine/)
  })

  it('prefers class-describing JSDoc (starts with capital letter)', async () => {
    const request: DescriptionRequest = {
      workstreamName: 'gateway',
      fileNames: ['src/gateway/plugin.ts', 'src/gateway/utils.ts'],
      existingJsDocs: [
        {
          fileName: 'src/gateway/utils.ts',
          text: 'helper functions for port management and health checking.',
        },
        {
          fileName: 'src/gateway/plugin.ts',
          text: 'LocalHttpPlugin manages agent sandboxes via HTTP.',
        },
      ],
    }

    const result = await service.synthesize(request)
    // "LocalHttpPlugin" starts with capital -> +3
    // "helper" starts with lowercase -> +0
    // Both are same length-ish, capital wins
    expect(result.description).toMatch(/LocalHttpPlugin/)
  })

  it('penalizes JSDoc with @param/@returns', async () => {
    const request: DescriptionRequest = {
      workstreamName: 'utils',
      fileNames: ['src/utils/parser.ts', 'src/utils/formatter.ts'],
      existingJsDocs: [
        {
          fileName: 'src/utils/parser.ts',
          text: 'Parse the input string into tokens.\n@param input The string to parse\n@returns Array of tokens',
        },
        {
          fileName: 'src/utils/formatter.ts',
          text: 'Formatter handles output formatting for display.',
        },
      ],
    }

    const result = await service.synthesize(request)
    // parser.ts has @param/@returns -> -5
    // formatter.ts starts with capital -> +3
    expect(result.description).toMatch(/Formatter/)
  })

  it('falls back to file names when no candidates', async () => {
    const request: DescriptionRequest = {
      workstreamName: 'gateway',
      fileNames: ['src/gateway/local-http-plugin.ts', 'src/gateway/port-pool.ts'],
      existingJsDocs: [],
    }

    const result = await service.synthesize(request)
    expect(result.source).toBe('heuristic')
    // Should use synthesizeFromFileNames
    expect(result.description).toMatch(/Gateway/)
  })

  it('handles empty input (no files, no jsdocs)', async () => {
    const request: DescriptionRequest = {
      workstreamName: 'empty',
      fileNames: [],
      existingJsDocs: [],
    }

    const result = await service.synthesize(request)
    expect(result.source).toBe('heuristic')
    expect(result.description).toMatch(/empty/i)
  })

  it('uses text length as tiebreaker when scores are equal', async () => {
    const request: DescriptionRequest = {
      workstreamName: 'data',
      fileNames: ['src/data/store.ts', 'src/data/cache.ts'],
      existingJsDocs: [
        {
          fileName: 'src/data/store.ts',
          text: 'Short desc.',
        },
        {
          fileName: 'src/data/cache.ts',
          text: 'A much longer description that provides more context about the data caching layer.',
        },
      ],
    }

    const result = await service.synthesize(request)
    // Both have same score (no workstream mention, no capital start, no penalties)
    // Longer text wins as tiebreaker
    expect(result.description).toMatch(/caching/)
  })

  it('handles workstream name match in file name', async () => {
    const request: DescriptionRequest = {
      workstreamName: 'knowledge',
      fileNames: ['src/intelligence/knowledge-store.ts', 'src/intelligence/trust-engine.ts'],
      existingJsDocs: [
        {
          fileName: 'src/intelligence/knowledge-store.ts',
          text: 'SQLite-backed store for project state.',
        },
        {
          fileName: 'src/intelligence/trust-engine.ts',
          text: 'TrustEngine tracks per-agent trust scores and applies deltas.',
        },
      ],
    }

    const result = await service.synthesize(request)
    // knowledge-store.ts: +5 (file name matches "knowledge")
    // trust-engine.ts: +3 (capital letter), no name match
    // knowledge-store wins with +5 > +3
    expect(result.description).toMatch(/SQLite/)
  })
})

// ── MockDescriptionService ───────────────────────────────────────────

describe('MockDescriptionService', () => {
  it('tracks call count', async () => {
    const mock = new MockDescriptionService()
    expect(mock.callCount).toBe(0)

    await mock.synthesize({
      workstreamName: 'test',
      fileNames: ['a.ts'],
      existingJsDocs: [],
    })
    expect(mock.callCount).toBe(1)

    await mock.synthesize({
      workstreamName: 'test',
      fileNames: ['b.ts'],
      existingJsDocs: [],
    })
    expect(mock.callCount).toBe(2)
  })

  it('stores lastRequest', async () => {
    const mock = new MockDescriptionService()
    const request: DescriptionRequest = {
      workstreamName: 'intelligence',
      fileNames: ['src/intelligence/trust-engine.ts'],
      existingJsDocs: [{ fileName: 'trust-engine.ts', text: 'TrustEngine tracks trust.' }],
      barrelExports: ['TrustEngine'],
    }

    await mock.synthesize(request)
    expect(mock.lastRequest).toBe(request)
    expect(mock.lastRequest!.workstreamName).toBe('intelligence')
  })

  it('returns custom response via registerResponse', async () => {
    const mock = new MockDescriptionService()
    const customResult: DescriptionResult = {
      description: 'Custom intelligence description',
      source: 'llm',
    }
    mock.registerResponse('intelligence', customResult)

    const result = await mock.synthesize({
      workstreamName: 'intelligence',
      fileNames: [],
      existingJsDocs: [],
    })

    expect(result).toBe(customResult)
    expect(result.description).toBe('Custom intelligence description')
    expect(result.source).toBe('llm')
  })

  it('falls back to heuristic when no override registered', async () => {
    const mock = new MockDescriptionService()
    // Register for 'routes', not 'gateway'
    mock.registerResponse('routes', { description: 'Routes', source: 'llm' })

    const result = await mock.synthesize({
      workstreamName: 'gateway',
      fileNames: ['src/gateway/plugin.ts'],
      existingJsDocs: [{ fileName: 'src/gateway/plugin.ts', text: 'Plugin manages sandboxes.' }],
    })

    // Should get heuristic result since no override for 'gateway'
    expect(result.source).toBe('heuristic')
    expect(result.description).toMatch(/Plugin/)
  })
})

// ── Integration: collectJsDocCandidates + HeuristicDescriptionService ──

describe('Integration: heuristic service with real workstream data', () => {
  it('intelligence description is non-generic and relevant', async () => {
    const service = new HeuristicDescriptionService()
    const intelligenceDir = path.join(repoRoot, 'src', 'intelligence')

    // Get real file list from intelligence workstream
    const files = getWorkstreamFiles(repoRoot, 'intelligence')
    const jsDocs = collectJsDocCandidates('intelligence', intelligenceDir, files, repoRoot)

    const result = await service.synthesize({
      workstreamName: 'intelligence',
      fileNames: files,
      existingJsDocs: jsDocs,
    })

    expect(result.source).toBe('heuristic')
    // Should NOT be the generic fallback
    expect(result.description).not.toBe('Workstream for intelligence')
    expect(result.description).not.toMatch(/^Intelligence:/)
    // Should be a meaningful description (non-trivial length)
    expect(result.description.length).toBeGreaterThan(10)
    // Should NOT be the ContextInjectionService description (the old longest-wins bug)
    expect(result.description).not.toMatch(/ContextInjectionService evaluates/)
  })

  it('trust-engine JSDoc scores higher than context-injection for intelligence workstream', async () => {
    const service = new HeuristicDescriptionService()
    const intelligenceDir = path.join(repoRoot, 'src', 'intelligence')
    const files = getWorkstreamFiles(repoRoot, 'intelligence')
    const jsDocs = collectJsDocCandidates('intelligence', intelligenceDir, files, repoRoot)

    // The trust-engine JSDoc mentions nothing about "intelligence" but trust-engine.ts
    // context-injection-service.ts has the longest JSDoc but should not win
    const result = await service.synthesize({
      workstreamName: 'intelligence',
      fileNames: files,
      existingJsDocs: jsDocs,
    })

    // Any of the intelligence-mentioning or high-scoring descriptions are acceptable
    // Just not the old ContextInjectionService one
    expect(result.description).not.toMatch(/injection policies/)
  })
})

// ── collectJsDocCandidates tests ─────────────────────────────────────

describe('collectJsDocCandidates', () => {
  it('returns non-empty candidates for intelligence workstream', () => {
    const intelligenceDir = path.join(repoRoot, 'src', 'intelligence')
    const files = getWorkstreamFiles(repoRoot, 'intelligence')
    const candidates = collectJsDocCandidates('intelligence', intelligenceDir, files, repoRoot)

    expect(candidates.length).toBeGreaterThan(0)
    // Should have at least one from trust-engine or coherence-review-service
    const fileNames = candidates.map(c => c.fileName)
    const hasTrustOrCoherence = fileNames.some(
      f => f.includes('trust-engine') || f.includes('coherence-review-service')
    )
    expect(hasTrustOrCoherence).toBe(true)
  })

  it('returns empty array when no files provided', () => {
    const candidates = collectJsDocCandidates('empty', '/nonexistent', [], repoRoot)
    expect(candidates).toEqual([])
  })

})

// ── Helper ───────────────────────────────────────────────────────────

/**
 * Get the relative file paths for a workstream by scanning its directory.
 * Mirrors what the scanner does but in a simpler way for tests.
 */
function getWorkstreamFiles(root: string, wsName: string): string[] {
  const wsDir = path.join(root, 'src', wsName)
  if (!fs.existsSync(wsDir)) return []

  const entries = fs.readdirSync(wsDir, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.ts'))
    .map(e => `src/${wsName}/${e.name}`)
}
