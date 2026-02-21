import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { TeamsBridgePlugin } from '../../src/gateway/teams-bridge-plugin'
import type { AgentBrief, AgentHandle, ContextInjection } from '../../src/types'

// ── Helpers ──────────────────────────────────────────────────────────────

function makeMinimalBrief(agentId = 'agent-1'): AgentBrief {
  return {
    agentId,
    role: 'coder',
    description: 'A coding agent',
    workstream: 'core',
    readableWorkstreams: ['core'],
    constraints: [],
    escalationProtocol: {
      alwaysEscalate: [],
      escalateWhen: [],
      neverEscalate: [],
    },
    controlMode: 'orchestrator',
    projectBrief: {
      title: 'Test Project',
      description: 'A test project',
      goals: ['ship it'],
      checkpoints: ['done'],
    },
    knowledgeSnapshot: {
      version: 1,
      generatedAt: '2026-02-10T00:00:00.000Z',
      workstreams: [],
      pendingDecisions: [],
      recentCoherenceIssues: [],
      artifactIndex: [],
      activeAgents: [],
      estimatedTokens: 0,
    },
    allowedTools: ['read_file', 'write_file'],
  }
}

function makeHandle(overrides: Partial<AgentHandle> = {}): AgentHandle {
  return {
    id: 'agent-1',
    pluginName: 'teams-bridge',
    status: 'running',
    sessionId: 'bridge-agent-1-1234',
    ...overrides,
  }
}

function makeInjection(overrides: Partial<ContextInjection> = {}): ContextInjection {
  return {
    content: '# Context update\nNew info here.',
    format: 'markdown',
    snapshotVersion: 1,
    estimatedTokens: 50,
    priority: 'recommended',
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('TeamsBridgePlugin', () => {
  let bridgeDir: string
  let plugin: TeamsBridgePlugin

  beforeEach(async () => {
    bridgeDir = await mkdtemp(join(tmpdir(), 'bridge-test-'))
    plugin = new TeamsBridgePlugin(bridgeDir)
  })

  afterEach(async () => {
    await rm(bridgeDir, { recursive: true, force: true })
  })

  // ── Plugin metadata ──────────────────────────────────────────────────

  describe('plugin metadata', () => {
    it('has name "teams-bridge"', () => {
      expect(plugin.name).toBe('teams-bridge')
    })

    it('has version "1.0.0"', () => {
      expect(plugin.version).toBe('1.0.0')
    })

    it('has all capabilities set to false', () => {
      expect(plugin.capabilities).toEqual({
        supportsPause: false,
        supportsResume: false,
        supportsKill: false,
        supportsHotBriefUpdate: false,
      })
    })
  })

  // ── spawn() ──────────────────────────────────────────────────────────

  describe('spawn()', () => {
    it('registers handle with correct id and pluginName', async () => {
      const handle = await plugin.spawn(makeMinimalBrief('maya-1'))

      expect(handle.id).toBe('maya-1')
      expect(handle.pluginName).toBe('teams-bridge')
      expect(handle.status).toBe('running')
    })

    it('generates a session ID starting with "bridge-"', async () => {
      const handle = await plugin.spawn(makeMinimalBrief('maya-1'))

      expect(handle.sessionId).toMatch(/^bridge-maya-1-/)
    })

    it('makes the handle retrievable via getHandle()', async () => {
      await plugin.spawn(makeMinimalBrief('maya-1'))

      const retrieved = plugin.getHandle('maya-1')
      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe('maya-1')
    })
  })

  // ── kill() ───────────────────────────────────────────────────────────

  describe('kill()', () => {
    it('writes brake file to the correct path', async () => {
      const handle = makeHandle({ id: 'agent-kill' })
      plugin.registerHandle(handle)

      await plugin.kill(handle)

      const content = await readFile(join(bridgeDir, 'brake', 'agent-kill'), 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.reason).toBe('killed')
      expect(parsed.at).toBeDefined()
    })

    it('removes the handle from internal storage', async () => {
      const handle = makeHandle({ id: 'agent-kill-2' })
      plugin.registerHandle(handle)

      await plugin.kill(handle)

      expect(plugin.getHandle('agent-kill-2')).toBeUndefined()
    })

    it('returns cleanShutdown false and artifactsExtracted 0', async () => {
      const handle = makeHandle()
      plugin.registerHandle(handle)

      const result = await plugin.kill(handle)

      expect(result.cleanShutdown).toBe(false)
      expect(result.artifactsExtracted).toBe(0)
    })
  })

  // ── injectContext() ──────────────────────────────────────────────────

  describe('injectContext()', () => {
    it('writes .md file to the correct path', async () => {
      const handle = makeHandle({ id: 'agent-ctx' })
      plugin.registerHandle(handle)

      const injection = makeInjection({ content: '# Hello world' })
      await plugin.injectContext(handle, injection)

      const content = await readFile(
        join(bridgeDir, 'context', 'agent-ctx.md'),
        'utf-8'
      )
      expect(content).toBe('# Hello world')
    })

    it('overwrites on subsequent calls', async () => {
      const handle = makeHandle({ id: 'agent-ctx' })
      plugin.registerHandle(handle)

      await plugin.injectContext(handle, makeInjection({ content: 'first' }))
      await plugin.injectContext(handle, makeInjection({ content: 'second' }))

      const content = await readFile(
        join(bridgeDir, 'context', 'agent-ctx.md'),
        'utf-8'
      )
      expect(content).toBe('second')
    })
  })

  // ── requestCheckpoint() ──────────────────────────────────────────────

  describe('requestCheckpoint()', () => {
    it('returns synthetic state with correct agentId', async () => {
      const handle = makeHandle({ id: 'agent-cp' })
      plugin.registerHandle(handle)

      const state = await plugin.requestCheckpoint(handle, 'dec-1')

      expect(state.agentId).toBe('agent-cp')
      expect(state.pluginName).toBe('teams-bridge')
      expect(state.sessionId).toBe(handle.sessionId)
      expect(state.serializedBy).toBe('decision_checkpoint')
    })

    it('includes the decision id in pendingDecisionIds', async () => {
      const handle = makeHandle()
      plugin.registerHandle(handle)

      const state = await plugin.requestCheckpoint(handle, 'dec-123')

      expect(state.pendingDecisionIds).toEqual(['dec-123'])
    })

    it('uses lastSequence from updateSequence()', async () => {
      const handle = makeHandle({ id: 'agent-seq' })
      plugin.registerHandle(handle)
      plugin.updateSequence('agent-seq', 42)

      const state = await plugin.requestCheckpoint(handle, 'dec-1')

      expect(state.lastSequence).toBe(42)
      expect(state.checkpoint).toEqual({ sdk: 'mock', scriptPosition: 42 })
    })

    it('defaults lastSequence to 0 when no sequence is tracked', async () => {
      const handle = makeHandle()
      plugin.registerHandle(handle)

      const state = await plugin.requestCheckpoint(handle, 'dec-1')

      expect(state.lastSequence).toBe(0)
    })
  })

  // ── Handles unknown agents gracefully ────────────────────────────────

  describe('unknown agent handling', () => {
    it('getHandle returns undefined for unknown agents', () => {
      expect(plugin.getHandle('nonexistent')).toBeUndefined()
    })

    it('consumeContext returns null for unknown agents', async () => {
      const result = await plugin.consumeContext('nonexistent')
      expect(result).toBeNull()
    })

    it('isBrakeActive returns false for unknown agents', async () => {
      const result = await plugin.isBrakeActive('nonexistent')
      expect(result).toBe(false)
    })

    it('clearBrake does not throw for unknown agents', async () => {
      await expect(plugin.clearBrake('nonexistent')).resolves.toBeUndefined()
    })

    it('updateSequence does not throw for unknown agents', () => {
      expect(() => plugin.updateSequence('nonexistent', 5)).not.toThrow()
    })
  })

  // ── pause/resume throw ───────────────────────────────────────────────

  describe('unsupported operations', () => {
    it('pause() throws', async () => {
      const handle = makeHandle()
      await expect(plugin.pause(handle)).rejects.toThrow(/does not support pause/)
    })

    it('resume() throws', async () => {
      const state = {
        agentId: 'agent-1',
        pluginName: 'teams-bridge',
        sessionId: 'bridge-agent-1-1234',
        checkpoint: { sdk: 'mock' as const, scriptPosition: 0 },
        briefSnapshot: makeMinimalBrief(),
        pendingDecisionIds: [],
        lastSequence: 0,
        serializedAt: new Date().toISOString(),
        serializedBy: 'pause' as const,
        estimatedSizeBytes: 256,
      }
      await expect(plugin.resume(state)).rejects.toThrow(/does not support resume/)
    })
  })

  // ── consumeContext / isBrakeActive ───────────────────────────────────

  describe('consumeContext()', () => {
    it('returns injected context and clears it', async () => {
      const handle = makeHandle({ id: 'agent-consume' })
      plugin.registerHandle(handle)

      const injection = makeInjection({ content: 'hello context' })
      await plugin.injectContext(handle, injection)

      const first = await plugin.consumeContext('agent-consume')
      expect(first).toBeDefined()
      expect(first!.content).toBe('hello context')

      const second = await plugin.consumeContext('agent-consume')
      expect(second).toBeNull()
    })
  })

  describe('isBrakeActive()', () => {
    it('returns true after kill writes brake file', async () => {
      const handle = makeHandle({ id: 'agent-brake' })
      plugin.registerHandle(handle)

      await plugin.kill(handle)

      const active = await plugin.isBrakeActive('agent-brake')
      expect(active).toBe(true)
    })

    it('returns false after clearBrake()', async () => {
      const handle = makeHandle({ id: 'agent-brake-clear' })
      plugin.registerHandle(handle)

      await plugin.kill(handle)
      await plugin.clearBrake('agent-brake-clear')

      const active = await plugin.isBrakeActive('agent-brake-clear')
      expect(active).toBe(false)
    })
  })
})
