import { afterEach, describe, expect, it, vi } from 'vitest'

import { TickService } from '../src/tick'

afterEach(() => {
  vi.useRealTimers()
})

describe('TickService', () => {
  it('ticks on wall clock interval and invokes subscribers', async () => {
    vi.useFakeTimers()
    const service = new TickService({ mode: 'wall_clock', intervalMs: 100 })
    const seen: number[] = []

    service.onTick((tick) => {
      seen.push(tick)
    })

    service.start()
    await vi.advanceTimersByTimeAsync(350)

    expect(service.currentTick()).toBe(3)
    expect(seen).toEqual([1, 2, 3])

    service.stop()
  })

  it('advances only when explicitly requested in manual mode', () => {
    const service = new TickService({ mode: 'manual' })
    const seen: number[] = []

    service.onTick((tick) => {
      seen.push(tick)
    })

    service.start()
    expect(service.currentTick()).toBe(0)

    expect(service.advance()).toBe(1)
    expect(service.advance(2)).toBe(3)
    expect(seen).toEqual([1, 2, 3])

    service.stop()
  })

  it('supports start/stop lifecycle and keeps monotonic counter', async () => {
    vi.useFakeTimers()
    const service = new TickService({ mode: 'wall_clock', intervalMs: 50 })

    service.start()
    await vi.advanceTimersByTimeAsync(120)
    service.stop()

    const stoppedAt = service.currentTick()
    await vi.advanceTimersByTimeAsync(200)
    expect(service.currentTick()).toBe(stoppedAt)

    service.start()
    await vi.advanceTimersByTimeAsync(60)
    expect(service.currentTick()).toBeGreaterThan(stoppedAt)

    const afterRestart = service.currentTick()
    expect(afterRestart).toBeGreaterThan(0)

    service.stop()
  })

  it('throws if advance is called in wall clock mode', () => {
    const service = new TickService({ mode: 'wall_clock', intervalMs: 1000 })
    expect(() => service.advance()).toThrow('only available in manual mode')
  })
})
