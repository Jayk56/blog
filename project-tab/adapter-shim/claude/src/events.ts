/**
 * Event factory for generating AdapterEvent envelopes with sequencing.
 */

import { v4 as uuidv4 } from 'uuid'
import type { AdapterEvent, AgentEvent } from './models.js'

export class EventFactory {
  private _runId: string
  private _sequence: number = 0

  constructor(runId: string) {
    this._runId = runId
  }

  get runId(): string {
    return this._runId
  }

  get lastSequence(): number {
    return this._sequence
  }

  /** Wrap an AgentEvent payload in an AdapterEvent envelope. */
  wrap(event: AgentEvent): AdapterEvent {
    this._sequence += 1
    return {
      sourceEventId: uuidv4(),
      sourceSequence: this._sequence,
      sourceOccurredAt: new Date().toISOString(),
      runId: this._runId,
      event,
    }
  }
}
