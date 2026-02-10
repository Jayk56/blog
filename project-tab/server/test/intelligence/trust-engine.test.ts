import { describe, expect, it, vi } from 'vitest'

import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import type { TrustOutcome } from '../../src/intelligence/trust-engine'

describe('TrustEngine', () => {
  describe('initialization', () => {
    it('creates with default config', () => {
      const engine = new TrustEngine()
      const config = engine.getConfig()
      expect(config.initialScore).toBe(50)
      expect(config.floorScore).toBe(10)
      expect(config.ceilingScore).toBe(100)
      expect(config.decayTargetScore).toBe(50)
      expect(config.decayRatePerTick).toBe(0.01)
      expect(config.diminishingReturnThresholdHigh).toBe(90)
      expect(config.diminishingReturnThresholdLow).toBe(20)
      expect(config.calibrationMode).toBe(false)
    })

    it('creates with custom config overrides', () => {
      const engine = new TrustEngine({ initialScore: 75, floorScore: 20 })
      const config = engine.getConfig()
      expect(config.initialScore).toBe(75)
      expect(config.floorScore).toBe(20)
      expect(config.ceilingScore).toBe(100) // default preserved
    })
  })

  describe('agent registration', () => {
    it('registers an agent with initial score', () => {
      const engine = new TrustEngine()
      engine.registerAgent('agent-1')
      expect(engine.getScore('agent-1')).toBe(50)
    })

    it('does not re-register an already registered agent', () => {
      const engine = new TrustEngine()
      engine.registerAgent('agent-1')
      engine.applyOutcome('agent-1', 'task_completed_clean')
      engine.registerAgent('agent-1') // should be a no-op
      expect(engine.getScore('agent-1')).toBe(53) // 50 + 3
    })

    it('returns undefined for unregistered agent', () => {
      const engine = new TrustEngine()
      expect(engine.getScore('unknown')).toBeUndefined()
    })

    it('removes an agent', () => {
      const engine = new TrustEngine()
      engine.registerAgent('agent-1')
      engine.removeAgent('agent-1')
      expect(engine.getScore('agent-1')).toBeUndefined()
    })
  })

  describe('delta application - core trust rules', () => {
    it('applies +2 for approving recommended option', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.applyOutcome('a', 'human_approves_recommended_option')
      expect(engine.getScore('a')).toBe(52)
    })

    it('applies +1 for approving tool call', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.applyOutcome('a', 'human_approves_tool_call')
      expect(engine.getScore('a')).toBe(51)
    })

    it('applies +3 for always-approve', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.applyOutcome('a', 'human_approves_always')
      expect(engine.getScore('a')).toBe(53)
    })

    it('applies -1 for non-recommended option', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.applyOutcome('a', 'human_picks_non_recommended')
      expect(engine.getScore('a')).toBe(49)
    })

    it('applies -1 for modifying tool args', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.applyOutcome('a', 'human_modifies_tool_args')
      expect(engine.getScore('a')).toBe(49)
    })

    it('applies -2 for rejecting tool call', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.applyOutcome('a', 'human_rejects_tool_call')
      expect(engine.getScore('a')).toBe(48)
    })

    it('applies -3 for overriding agent decision', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.applyOutcome('a', 'human_overrides_agent_decision')
      expect(engine.getScore('a')).toBe(47)
    })

    it('applies +3 for clean task completion', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.applyOutcome('a', 'task_completed_clean')
      expect(engine.getScore('a')).toBe(53)
    })

    it('applies +1 for partial completion', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.applyOutcome('a', 'task_completed_partial')
      expect(engine.getScore('a')).toBe(51)
    })

    it('applies -1 for abandoned or max_turns', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.applyOutcome('a', 'task_abandoned_or_max_turns')
      expect(engine.getScore('a')).toBe(49)
    })

    it('applies -2 for error event', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.applyOutcome('a', 'error_event')
      expect(engine.getScore('a')).toBe(48)
    })
  })

  describe('score clamping', () => {
    it('clamps to ceiling at 100', () => {
      const engine = new TrustEngine({ initialScore: 99 })
      engine.registerAgent('a')
      engine.applyOutcome('a', 'task_completed_clean') // +3 but clamped
      expect(engine.getScore('a')).toBe(100)
    })

    it('clamps to floor at 10', () => {
      const engine = new TrustEngine({ initialScore: 11 })
      engine.registerAgent('a')
      engine.applyOutcome('a', 'human_overrides_agent_decision') // -3 but clamped
      expect(engine.getScore('a')).toBe(10)
    })

    it('never goes below floor even with multiple negatives', () => {
      const engine = new TrustEngine({ initialScore: 15 })
      engine.registerAgent('a')
      for (let i = 0; i < 10; i++) {
        engine.applyOutcome('a', 'human_rejects_tool_call')
      }
      expect(engine.getScore('a')).toBe(10)
    })
  })

  describe('diminishing returns', () => {
    it('halves positive deltas when score > 90', () => {
      const engine = new TrustEngine({ initialScore: 91 })
      engine.registerAgent('a')
      // +3 should become +1 (floor(3/2)=1) due to diminishing returns
      engine.applyOutcome('a', 'task_completed_clean')
      expect(engine.getScore('a')).toBe(92)
    })

    it('halves negative deltas when score < 20', () => {
      const engine = new TrustEngine({ initialScore: 19 })
      engine.registerAgent('a')
      // -2 should become -1 (ceil(-2/2)=-1) due to diminishing returns
      engine.applyOutcome('a', 'human_rejects_tool_call')
      expect(engine.getScore('a')).toBe(18)
    })

    it('does not apply diminishing returns at score exactly 90', () => {
      const engine = new TrustEngine({ initialScore: 90 })
      engine.registerAgent('a')
      // at exactly 90, not > 90, so no diminishing returns
      engine.applyOutcome('a', 'task_completed_clean')
      expect(engine.getScore('a')).toBe(93)
    })

    it('does not apply diminishing returns at score exactly 20', () => {
      const engine = new TrustEngine({ initialScore: 20 })
      engine.registerAgent('a')
      // at exactly 20, not < 20, so no diminishing returns
      engine.applyOutcome('a', 'human_rejects_tool_call')
      expect(engine.getScore('a')).toBe(18)
    })

    it('handles +1 delta with diminishing returns (halved to 0)', () => {
      const engine = new TrustEngine({ initialScore: 95 })
      engine.registerAgent('a')
      // +1 halved = floor(0.5) = 0
      engine.applyOutcome('a', 'human_approves_tool_call')
      expect(engine.getScore('a')).toBe(95)
    })

    it('handles -1 delta with diminishing returns at low end (halved to 0)', () => {
      const engine = new TrustEngine({ initialScore: 15 })
      engine.registerAgent('a')
      // -1 halved = ceil(-0.5) = 0
      engine.applyOutcome('a', 'human_picks_non_recommended')
      expect(engine.getScore('a')).toBe(15)
    })
  })

  describe('delta table overrides', () => {
    it('uses custom delta from config when provided', () => {
      const engine = new TrustEngine({
        deltaTable: { human_approves_recommended_option: 5 }
      })
      engine.registerAgent('a')
      engine.applyOutcome('a', 'human_approves_recommended_option')
      expect(engine.getScore('a')).toBe(55)
    })

    it('falls back to default delta for non-overridden outcomes', () => {
      const engine = new TrustEngine({
        deltaTable: { human_approves_recommended_option: 5 }
      })
      engine.registerAgent('a')
      engine.applyOutcome('a', 'human_approves_tool_call')
      expect(engine.getScore('a')).toBe(51) // default +1
    })
  })

  describe('decay toward baseline', () => {
    it('decays agent above baseline toward baseline via tick subscription', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({
        initialScore: 60,
        decayRatePerTick: 1 // 1 point per 1 tick for fast testing
      })

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      tickService.advance(1)
      expect(engine.getScore('a')).toBe(59)

      tickService.advance(1)
      expect(engine.getScore('a')).toBe(58)

      engine.unsubscribeFrom(tickService)
    })

    it('decays agent below baseline upward toward baseline', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({
        initialScore: 40,
        decayRatePerTick: 1
      })

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      tickService.advance(1)
      expect(engine.getScore('a')).toBe(41)

      engine.unsubscribeFrom(tickService)
    })

    it('does not decay beyond baseline', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({
        initialScore: 51,
        decayRatePerTick: 1
      })

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      // One tick: 51 -> 50
      tickService.advance(1)
      expect(engine.getScore('a')).toBe(50)

      // Second tick: at baseline, no change
      tickService.advance(1)
      expect(engine.getScore('a')).toBe(50)

      engine.unsubscribeFrom(tickService)
    })

    it('accumulates fractional decay with default rate (0.01)', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({ initialScore: 60 })
      // default decayRatePerTick = 0.01 -> 1 point per 100 ticks

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      // After 99 ticks, no decay yet (accumulator at 0.99)
      tickService.advance(99)
      expect(engine.getScore('a')).toBe(60)

      // At tick 100, accumulator hits 1.0 -> decay fires
      tickService.advance(1)
      expect(engine.getScore('a')).toBe(59)

      engine.unsubscribeFrom(tickService)
    })

    it('resets decay accumulator on activity', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({
        initialScore: 60,
        decayRatePerTick: 0.5 // 1 point per 2 ticks
      })

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      // 1 tick: accumulator at 0.5
      tickService.advance(1)
      expect(engine.getScore('a')).toBe(60)

      // Activity at tick 2 resets accumulator
      engine.applyOutcome('a', 'human_approves_tool_call', 2)
      expect(engine.getScore('a')).toBe(61)

      // Now 1 more tick: accumulator restarts from 0
      tickService.advance(1)
      expect(engine.getScore('a')).toBe(61) // not decaying yet

      engine.unsubscribeFrom(tickService)
    })
  })

  describe('calibration mode', () => {
    it('logs proposed deltas without mutating scores', () => {
      const engine = new TrustEngine({ calibrationMode: true })
      engine.registerAgent('a')

      engine.applyOutcome('a', 'task_completed_clean')
      expect(engine.getScore('a')).toBe(50) // unchanged

      const log = engine.getCalibrationLog()
      expect(log).toHaveLength(1)
      expect(log[0].agentId).toBe('a')
      expect(log[0].outcome).toBe('task_completed_clean')
      expect(log[0].baseDelta).toBe(3)
      expect(log[0].effectiveDelta).toBe(3)
      expect(log[0].wouldBeScore).toBe(53)
      expect(log[0].currentScore).toBe(50)
    })

    it('still returns effective delta in calibration mode', () => {
      const engine = new TrustEngine({ calibrationMode: true })
      engine.registerAgent('a')

      const delta = engine.applyOutcome('a', 'task_completed_clean')
      expect(delta).toBe(3)
    })

    it('accumulates multiple log entries', () => {
      const engine = new TrustEngine({ calibrationMode: true })
      engine.registerAgent('a')
      engine.registerAgent('b')

      engine.applyOutcome('a', 'task_completed_clean')
      engine.applyOutcome('b', 'human_rejects_tool_call')

      expect(engine.getCalibrationLog()).toHaveLength(2)
    })

    it('clears calibration log', () => {
      const engine = new TrustEngine({ calibrationMode: true })
      engine.registerAgent('a')
      engine.applyOutcome('a', 'task_completed_clean')
      engine.clearCalibrationLog()
      expect(engine.getCalibrationLog()).toHaveLength(0)
    })
  })

  describe('getAllScores', () => {
    it('returns all registered agent scores', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')
      engine.registerAgent('b')
      engine.applyOutcome('a', 'task_completed_clean')

      const scores = engine.getAllScores()
      expect(scores).toHaveLength(2)

      const aScore = scores.find((s) => s.agentId === 'a')
      const bScore = scores.find((s) => s.agentId === 'b')

      expect(aScore?.score).toBe(53)
      expect(bScore?.score).toBe(50)
    })
  })

  describe('edge cases', () => {
    it('returns 0 delta for unregistered agent', () => {
      const engine = new TrustEngine()
      const delta = engine.applyOutcome('unknown', 'task_completed_clean')
      expect(delta).toBe(0)
    })

    it('handles rapid consecutive deltas correctly', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')

      // 50 + 3 + 3 + 3 + 3 = 62
      engine.applyOutcome('a', 'task_completed_clean')
      engine.applyOutcome('a', 'task_completed_clean')
      engine.applyOutcome('a', 'task_completed_clean')
      engine.applyOutcome('a', 'task_completed_clean')
      expect(engine.getScore('a')).toBe(62)
    })

    it('correctly transitions through diminishing return boundary', () => {
      const engine = new TrustEngine({ initialScore: 89 })
      engine.registerAgent('a')

      // At 89, no diminishing returns: +3 -> 92
      engine.applyOutcome('a', 'task_completed_clean')
      expect(engine.getScore('a')).toBe(92)

      // At 92 (>90), diminishing returns: +3 halved to +1 -> 93
      engine.applyOutcome('a', 'task_completed_clean')
      expect(engine.getScore('a')).toBe(93)
    })
  })
})
