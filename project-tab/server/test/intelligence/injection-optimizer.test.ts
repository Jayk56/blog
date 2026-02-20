import { describe, expect, it, vi, beforeEach } from 'vitest'

import { InjectionOptimizer, type InjectionEfficiencyReport } from '../../src/intelligence/injection-optimizer'
import type { InjectionRecord } from '../../src/intelligence/context-injection-service'

function makeRecord(overrides: Partial<InjectionRecord> = {}): InjectionRecord {
  return {
    tick: 10,
    reason: 'periodic',
    priority: 'recommended',
    snapshotVersion: 1,
    artifactIdsIncluded: ['a1', 'a2', 'a3'],
    agentEventsInWindow: 5,
    artifactIdsReferencedInWindow: ['a1', 'a2'],
    ...overrides,
  }
}

describe('InjectionOptimizer', () => {
  const optimizer = new InjectionOptimizer()

  // ── 1. Empty records ──────────────────────────────────────────────

  it('returns zero report for empty records', () => {
    const report = optimizer.analyzeEfficiency([])

    expect(report.totalInjections).toBe(0)
    expect(report.avgArtifactsIncluded).toBe(0)
    expect(report.avgArtifactsReferenced).toBe(0)
    expect(report.overlapRate).toBe(0)
    expect(report.unusedArtifactRate).toBe(0)
    expect(report.perReasonBreakdown).toEqual({})
    expect(report.perModeRecommendations).toEqual([])
    expect(report.analysisWindow).toEqual({ firstTick: 0, lastTick: 0 })
  })

  // ── 2. Perfect overlap ────────────────────────────────────────────

  it('computes overlapRate=1.0 when all included artifacts are referenced', () => {
    const records = [
      makeRecord({
        artifactIdsIncluded: ['a1', 'a2', 'a3'],
        artifactIdsReferencedInWindow: ['a1', 'a2', 'a3'],
      }),
      makeRecord({
        tick: 20,
        artifactIdsIncluded: ['b1', 'b2'],
        artifactIdsReferencedInWindow: ['b1', 'b2'],
      }),
    ]

    const report = optimizer.analyzeEfficiency(records)

    expect(report.overlapRate).toBe(1.0)
    expect(report.unusedArtifactRate).toBe(0)
  })

  // ── 3. Zero overlap ──────────────────────────────────────────────

  it('computes overlapRate=0.0 when no included artifacts are referenced', () => {
    const records = [
      makeRecord({
        artifactIdsIncluded: ['a1', 'a2', 'a3'],
        artifactIdsReferencedInWindow: ['x1', 'x2'],
      }),
    ]

    const report = optimizer.analyzeEfficiency(records)

    expect(report.overlapRate).toBe(0)
    expect(report.unusedArtifactRate).toBe(1.0)
  })

  // ── 4. Mixed overlap ─────────────────────────────────────────────

  it('computes mixed overlap correctly', () => {
    const records = [
      // 2 of 4 included are referenced → 0.5
      makeRecord({
        tick: 5,
        artifactIdsIncluded: ['a1', 'a2', 'a3', 'a4'],
        artifactIdsReferencedInWindow: ['a1', 'a3'],
      }),
      // 1 of 2 included are referenced → 0.5
      makeRecord({
        tick: 15,
        artifactIdsIncluded: ['b1', 'b2'],
        artifactIdsReferencedInWindow: ['b2', 'x1'],
      }),
    ]

    const report = optimizer.analyzeEfficiency(records)

    // avg(0.5, 0.5) = 0.5
    expect(report.overlapRate).toBe(0.5)
    expect(report.unusedArtifactRate).toBe(0.5)
    expect(report.totalInjections).toBe(2)
    expect(report.avgArtifactsIncluded).toBe(3) // (4+2)/2
    expect(report.avgArtifactsReferenced).toBe(2) // (2+2)/2
  })

  // ── 5. Per-reason breakdown ───────────────────────────────────────

  it('aggregates per-reason breakdown correctly', () => {
    const records = [
      // periodic, full overlap
      makeRecord({
        tick: 1,
        reason: 'periodic',
        artifactIdsIncluded: ['a1'],
        artifactIdsReferencedInWindow: ['a1'],
      }),
      // periodic, zero overlap
      makeRecord({
        tick: 2,
        reason: 'periodic',
        artifactIdsIncluded: ['a1'],
        artifactIdsReferencedInWindow: [],
      }),
      // reactive, full overlap
      makeRecord({
        tick: 3,
        reason: 'reactive',
        artifactIdsIncluded: ['b1', 'b2'],
        artifactIdsReferencedInWindow: ['b1', 'b2'],
      }),
      // staleness, half overlap
      makeRecord({
        tick: 4,
        reason: 'staleness',
        artifactIdsIncluded: ['c1', 'c2'],
        artifactIdsReferencedInWindow: ['c1'],
      }),
    ]

    const report = optimizer.analyzeEfficiency(records)

    expect(report.perReasonBreakdown['periodic']).toEqual({
      count: 2,
      avgOverlapRate: 0.5, // (1.0 + 0.0) / 2
    })
    expect(report.perReasonBreakdown['reactive']).toEqual({
      count: 1,
      avgOverlapRate: 1.0,
    })
    expect(report.perReasonBreakdown['staleness']).toEqual({
      count: 1,
      avgOverlapRate: 0.5,
    })
  })

  // ── 6. Analysis window ────────────────────────────────────────────

  it('computes analysis window from first and last tick', () => {
    const records = [
      makeRecord({ tick: 5 }),
      makeRecord({ tick: 42 }),
      makeRecord({ tick: 17 }),
    ]

    const report = optimizer.analyzeEfficiency(records)

    expect(report.analysisWindow).toEqual({ firstTick: 5, lastTick: 42 })
  })

  // ── 7. Mode recommendations ──────────────────────────────────────

  it('generates per-mode recommendations for all three modes', () => {
    const records = [
      makeRecord({
        artifactIdsIncluded: ['a1'],
        artifactIdsReferencedInWindow: ['a1'],
      }),
    ]

    const report = optimizer.analyzeEfficiency(records)

    expect(report.perModeRecommendations).toHaveLength(3)
    const modes = report.perModeRecommendations.map((r) => r.mode)
    expect(modes).toContain('orchestrator')
    expect(modes).toContain('adaptive')
    expect(modes).toContain('ecosystem')
  })

  // ── 8. suggestInterval: high overlap decreases ────────────────────

  it('decreases interval for high overlap (>80%)', () => {
    const suggested = optimizer.suggestInterval(20, 0.9)
    expect(suggested).toBe(14) // round(20 * 0.7) = 14
    expect(suggested).toBeLessThan(20)
  })

  // ── 9. suggestInterval: low overlap increases ─────────────────────

  it('increases interval for low overlap (<30%)', () => {
    const suggested = optimizer.suggestInterval(20, 0.1)
    expect(suggested).toBe(30) // round(20 * 1.5) = 30
    expect(suggested).toBeGreaterThan(20)
  })

  // ── 10. suggestInterval clamps to [5, 100] ───────────────────────

  it('clamps suggested interval to [5, 100]', () => {
    // Very small interval with high overlap → can't go below 5
    expect(optimizer.suggestInterval(5, 0.95)).toBe(5) // round(5 * 0.7) = 4 → clamped to 5

    // Very large interval with low overlap → can't exceed 100
    expect(optimizer.suggestInterval(80, 0.1)).toBe(100) // round(80 * 1.5) = 120 → clamped to 100
  })

  // ── 11. Empty included artifacts → overlap = 0 ───────────────────

  it('handles records with no included artifacts gracefully', () => {
    const records = [
      makeRecord({
        artifactIdsIncluded: [],
        artifactIdsReferencedInWindow: ['a1'],
      }),
    ]

    const report = optimizer.analyzeEfficiency(records)

    // 0 included → overlap is 0 (nothing was injected to evaluate)
    expect(report.overlapRate).toBe(0)
    expect(report.unusedArtifactRate).toBe(1)
  })
})
