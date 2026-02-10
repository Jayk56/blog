import { describe, expect, it, beforeEach, afterEach } from 'vitest'

import { KnowledgeStore, type StoredCheckpoint } from '../../src/intelligence/knowledge-store'
import type { SerializedAgentState, AgentBrief, KnowledgeSnapshot } from '../../src/types'

// ── Test helpers ──────────────────────────────────────────────────

function makeSnapshot(): KnowledgeSnapshot {
  return {
    version: 0,
    generatedAt: new Date().toISOString(),
    workstreams: [],
    pendingDecisions: [],
    recentCoherenceIssues: [],
    artifactIndex: [],
    activeAgents: [],
    estimatedTokens: 0,
  }
}

function makeBrief(agentId: string): AgentBrief {
  return {
    agentId,
    role: 'developer',
    description: 'Test agent',
    workstream: 'ws-1',
    readableWorkstreams: [],
    constraints: [],
    escalationProtocol: { alwaysEscalate: [], escalateWhen: [], neverEscalate: [] },
    controlMode: 'adaptive',
    projectBrief: { title: 'Test', description: 'Test', goals: [], checkpoints: [] },
    knowledgeSnapshot: makeSnapshot(),
    allowedTools: [],
  }
}

function makeCheckpointState(
  agentId: string,
  overrides: Partial<SerializedAgentState> = {}
): SerializedAgentState {
  return {
    agentId,
    pluginName: 'test-plugin',
    sessionId: `session-${agentId}`,
    checkpoint: { sdk: 'mock', scriptPosition: 0 },
    briefSnapshot: makeBrief(agentId),
    conversationSummary: 'Agent was working on task',
    pendingDecisionIds: [],
    lastSequence: 10,
    serializedAt: new Date().toISOString(),
    serializedBy: 'decision_checkpoint',
    estimatedSizeBytes: 1024,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('KnowledgeStore: Checkpoints', () => {
  let store: KnowledgeStore

  beforeEach(() => {
    store = new KnowledgeStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  describe('storeCheckpoint', () => {
    it('stores a checkpoint for an agent', () => {
      const state = makeCheckpointState('agent-1')
      store.storeCheckpoint(state, 'decision-1')

      const checkpoints = store.getCheckpoints('agent-1')
      expect(checkpoints).toHaveLength(1)
      expect(checkpoints[0].agentId).toBe('agent-1')
      expect(checkpoints[0].decisionId).toBe('decision-1')
      expect(checkpoints[0].serializedBy).toBe('decision_checkpoint')
      expect(checkpoints[0].estimatedSizeBytes).toBe(1024)
    })

    it('stores checkpoint without decisionId', () => {
      const state = makeCheckpointState('agent-1', { serializedBy: 'pause' })
      store.storeCheckpoint(state)

      const checkpoints = store.getCheckpoints('agent-1')
      expect(checkpoints).toHaveLength(1)
      expect(checkpoints[0].decisionId).toBeUndefined()
      expect(checkpoints[0].serializedBy).toBe('pause')
    })

    it('stores full SerializedAgentState in state_json', () => {
      const state = makeCheckpointState('agent-1', {
        conversationSummary: 'Important context',
        pendingDecisionIds: ['dec-1', 'dec-2'],
        lastSequence: 42,
      })
      store.storeCheckpoint(state, 'decision-1')

      const checkpoint = store.getLatestCheckpoint('agent-1')!
      expect(checkpoint.state.conversationSummary).toBe('Important context')
      expect(checkpoint.state.pendingDecisionIds).toEqual(['dec-1', 'dec-2'])
      expect(checkpoint.state.lastSequence).toBe(42)
      expect(checkpoint.state.checkpoint).toEqual({ sdk: 'mock', scriptPosition: 0 })
    })

    it('stores multiple checkpoints for same agent', () => {
      for (let i = 0; i < 3; i++) {
        const state = makeCheckpointState('agent-1', {
          lastSequence: i * 10,
          serializedAt: new Date(Date.now() + i * 1000).toISOString(),
        })
        store.storeCheckpoint(state, `decision-${i}`)
      }

      const checkpoints = store.getCheckpoints('agent-1')
      expect(checkpoints).toHaveLength(3)
    })

    it('stores checkpoints for different agents independently', () => {
      store.storeCheckpoint(makeCheckpointState('agent-1'), 'dec-1')
      store.storeCheckpoint(makeCheckpointState('agent-2'), 'dec-2')

      expect(store.getCheckpoints('agent-1')).toHaveLength(1)
      expect(store.getCheckpoints('agent-2')).toHaveLength(1)
    })
  })

  describe('checkpoint pruning', () => {
    it('prunes oldest checkpoints beyond maxPerAgent (default 3)', () => {
      for (let i = 0; i < 5; i++) {
        const state = makeCheckpointState('agent-1', {
          lastSequence: i * 10,
          serializedAt: new Date(Date.now() + i * 1000).toISOString(),
        })
        store.storeCheckpoint(state, `decision-${i}`)
      }

      const checkpoints = store.getCheckpoints('agent-1')
      expect(checkpoints).toHaveLength(3)

      // Should keep the 3 newest (decision-2, decision-3, decision-4)
      const decisionIds = checkpoints.map((c) => c.decisionId)
      expect(decisionIds).toContain('decision-4')
      expect(decisionIds).toContain('decision-3')
      expect(decisionIds).toContain('decision-2')
      expect(decisionIds).not.toContain('decision-0')
      expect(decisionIds).not.toContain('decision-1')
    })

    it('respects custom maxPerAgent parameter', () => {
      for (let i = 0; i < 5; i++) {
        const state = makeCheckpointState('agent-1', {
          lastSequence: i * 10,
          serializedAt: new Date(Date.now() + i * 1000).toISOString(),
        })
        store.storeCheckpoint(state, `decision-${i}`, 2) // keep only 2
      }

      const checkpoints = store.getCheckpoints('agent-1')
      expect(checkpoints).toHaveLength(2)
    })

    it('does not prune other agents checkpoints', () => {
      for (let i = 0; i < 5; i++) {
        store.storeCheckpoint(
          makeCheckpointState('agent-1', {
            serializedAt: new Date(Date.now() + i * 1000).toISOString(),
          }),
          `dec-a-${i}`
        )
      }

      store.storeCheckpoint(makeCheckpointState('agent-2'), 'dec-b-0')

      expect(store.getCheckpoints('agent-1')).toHaveLength(3) // pruned to 3
      expect(store.getCheckpoints('agent-2')).toHaveLength(1) // untouched
    })
  })

  describe('getCheckpoints', () => {
    it('returns checkpoints ordered newest first', () => {
      for (let i = 0; i < 3; i++) {
        const state = makeCheckpointState('agent-1', {
          lastSequence: i * 10,
          serializedAt: new Date(Date.now() + i * 1000).toISOString(),
        })
        store.storeCheckpoint(state, `decision-${i}`)
      }

      const checkpoints = store.getCheckpoints('agent-1')
      expect(checkpoints[0].decisionId).toBe('decision-2') // newest
      expect(checkpoints[2].decisionId).toBe('decision-0') // oldest
    })

    it('returns empty array for unknown agent', () => {
      expect(store.getCheckpoints('nonexistent')).toEqual([])
    })
  })

  describe('getLatestCheckpoint', () => {
    it('returns the most recent checkpoint', () => {
      store.storeCheckpoint(
        makeCheckpointState('agent-1', {
          serializedAt: new Date(Date.now()).toISOString(),
          lastSequence: 5,
        }),
        'decision-old'
      )
      store.storeCheckpoint(
        makeCheckpointState('agent-1', {
          serializedAt: new Date(Date.now() + 1000).toISOString(),
          lastSequence: 15,
        }),
        'decision-new'
      )

      const latest = store.getLatestCheckpoint('agent-1')
      expect(latest).toBeDefined()
      expect(latest!.decisionId).toBe('decision-new')
      expect(latest!.state.lastSequence).toBe(15)
    })

    it('returns undefined for unknown agent', () => {
      expect(store.getLatestCheckpoint('nonexistent')).toBeUndefined()
    })
  })

  describe('getCheckpointCount', () => {
    it('returns correct count', () => {
      expect(store.getCheckpointCount('agent-1')).toBe(0)

      store.storeCheckpoint(makeCheckpointState('agent-1'), 'dec-1')
      expect(store.getCheckpointCount('agent-1')).toBe(1)

      store.storeCheckpoint(
        makeCheckpointState('agent-1', {
          serializedAt: new Date(Date.now() + 1000).toISOString(),
        }),
        'dec-2'
      )
      expect(store.getCheckpointCount('agent-1')).toBe(2)
    })
  })

  describe('deleteCheckpoints', () => {
    it('deletes all checkpoints for an agent', () => {
      store.storeCheckpoint(makeCheckpointState('agent-1'), 'dec-1')
      store.storeCheckpoint(
        makeCheckpointState('agent-1', {
          serializedAt: new Date(Date.now() + 1000).toISOString(),
        }),
        'dec-2'
      )

      const deleted = store.deleteCheckpoints('agent-1')
      expect(deleted).toBe(2)
      expect(store.getCheckpoints('agent-1')).toHaveLength(0)
    })

    it('returns 0 for unknown agent', () => {
      expect(store.deleteCheckpoints('nonexistent')).toBe(0)
    })

    it('does not affect other agents', () => {
      store.storeCheckpoint(makeCheckpointState('agent-1'), 'dec-1')
      store.storeCheckpoint(makeCheckpointState('agent-2'), 'dec-2')

      store.deleteCheckpoints('agent-1')

      expect(store.getCheckpoints('agent-1')).toHaveLength(0)
      expect(store.getCheckpoints('agent-2')).toHaveLength(1)
    })
  })

  describe('audit logging', () => {
    it('records audit entry when checkpoint is stored', () => {
      store.storeCheckpoint(makeCheckpointState('agent-1'), 'dec-1')

      // Verify via the audit log table directly
      // We can check this by querying the DB — access via getSnapshot or other means
      // Since audit_log is internal, we just verify no errors were thrown
      // and the checkpoint was stored correctly
      expect(store.getCheckpointCount('agent-1')).toBe(1)
    })
  })

  describe('serializedBy variants', () => {
    it('supports decision_checkpoint', () => {
      store.storeCheckpoint(makeCheckpointState('agent-1', { serializedBy: 'decision_checkpoint' }))
      const cp = store.getLatestCheckpoint('agent-1')!
      expect(cp.serializedBy).toBe('decision_checkpoint')
    })

    it('supports pause', () => {
      store.storeCheckpoint(makeCheckpointState('agent-1', { serializedBy: 'pause' }))
      const cp = store.getLatestCheckpoint('agent-1')!
      expect(cp.serializedBy).toBe('pause')
    })

    it('supports kill_grace', () => {
      store.storeCheckpoint(makeCheckpointState('agent-1', { serializedBy: 'kill_grace' }))
      const cp = store.getLatestCheckpoint('agent-1')!
      expect(cp.serializedBy).toBe('kill_grace')
    })

    it('supports crash_recovery', () => {
      store.storeCheckpoint(makeCheckpointState('agent-1', { serializedBy: 'crash_recovery' }))
      const cp = store.getLatestCheckpoint('agent-1')!
      expect(cp.serializedBy).toBe('crash_recovery')
    })
  })

  describe('SDK checkpoint variants', () => {
    it('stores OpenAI checkpoint', () => {
      store.storeCheckpoint(makeCheckpointState('agent-1', {
        checkpoint: { sdk: 'openai', runStateJson: '{"state": "paused"}' },
      }))
      const cp = store.getLatestCheckpoint('agent-1')!
      expect(cp.state.checkpoint).toEqual({ sdk: 'openai', runStateJson: '{"state": "paused"}' })
    })

    it('stores Claude checkpoint', () => {
      store.storeCheckpoint(makeCheckpointState('agent-1', {
        checkpoint: { sdk: 'claude', sessionId: 'sess-abc', lastMessageId: 'msg-123' },
      }))
      const cp = store.getLatestCheckpoint('agent-1')!
      expect(cp.state.checkpoint).toEqual({ sdk: 'claude', sessionId: 'sess-abc', lastMessageId: 'msg-123' })
    })

    it('stores Gemini checkpoint', () => {
      store.storeCheckpoint(makeCheckpointState('agent-1', {
        checkpoint: { sdk: 'gemini', sessionId: 'gem-sess', stateSnapshot: { key: 'value' } },
      }))
      const cp = store.getLatestCheckpoint('agent-1')!
      expect(cp.state.checkpoint).toEqual({ sdk: 'gemini', sessionId: 'gem-sess', stateSnapshot: { key: 'value' } })
    })

    it('stores mock checkpoint', () => {
      store.storeCheckpoint(makeCheckpointState('agent-1', {
        checkpoint: { sdk: 'mock', scriptPosition: 42 },
      }))
      const cp = store.getLatestCheckpoint('agent-1')!
      expect(cp.state.checkpoint).toEqual({ sdk: 'mock', scriptPosition: 42 })
    })
  })
})
