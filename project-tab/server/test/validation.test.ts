import { beforeEach, describe, expect, it } from 'vitest'

import { clearQuarantine, getQuarantined, quarantineEvent } from '../src/validation/quarantine'
import { validateAdapterEvent } from '../src/validation/schemas'

describe('validation', () => {
  beforeEach(() => {
    clearQuarantine()
  })

  it('accepts valid adapter events', () => {
    const input = {
      sourceEventId: 'evt-1',
      sourceSequence: 1,
      sourceOccurredAt: '2026-02-10T00:00:00.000Z',
      runId: 'run-1',
      event: {
        type: 'status',
        agentId: 'agent-a',
        message: 'working'
      }
    }

    const result = validateAdapterEvent(input)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.event.event.type).toBe('status')
    }
  })

  it('rejects malformed adapter events with descriptive errors', () => {
    const malformed = {
      sourceEventId: 'evt-2',
      sourceSequence: 2,
      sourceOccurredAt: 'not-a-date',
      event: {
        type: 'status',
        message: 'missing agent'
      }
    }

    const result = validateAdapterEvent(malformed)
    expect(result.ok).toBe(false)

    if (!result.ok) {
      const text = result.error.issues.map((issue) => issue.message).join(' | ')
      expect(text.length).toBeGreaterThan(0)
      expect(text.toLowerCase()).toContain('datetime')
    }
  })

  it('stores malformed events in quarantine', () => {
    const malformed = {
      sourceEventId: 'evt-3',
      sourceSequence: 3,
      sourceOccurredAt: '2026-02-10T00:00:00.000Z',
      runId: 'run-1',
      event: {
        type: 'status',
        message: 'missing agentId'
      }
    }

    const result = validateAdapterEvent(malformed)
    expect(result.ok).toBe(false)

    if (!result.ok) {
      quarantineEvent(result.raw, result.error)
    }

    const quarantined = getQuarantined()
    expect(quarantined).toHaveLength(1)
    expect(quarantined[0]?.quarantinedAt).toBeTypeOf('string')
  })
})
