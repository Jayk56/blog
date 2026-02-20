import { describe, expect, it } from 'vitest'

import { TickService } from '../../src/tick'
import { TrustEngine } from '../../src/intelligence/trust-engine'

describe('Trust Hardening', () => {
  describe('decay ceiling', () => {
    it('idle agent decays past decayTargetScore down to ceiling', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({
        initialScore: 55,
        decayTargetScore: 50,
        decayCeiling: 45,
        inactivityThresholdTicks: 2,
        decayRatePerTick: 1
      })

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      // ticks 1-2: idle=1,2 (not > 2), effectiveTarget=50, normal decay
      tickService.advance(2)
      expect(engine.getScore('a')).toBe(53) // 55 - 2

      // tick 3: idle=3 > 2, effectiveTarget=min(50,45)=45, score 53>45 -> 52
      tickService.advance(1)
      expect(engine.getScore('a')).toBe(52)

      // Continue decaying toward 45: 7 more ticks -> 52,51,50,49,48,47,46,45
      tickService.advance(7)
      expect(engine.getScore('a')).toBe(45)

      // At ceiling, stops decaying (45 == effectiveTarget, no movement)
      tickService.advance(5)
      expect(engine.getScore('a')).toBe(45)

      engine.unsubscribeFrom(tickService)
    })

    it('active agent not affected by ceiling', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({
        initialScore: 70,
        decayTargetScore: 50,
        decayCeiling: 30,
        inactivityThresholdTicks: 5,
        decayRatePerTick: 1
      })

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      // 4 ticks idle, normal decay (idle 1-4, none > 5)
      tickService.advance(4)
      expect(engine.getScore('a')).toBe(66) // 70 - 4

      // Agent activity at tick 5 resets idle counter
      engine.applyOutcome('a', 'human_approves_tool_call', 5) // +1 -> 67
      expect(engine.getScore('a')).toBe(67)

      // advance(5) fires ticks 5-9.
      // tick 5: lastActivity=5, not inactive (5 < 5 is false). No decay.
      // tick 6: idle=1, tick 7: idle=2, tick 8: idle=3, tick 9: idle=4
      // All idle < 5, so effectiveTarget=50, normal decay: 67 -> 66 -> 65 -> 64
      tickService.advance(5)
      expect(engine.getScore('a')).toBe(63) // 67 - 4 (tick 5 is not inactive)

      // Score stays above ceiling (30) because agent was recently active
      expect(engine.getScore('a')!).toBeGreaterThan(30)

      engine.unsubscribeFrom(tickService)
    })

    it('default decayCeiling (50) is no-op with default decayTargetScore (50)', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({
        initialScore: 60,
        decayRatePerTick: 1
        // defaults: decayTargetScore=50, decayCeiling=50, inactivityThresholdTicks=0
      })

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      // effectiveTarget = min(50,50) = 50. Same as normal decay.
      tickService.advance(1)
      expect(engine.getScore('a')).toBe(59)

      tickService.advance(9)
      expect(engine.getScore('a')).toBe(50)

      // Stays at 50
      tickService.advance(5)
      expect(engine.getScore('a')).toBe(50)

      engine.unsubscribeFrom(tickService)
    })

    it('ceiling < decayTarget causes deeper decay for idle agents', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({
        initialScore: 52,
        decayTargetScore: 50,
        decayCeiling: 40,
        inactivityThresholdTicks: 0,
        decayRatePerTick: 1
      })

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      // With inactivityThresholdTicks=0, ceiling active on first tick (idle=1 > 0)
      // effectiveTarget = min(50, 40) = 40
      // 12 ticks: 52 -> 51 -> ... -> 40
      tickService.advance(12)
      expect(engine.getScore('a')).toBe(40)

      // At ceiling, stops
      tickService.advance(5)
      expect(engine.getScore('a')).toBe(40)

      engine.unsubscribeFrom(tickService)
    })

    it('ceiling respects floor score', () => {
      const tickService = new TickService({ mode: 'manual' })
      const engine = new TrustEngine({
        initialScore: 15,
        floorScore: 10,
        decayTargetScore: 50,
        decayCeiling: 5,        // below floor
        inactivityThresholdTicks: 0,
        decayRatePerTick: 1
      })

      engine.subscribeTo(tickService)
      engine.registerAgent('a', 0)

      // effectiveTarget = max(floor=10, min(target=50, ceiling=5)) = max(10, 5) = 10
      // Score 15 > effectiveTarget 10: decays down to 10
      tickService.advance(5)
      expect(engine.getScore('a')).toBe(10)

      // Stops at floor, doesn't go below
      tickService.advance(5)
      expect(engine.getScore('a')).toBe(10)

      engine.unsubscribeFrom(tickService)
    })
  })

  describe('risk-weighted deltas', () => {
    it('trivial blast radius halves positive delta', () => {
      const engine = new TrustEngine({ riskWeightingEnabled: true })
      engine.registerAgent('a')

      // task_completed_clean = +3, trivial weight = 0.5 -> floor(3*0.5) = 1
      const delta = engine.applyOutcome('a', 'task_completed_clean', 0, {
        blastRadius: 'trivial'
      })
      expect(delta).toBe(1)
      expect(engine.getScore('a')).toBe(51)
    })

    it('large blast radius amplifies positive delta', () => {
      const engine = new TrustEngine({ riskWeightingEnabled: true })
      engine.registerAgent('a')

      // human_approves_recommended_option = +2, large weight = 1.5 -> floor(2*1.5) = 3
      const delta = engine.applyOutcome('a', 'human_approves_recommended_option', 0, {
        blastRadius: 'large'
      })
      expect(delta).toBe(3)
      expect(engine.getScore('a')).toBe(53)
    })

    it('negative delta not reduced by risk weighting (trust loss always full)', () => {
      const engine = new TrustEngine({ riskWeightingEnabled: true })
      engine.registerAgent('a')

      // human_rejects_tool_call = -2, trivial weight = 0.5
      // but negative deltas pass through unchanged
      const delta = engine.applyOutcome('a', 'human_rejects_tool_call', 0, {
        blastRadius: 'trivial'
      })
      expect(delta).toBe(-2)
      expect(engine.getScore('a')).toBe(48)
    })

    it('disabled by default — no change to existing behavior', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')

      // Even with blastRadius provided, risk weighting should not apply
      const delta = engine.applyOutcome('a', 'task_completed_clean', 0, {
        blastRadius: 'trivial'
      })
      expect(delta).toBe(3)
      expect(engine.getScore('a')).toBe(53)
    })

    it('unknown blast radius uses 1.0 (neutral)', () => {
      const engine = new TrustEngine({ riskWeightingEnabled: true })
      engine.registerAgent('a')

      const delta = engine.applyOutcome('a', 'task_completed_clean', 0, {
        blastRadius: 'unknown'
      })
      expect(delta).toBe(3)
      expect(engine.getScore('a')).toBe(53)
    })

    it('small blast radius applies 0.75 multiplier', () => {
      const engine = new TrustEngine({ riskWeightingEnabled: true })
      engine.registerAgent('a')

      // human_approves_always = +3, small weight = 0.75 -> floor(3*0.75) = 2
      const delta = engine.applyOutcome('a', 'human_approves_always', 0, {
        blastRadius: 'small'
      })
      expect(delta).toBe(2)
      expect(engine.getScore('a')).toBe(52)
    })

    it('medium blast radius is neutral (1.0)', () => {
      const engine = new TrustEngine({ riskWeightingEnabled: true })
      engine.registerAgent('a')

      const delta = engine.applyOutcome('a', 'task_completed_clean', 0, {
        blastRadius: 'medium'
      })
      expect(delta).toBe(3)
      expect(engine.getScore('a')).toBe(53)
    })

    it('no blastRadius in context skips risk weighting even when enabled', () => {
      const engine = new TrustEngine({ riskWeightingEnabled: true })
      engine.registerAgent('a')

      const delta = engine.applyOutcome('a', 'task_completed_clean', 0, {
        artifactKinds: ['code']
      })
      expect(delta).toBe(3)
      expect(engine.getScore('a')).toBe(53)
    })
  })

  describe('backward compatibility', () => {
    it('default config has new fields with backward-compatible values', () => {
      const engine = new TrustEngine()
      const config = engine.getConfig()

      expect(config.decayCeiling).toBe(50)
      expect(config.inactivityThresholdTicks).toBe(0)
      expect(config.riskWeightingEnabled).toBe(false)
      expect(config.riskWeightMap).toEqual({
        trivial: 0.5,
        small: 0.75,
        medium: 1.0,
        large: 1.5,
        unknown: 1.0
      })
    })

    it('existing trust operations unchanged with defaults', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a')

      engine.applyOutcome('a', 'task_completed_clean')
      expect(engine.getScore('a')).toBe(53)

      engine.applyOutcome('a', 'human_rejects_tool_call')
      expect(engine.getScore('a')).toBe(51)

      engine.applyOutcome('a', 'human_approves_recommended_option')
      expect(engine.getScore('a')).toBe(53)
    })
  })
})
