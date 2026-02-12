import { describe, expect, it } from 'vitest'

import { TickService } from '../../src/tick'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import type { OptionDecisionEvent, ToolApprovalEvent } from '../../src/types/events'
import type { Resolution, OptionDecisionResolution, ToolApprovalResolution } from '../../src/types/resolution'

function makeOptionDecision(overrides: Partial<OptionDecisionEvent> = {}): OptionDecisionEvent {
  return {
    type: 'decision',
    subtype: 'option',
    agentId: 'agent-1',
    decisionId: `dec-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Choose architecture',
    summary: 'Pick between monolith and microservices',
    severity: 'medium',
    confidence: 0.7,
    blastRadius: 'medium',
    options: [
      { id: 'opt-1', label: 'Monolith', description: 'Single service' },
      { id: 'opt-2', label: 'Microservices', description: 'Distributed' }
    ],
    recommendedOptionId: 'opt-1',
    affectedArtifactIds: ['art-1'],
    requiresRationale: true,
    ...overrides
  }
}

function makeToolApproval(overrides: Partial<ToolApprovalEvent> = {}): ToolApprovalEvent {
  return {
    type: 'decision',
    subtype: 'tool_approval',
    agentId: 'agent-1',
    decisionId: `dec-${Math.random().toString(36).slice(2, 8)}`,
    toolName: 'bash',
    toolArgs: { command: 'rm -rf /' },
    severity: 'critical',
    ...overrides
  }
}

describe('DecisionQueue', () => {
  describe('enqueue and retrieval', () => {
    it('enqueues an option decision', () => {
      const queue = new DecisionQueue()
      const event = makeOptionDecision({ decisionId: 'dec-1' })

      const id = queue.enqueue(event, 0)
      expect(id).toBe('dec-1')

      const entry = queue.get('dec-1')
      expect(entry).toBeDefined()
      expect(entry!.status).toBe('pending')
      expect(entry!.event).toBe(event)
      expect(entry!.enqueuedAtTick).toBe(0)
    })

    it('enqueues a tool approval decision', () => {
      const queue = new DecisionQueue()
      const event = makeToolApproval({ decisionId: 'dec-2' })

      queue.enqueue(event, 5)
      const entry = queue.get('dec-2')
      expect(entry).toBeDefined()
      expect(entry!.status).toBe('pending')
      expect(entry!.enqueuedAtTick).toBe(5)
    })

    it('ignores duplicate enqueue for same decisionId', () => {
      const queue = new DecisionQueue()
      const event = makeOptionDecision({ decisionId: 'dec-1' })

      queue.enqueue(event, 0)
      queue.enqueue(event, 10) // should be no-op

      const all = queue.listAll()
      expect(all).toHaveLength(1)
      expect(all[0].enqueuedAtTick).toBe(0) // original preserved
    })
  })

  describe('resolution', () => {
    it('resolves an option decision', () => {
      const queue = new DecisionQueue()
      const event = makeOptionDecision({ decisionId: 'dec-1' })
      queue.enqueue(event, 0)

      const resolution: OptionDecisionResolution = {
        type: 'option',
        chosenOptionId: 'opt-1',
        rationale: 'Simpler architecture',
        actionKind: 'review'
      }

      const result = queue.resolve('dec-1', resolution)
      expect(result).toBeDefined()
      expect(result!.status).toBe('resolved')
      expect(result!.resolution).toBe(resolution)
      expect(result!.resolvedAt).toBeDefined()
    })

    it('resolves a tool approval decision', () => {
      const queue = new DecisionQueue()
      const event = makeToolApproval({ decisionId: 'dec-2' })
      queue.enqueue(event, 0)

      const resolution: ToolApprovalResolution = {
        type: 'tool_approval',
        action: 'reject',
        rationale: 'Too dangerous',
        actionKind: 'review'
      }

      const result = queue.resolve('dec-2', resolution)
      expect(result).toBeDefined()
      expect(result!.status).toBe('resolved')
    })

    it('returns undefined when resolving non-existent decision', () => {
      const queue = new DecisionQueue()
      const resolution: OptionDecisionResolution = {
        type: 'option',
        chosenOptionId: 'opt-1',
        rationale: 'test',
        actionKind: 'review'
      }

      expect(queue.resolve('nonexistent', resolution)).toBeUndefined()
    })

    it('returns undefined when resolving already-resolved decision', () => {
      const queue = new DecisionQueue()
      const event = makeOptionDecision({ decisionId: 'dec-1' })
      queue.enqueue(event, 0)

      const resolution: OptionDecisionResolution = {
        type: 'option',
        chosenOptionId: 'opt-1',
        rationale: 'test',
        actionKind: 'review'
      }

      queue.resolve('dec-1', resolution) // first resolve
      expect(queue.resolve('dec-1', resolution)).toBeUndefined() // second is no-op
    })
  })

  describe('waitForResolution', () => {
    it('resolves promise when decision is resolved', async () => {
      const queue = new DecisionQueue()
      const event = makeOptionDecision({ decisionId: 'dec-1' })
      queue.enqueue(event, 0)

      const promise = queue.waitForResolution('dec-1')

      const resolution: OptionDecisionResolution = {
        type: 'option',
        chosenOptionId: 'opt-2',
        rationale: 'Better approach',
        actionKind: 'update'
      }

      queue.resolve('dec-1', resolution)
      const result = await promise
      expect(result).toBe(resolution)
    })

    it('returns immediately if already resolved', async () => {
      const queue = new DecisionQueue()
      const event = makeOptionDecision({ decisionId: 'dec-1' })
      queue.enqueue(event, 0)

      const resolution: OptionDecisionResolution = {
        type: 'option',
        chosenOptionId: 'opt-1',
        rationale: 'test',
        actionKind: 'review'
      }

      queue.resolve('dec-1', resolution)
      const result = await queue.waitForResolution('dec-1')
      expect(result).toBe(resolution)
    })
  })

  describe('listing', () => {
    it('lists only pending decisions', () => {
      const queue = new DecisionQueue()
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1' }), 0)
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-2' }), 0)
      queue.enqueue(makeToolApproval({ decisionId: 'dec-3' }), 0)

      queue.resolve('dec-1', {
        type: 'option',
        chosenOptionId: 'opt-1',
        rationale: 'test',
        actionKind: 'review'
      })

      const pending = queue.listPending()
      expect(pending).toHaveLength(2)
      expect(pending.map((d) => d.event.decisionId).sort()).toEqual(['dec-2', 'dec-3'])
    })

    it('filters pending decisions by agentId', () => {
      const queue = new DecisionQueue()
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-2', agentId: 'b' }), 0)

      const pending = queue.listPending('a')
      expect(pending).toHaveLength(1)
      expect(pending[0].event.decisionId).toBe('dec-1')
    })

    it('sorts pending decisions by priority descending', () => {
      const queue = new DecisionQueue()
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', severity: 'low' }), 0)
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-2', severity: 'critical' }), 0)
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-3', severity: 'medium' }), 0)

      const pending = queue.listPending()
      expect(pending[0].event.decisionId).toBe('dec-2') // critical = 50
      expect(pending[1].event.decisionId).toBe('dec-3') // medium = 30
      expect(pending[2].event.decisionId).toBe('dec-1') // low = 20
    })

    it('lists all decisions regardless of status', () => {
      const queue = new DecisionQueue()
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1' }), 0)
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-2' }), 0)

      queue.resolve('dec-1', {
        type: 'option',
        chosenOptionId: 'opt-1',
        rationale: 'test',
        actionKind: 'review'
      })

      expect(queue.listAll()).toHaveLength(2)
    })
  })

  describe('agent killed - orphaned decisions', () => {
    it('marks pending decisions as triage with agent killed badge', () => {
      const queue = new DecisionQueue()
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-2', agentId: 'a' }), 0)
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-3', agentId: 'b' }), 0) // different agent

      const orphaned = queue.handleAgentKilled('a')
      expect(orphaned).toHaveLength(2)
      expect(orphaned[0].status).toBe('triage')
      expect(orphaned[0].badge).toBe('agent killed')

      // Other agent's decision unaffected
      expect(queue.get('dec-3')!.status).toBe('pending')
    })

    it('elevates priority of orphaned decisions', () => {
      const queue = new DecisionQueue()
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a', severity: 'low' }), 0)

      const originalPriority = queue.get('dec-1')!.priority
      queue.handleAgentKilled('a')
      expect(queue.get('dec-1')!.priority).toBe(originalPriority + 100)
    })

    it('does not affect already-resolved decisions', () => {
      const queue = new DecisionQueue()
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)
      queue.resolve('dec-1', {
        type: 'option',
        chosenOptionId: 'opt-1',
        rationale: 'test',
        actionKind: 'review'
      })

      const orphaned = queue.handleAgentKilled('a')
      expect(orphaned).toHaveLength(0)
      expect(queue.get('dec-1')!.status).toBe('resolved')
    })
  })

  describe('suspend and resume', () => {
    it('suspends pending decisions for an agent', () => {
      const queue = new DecisionQueue()
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)

      const suspended = queue.suspendAgentDecisions('a')
      expect(suspended).toHaveLength(1)
      expect(queue.get('dec-1')!.status).toBe('suspended')
      expect(queue.get('dec-1')!.badge).toBe('source agent braked')
    })

    it('resumes suspended decisions', () => {
      const queue = new DecisionQueue()
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)

      queue.suspendAgentDecisions('a')
      const resumed = queue.resumeAgentDecisions('a')

      expect(resumed).toHaveLength(1)
      expect(queue.get('dec-1')!.status).toBe('pending')
      expect(queue.get('dec-1')!.badge).toBeUndefined()
    })
  })

  describe('timeout via tick service', () => {
    it('auto-recommends option decisions on timeout', () => {
      const tickService = new TickService({ mode: 'manual' })
      const queue = new DecisionQueue({ timeoutTicks: 10 })

      queue.subscribeTo(tickService)
      queue.enqueue(
        makeOptionDecision({
          decisionId: 'dec-1',
          recommendedOptionId: 'opt-1'
        }),
        0
      )

      // Advance to just before timeout
      tickService.advance(9)
      expect(queue.get('dec-1')!.status).toBe('pending')

      // Advance to timeout
      tickService.advance(1)
      expect(queue.get('dec-1')!.status).toBe('timed_out')
      expect(queue.get('dec-1')!.resolution).toBeDefined()

      const res = queue.get('dec-1')!.resolution as OptionDecisionResolution
      expect(res.type).toBe('option')
      expect(res.chosenOptionId).toBe('opt-1')
      expect(res.rationale).toContain('timeout')

      queue.unsubscribeFrom(tickService)
    })

    it('auto-approves tool approval decisions on timeout', () => {
      const tickService = new TickService({ mode: 'manual' })
      const queue = new DecisionQueue({ timeoutTicks: 5 })

      queue.subscribeTo(tickService)
      queue.enqueue(makeToolApproval({ decisionId: 'dec-1' }), 0)

      tickService.advance(5)

      const res = queue.get('dec-1')!.resolution as ToolApprovalResolution
      expect(res.type).toBe('tool_approval')
      expect(res.action).toBe('approve')

      queue.unsubscribeFrom(tickService)
    })

    it('respects dueByTick over policy timeout', () => {
      const tickService = new TickService({ mode: 'manual' })
      const queue = new DecisionQueue({ timeoutTicks: 100 })

      queue.subscribeTo(tickService)
      queue.enqueue(
        makeOptionDecision({
          decisionId: 'dec-1',
          dueByTick: 3
        }),
        0
      )

      tickService.advance(3)
      expect(queue.get('dec-1')!.status).toBe('timed_out')

      queue.unsubscribeFrom(tickService)
    })

    it('fires waitForResolution callback on timeout', async () => {
      const tickService = new TickService({ mode: 'manual' })
      const queue = new DecisionQueue({ timeoutTicks: 2 })

      queue.subscribeTo(tickService)
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1' }), 0)

      const promise = queue.waitForResolution('dec-1')
      tickService.advance(2)

      const result = await promise
      expect(result.type).toBe('option')

      queue.unsubscribeFrom(tickService)
    })

    it('does not time out with null timeoutTicks', () => {
      const tickService = new TickService({ mode: 'manual' })
      const queue = new DecisionQueue({ timeoutTicks: null })

      queue.subscribeTo(tickService)
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1' }), 0)

      tickService.advance(1000)
      expect(queue.get('dec-1')!.status).toBe('pending')

      queue.unsubscribeFrom(tickService)
    })

    it('does not time out suspended decisions', () => {
      const tickService = new TickService({ mode: 'manual' })
      const queue = new DecisionQueue({ timeoutTicks: 5 })

      queue.subscribeTo(tickService)
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)
      queue.suspendAgentDecisions('a')

      tickService.advance(10)
      expect(queue.get('dec-1')!.status).toBe('suspended')

      queue.unsubscribeFrom(tickService)
    })

    it('falls back to first option when no recommended option', () => {
      const tickService = new TickService({ mode: 'manual' })
      const queue = new DecisionQueue({ timeoutTicks: 1 })

      queue.subscribeTo(tickService)
      queue.enqueue(
        makeOptionDecision({
          decisionId: 'dec-1',
          recommendedOptionId: undefined
        }),
        0
      )

      tickService.advance(1)

      const res = queue.get('dec-1')!.resolution as OptionDecisionResolution
      expect(res.chosenOptionId).toBe('opt-1') // first option

      queue.unsubscribeFrom(tickService)
    })
  })

  describe('orphan grace period', () => {
    it('scheduleOrphanTriage sets badge and graceDeadlineTick', () => {
      const queue = new DecisionQueue({ orphanGracePeriodTicks: 10 })
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-2', agentId: 'a' }), 0)
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-3', agentId: 'b' }), 0)

      const scheduled = queue.scheduleOrphanTriage('a', 5)

      expect(scheduled).toHaveLength(2)
      expect(queue.get('dec-1')!.status).toBe('pending')
      expect(queue.get('dec-1')!.badge).toBe('grace period')
      expect(queue.get('dec-1')!.graceDeadlineTick).toBe(15)

      expect(queue.get('dec-2')!.badge).toBe('grace period')
      expect(queue.get('dec-2')!.graceDeadlineTick).toBe(15)

      // Other agent unaffected
      expect(queue.get('dec-3')!.badge).toBeUndefined()
      expect(queue.get('dec-3')!.graceDeadlineTick).toBeUndefined()
    })

    it('decisions remain resolvable during grace period', () => {
      const tickService = new TickService({ mode: 'manual' })
      const queue = new DecisionQueue({ orphanGracePeriodTicks: 10 })
      queue.subscribeTo(tickService)

      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)
      queue.scheduleOrphanTriage('a', 0)

      // Still pending during grace period
      tickService.advance(5)
      expect(queue.get('dec-1')!.status).toBe('pending')

      // Human resolves during grace period
      const result = queue.resolve('dec-1', {
        type: 'option',
        chosenOptionId: 'opt-1',
        rationale: 'Human resolved during grace',
        actionKind: 'review'
      })

      expect(result).toBeDefined()
      expect(result!.status).toBe('resolved')

      // Advance past grace deadline — should stay resolved, not triage
      tickService.advance(10)
      expect(queue.get('dec-1')!.status).toBe('resolved')

      queue.unsubscribeFrom(tickService)
    })

    it('moves to triage after grace period expires', () => {
      const tickService = new TickService({ mode: 'manual' })
      const queue = new DecisionQueue({ orphanGracePeriodTicks: 10 })
      queue.subscribeTo(tickService)

      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)
      queue.scheduleOrphanTriage('a', 0)

      // Just before deadline
      tickService.advance(9)
      expect(queue.get('dec-1')!.status).toBe('pending')

      // At deadline
      tickService.advance(1)
      expect(queue.get('dec-1')!.status).toBe('triage')
      expect(queue.get('dec-1')!.badge).toBe('agent killed')
      expect(queue.get('dec-1')!.priority).toBeGreaterThan(0)
      expect(queue.get('dec-1')!.graceDeadlineTick).toBeUndefined()

      queue.unsubscribeFrom(tickService)
    })

    it('elevates priority when grace period expires', () => {
      const tickService = new TickService({ mode: 'manual' })
      const queue = new DecisionQueue({ orphanGracePeriodTicks: 5 })
      queue.subscribeTo(tickService)

      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a', severity: 'low' }), 0)
      const originalPriority = queue.get('dec-1')!.priority

      queue.scheduleOrphanTriage('a', 0)
      tickService.advance(5)

      expect(queue.get('dec-1')!.priority).toBe(originalPriority + 100)

      queue.unsubscribeFrom(tickService)
    })

    it('uses default grace period of 30 ticks', () => {
      const tickService = new TickService({ mode: 'manual' })
      const queue = new DecisionQueue()
      queue.subscribeTo(tickService)

      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)
      queue.scheduleOrphanTriage('a', 0)

      // At tick 29 still pending
      tickService.advance(29)
      expect(queue.get('dec-1')!.status).toBe('pending')

      // At tick 30 moves to triage
      tickService.advance(1)
      expect(queue.get('dec-1')!.status).toBe('triage')

      queue.unsubscribeFrom(tickService)
    })

    it('does not affect already-resolved decisions', () => {
      const queue = new DecisionQueue({ orphanGracePeriodTicks: 10 })
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)

      queue.resolve('dec-1', {
        type: 'option',
        chosenOptionId: 'opt-1',
        rationale: 'test',
        actionKind: 'review'
      })

      const scheduled = queue.scheduleOrphanTriage('a', 0)
      expect(scheduled).toHaveLength(0)
      expect(queue.get('dec-1')!.status).toBe('resolved')
    })

    it('handleAgentKilled still works for immediate triage (brake)', () => {
      const queue = new DecisionQueue()
      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)

      const orphaned = queue.handleAgentKilled('a')
      expect(orphaned).toHaveLength(1)
      expect(orphaned[0].status).toBe('triage')
      expect(orphaned[0].badge).toBe('agent killed')
    })

    it('grace period works with null timeoutTicks', () => {
      const tickService = new TickService({ mode: 'manual' })
      const queue = new DecisionQueue({ timeoutTicks: null, orphanGracePeriodTicks: 5 })
      queue.subscribeTo(tickService)

      queue.enqueue(makeOptionDecision({ decisionId: 'dec-1', agentId: 'a' }), 0)
      queue.scheduleOrphanTriage('a', 0)

      tickService.advance(5)
      expect(queue.get('dec-1')!.status).toBe('triage')

      queue.unsubscribeFrom(tickService)
    })
  })
})
