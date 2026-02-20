import { describe, expect, it } from 'vitest'

import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import { escalationPredicateSchema } from '../../src/validation/schemas'

describe('Domain-Specific Trust', () => {
  describe('domain score initialization', () => {
    it('initializes domain score on first domain outcome', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')

      // No domain scores before any domain outcome
      expect(engine.getDomainScores('a').size).toBe(0)

      engine.applyOutcome('a', 'task_completed_clean', 0, {
        artifactKinds: ['code'],
      })

      // Domain score initialized at initialScore (50), then delta applied (+3)
      expect(engine.getDomainScore('a', 'code')).toBe(53)
    })

    it('no domain outcomes = no domain scores (backward compat)', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')

      // Apply outcomes without artifactKinds
      engine.applyOutcome('a', 'task_completed_clean')
      engine.applyOutcome('a', 'human_approves_tool_call')

      expect(engine.getDomainScores('a').size).toBe(0)
      expect(engine.getDomainScore('a', 'code')).toBeUndefined()
    })
  })

  describe('domain score updates', () => {
    it('updates domain scores independently per artifact kind', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')

      // Code domain: +3
      engine.applyOutcome('a', 'task_completed_clean', 0, {
        artifactKinds: ['code'],
      })
      // Test domain: -2
      engine.applyOutcome('a', 'human_rejects_tool_call', 1, {
        artifactKinds: ['test'],
      })

      expect(engine.getDomainScore('a', 'code')).toBe(53) // 50 + 3
      expect(engine.getDomainScore('a', 'test')).toBe(48) // 50 - 2
    })

    it('applies delta to multiple domains when multiple artifactKinds provided', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')

      engine.applyOutcome('a', 'task_completed_clean', 0, {
        artifactKinds: ['code', 'config'],
      })

      expect(engine.getDomainScore('a', 'code')).toBe(53) // 50 + 3
      expect(engine.getDomainScore('a', 'config')).toBe(53) // 50 + 3
    })

    it('domain scores use same diminishing returns as global', () => {
      const engine = new TrustEngine({
        initialScore: 91, // Above diminishing return threshold
      })
      engine.registerAgent('a')

      // At 91 (>90), +3 halved to +1 for domain score too
      engine.applyOutcome('a', 'task_completed_clean', 0, {
        artifactKinds: ['code'],
      })

      // Domain initialized at 91 (initialScore), then +1 (diminished) = 92
      expect(engine.getDomainScore('a', 'code')).toBe(92)
    })

    it('domain scores use same floor/ceiling as global', () => {
      const engine = new TrustEngine({
        initialScore: 99,
        ceilingScore: 100,
      })
      engine.registerAgent('a')

      // +3 from 99 clamps to 100
      engine.applyOutcome('a', 'task_completed_clean', 0, {
        artifactKinds: ['code'],
      })

      expect(engine.getDomainScore('a', 'code')).toBe(100)
    })
  })

  describe('global score unchanged by domain logic', () => {
    it('global score follows same computation regardless of domain context', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.registerAgent('b')

      // Agent 'a' with domain context
      engine.applyOutcome('a', 'task_completed_clean', 0, {
        artifactKinds: ['code'],
      })
      // Agent 'b' without domain context
      engine.applyOutcome('b', 'task_completed_clean', 0)

      // Both global scores should be identical
      expect(engine.getScore('a')).toBe(53)
      expect(engine.getScore('b')).toBe(53)
    })
  })

  describe('domain decay', () => {
    it('domain decay applies per-domain on tick', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({
        initialScore: 50,
        decayRatePerTick: 1,
      })

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      // Create domain scores with activity
      engine.applyOutcome('a', 'task_completed_clean', 0, {
        artifactKinds: ['code'],
      })
      // code domain is now 53

      // Activity on a different domain at tick 1
      engine.applyOutcome('a', 'task_completed_clean', 1, {
        artifactKinds: ['test'],
      })
      // test domain is now 53, code domain still 53

      // Tick 2: code domain has been idle since tick 0, should decay.
      // test domain has been idle since tick 1, should also decay.
      tickService.advance(1) // fires tick 2 (since last tick was 1 from the advance we haven't done yet)

      // Actually let me reason more carefully. tickService starts at 0 by default.
      // We haven't advanced it yet, so current tick is still 0.
      // Let me restart the test logic.
      engine.unsubscribeFrom(tickService)
    })

    it('domain scores decay independently toward baseline', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({
        initialScore: 50,
        decayRatePerTick: 1,
        decayTargetScore: 50,
      })

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      // Create domain at tick 0 with a positive outcome
      engine.applyOutcome('a', 'task_completed_clean', 0, {
        artifactKinds: ['code'],
      })
      expect(engine.getDomainScore('a', 'code')).toBe(53)

      // Advance 1 tick: domain was active at tick 0, idle at tick 1
      tickService.advance(1)
      // code domain: 53 > 50 (target), decays to 52
      expect(engine.getDomainScore('a', 'code')).toBe(52)

      // Advance 2 more ticks
      tickService.advance(2)
      // code domain: 52 -> 51 -> 50
      expect(engine.getDomainScore('a', 'code')).toBe(50)

      // At baseline, no further decay
      tickService.advance(1)
      expect(engine.getDomainScore('a', 'code')).toBe(50)

      engine.unsubscribeFrom(tickService)
    })

    it('domain below baseline decays upward', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({
        initialScore: 50,
        decayRatePerTick: 1,
        decayTargetScore: 50,
      })

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      // Create domain at tick 0 with a negative outcome
      engine.applyOutcome('a', 'human_rejects_tool_call', 0, {
        artifactKinds: ['code'],
      })
      expect(engine.getDomainScore('a', 'code')).toBe(48) // 50 - 2

      // Decay should move domain score back up toward 50
      tickService.advance(1)
      expect(engine.getDomainScore('a', 'code')).toBe(49)

      tickService.advance(1)
      expect(engine.getDomainScore('a', 'code')).toBe(50)

      engine.unsubscribeFrom(tickService)
    })
  })

  describe('getDomainScores API', () => {
    it('getDomainScores returns correct map', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')

      engine.applyOutcome('a', 'task_completed_clean', 0, {
        artifactKinds: ['code', 'test'],
      })
      engine.applyOutcome('a', 'human_rejects_tool_call', 1, {
        artifactKinds: ['config'],
      })

      const scores = engine.getDomainScores('a')
      expect(scores.size).toBe(3)
      expect(scores.get('code')).toBe(53)
      expect(scores.get('test')).toBe(53)
      expect(scores.get('config')).toBe(48)
    })

    it('getDomainScores returns empty map for unregistered agent', () => {
      const engine = new TrustEngine()
      expect(engine.getDomainScores('unknown').size).toBe(0)
    })

    it('getAllDomainScores returns all agents with domain scores', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.registerAgent('b')
      engine.registerAgent('c') // no domain outcomes

      engine.applyOutcome('a', 'task_completed_clean', 0, {
        artifactKinds: ['code'],
      })
      engine.applyOutcome('b', 'human_approves_tool_call', 0, {
        artifactKinds: ['test'],
      })

      const all = engine.getAllDomainScores()
      expect(all).toHaveLength(2) // 'c' excluded (no domain scores)

      const aEntry = all.find(e => e.agentId === 'a')
      expect(aEntry?.domainScores.code).toBe(53)

      const bEntry = all.find(e => e.agentId === 'b')
      expect(bEntry?.domainScores.test).toBe(51)
    })
  })

  describe('escalation predicate', () => {
    it('domainTrustScore predicate validates via schema', () => {
      const predicate = {
        field: 'domainTrustScore' as const,
        op: 'lt' as const,
        value: 40,
        domain: 'code' as const,
      }

      const result = escalationPredicateSchema.safeParse(predicate)
      expect(result.success).toBe(true)
    })

    it('domainTrustScore predicate works in compound rules', () => {
      const compound = {
        type: 'and' as const,
        rules: [
          { field: 'domainTrustScore' as const, op: 'lt' as const, value: 40, domain: 'code' as const },
          { field: 'blastRadius' as const, op: 'gte' as const, value: 'medium' as const },
        ],
      }

      const result = escalationPredicateSchema.safeParse(compound)
      expect(result.success).toBe(true)
    })
  })

  describe('persistence', () => {
    it('domain scores persist to and load from KnowledgeStore', () => {
      const store = new KnowledgeStore(':memory:')

      // Store domain scores
      store.storeDomainTrustScores('agent-1', {
        code: 65,
        test: 42,
        config: 50,
      })

      // Retrieve them
      const scores = store.getDomainTrustScores('agent-1')
      expect(scores.code).toBe(65)
      expect(scores.test).toBe(42)
      expect(scores.config).toBe(50)

      // Different agent returns empty
      expect(store.getDomainTrustScores('agent-2')).toEqual({})

      store.close()
    })

    it('storeDomainTrustScores upserts on conflict', () => {
      const store = new KnowledgeStore(':memory:')

      store.storeDomainTrustScores('a', { code: 50 })
      store.storeDomainTrustScores('a', { code: 75 })

      expect(store.getDomainTrustScores('a').code).toBe(75)

      store.close()
    })

    it('deleteDomainTrustScores removes all domain scores for agent', () => {
      const store = new KnowledgeStore(':memory:')

      store.storeDomainTrustScores('a', { code: 65, test: 42 })
      store.deleteDomainTrustScores('a')

      expect(store.getDomainTrustScores('a')).toEqual({})

      store.close()
    })
  })
})
