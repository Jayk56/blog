import type { ZodError } from 'zod'
import type { AdapterEvent } from '../types'
import { validateAdapterEvent } from './schemas'

/** Stored malformed event entry for debugging and triage. */
export interface QuarantinedEvent {
  quarantinedAt: string
  raw: unknown
  error: ZodError
}

const quarantined: QuarantinedEvent[] = []

/** Stores a malformed event payload and corresponding validation error. */
export function quarantineEvent(raw: unknown, error: ZodError): QuarantinedEvent {
  const item: QuarantinedEvent = {
    quarantinedAt: new Date().toISOString(),
    raw,
    error
  }
  quarantined.push(item)
  return item
}

/** Returns all quarantined malformed events. */
export function getQuarantined(): QuarantinedEvent[] {
  return [...quarantined]
}

/** Clears the in-memory quarantine list. */
export function clearQuarantine(): void {
  quarantined.length = 0
}

/**
 * Validates a raw payload and quarantines it when malformed.
 */
export function validateOrQuarantine(raw: unknown): AdapterEvent | null {
  const result = validateAdapterEvent(raw)
  if (result.ok) {
    return result.event
  }

  quarantineEvent(result.raw, result.error)
  // eslint-disable-next-line no-console
  console.error('[quarantine] adapter event validation failed', result.error.issues)
  return null
}
