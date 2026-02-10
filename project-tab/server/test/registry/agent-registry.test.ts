import { beforeEach, describe, expect, it } from 'vitest'

import { AgentRegistry } from '../../src/registry/agent-registry'
import type { AgentHandle, SandboxInfo } from '../../src/types'

function makeHandle(overrides: Partial<AgentHandle> = {}): AgentHandle {
  return {
    id: 'agent-1',
    pluginName: 'openai-local',
    status: 'running',
    sessionId: 'session-1',
    ...overrides,
  }
}

function makeSandbox(overrides: Partial<SandboxInfo> = {}): SandboxInfo {
  return {
    agentId: 'agent-1',
    transport: {
      type: 'local_http',
      rpcEndpoint: 'http://localhost:9100',
      eventStreamEndpoint: 'ws://localhost:9100/events',
    },
    providerType: 'local_process',
    createdAt: '2026-02-10T00:00:00.000Z',
    lastHeartbeatAt: null,
    ...overrides,
  }
}

describe('AgentRegistry', () => {
  let registry: AgentRegistry

  beforeEach(() => {
    registry = new AgentRegistry()
  })

  it('starts empty', () => {
    expect(registry.size).toBe(0)
    expect(registry.getAll()).toEqual([])
  })

  it('registers an agent and retrieves it by id', () => {
    const handle = makeHandle()
    const sandbox = makeSandbox()
    registry.register(handle, sandbox)

    expect(registry.size).toBe(1)

    const entry = registry.getById('agent-1')
    expect(entry).toBeDefined()
    expect(entry!.handle.id).toBe('agent-1')
    expect(entry!.sandbox.agentId).toBe('agent-1')
  })

  it('throws on duplicate registration', () => {
    registry.register(makeHandle(), makeSandbox())
    expect(() => registry.register(makeHandle(), makeSandbox())).toThrow(
      'Agent agent-1 is already registered'
    )
  })

  it('returns undefined for unknown agent id', () => {
    expect(registry.getById('nonexistent')).toBeUndefined()
  })

  it('unregisters an agent and returns true', () => {
    registry.register(makeHandle(), makeSandbox())
    expect(registry.unregister('agent-1')).toBe(true)
    expect(registry.size).toBe(0)
    expect(registry.getById('agent-1')).toBeUndefined()
  })

  it('returns false when unregistering unknown agent', () => {
    expect(registry.unregister('nonexistent')).toBe(false)
  })

  it('lists all registered agents', () => {
    registry.register(makeHandle({ id: 'a1' }), makeSandbox({ agentId: 'a1' }))
    registry.register(makeHandle({ id: 'a2' }), makeSandbox({ agentId: 'a2' }))
    registry.register(makeHandle({ id: 'a3' }), makeSandbox({ agentId: 'a3' }))

    const all = registry.getAll()
    expect(all).toHaveLength(3)
    const ids = all.map((a) => a.handle.id).sort()
    expect(ids).toEqual(['a1', 'a2', 'a3'])
  })

  it('getAll returns a copy, not a reference', () => {
    registry.register(makeHandle(), makeSandbox())
    const all1 = registry.getAll()
    const all2 = registry.getAll()
    expect(all1).not.toBe(all2)
  })

  it('updates agent handle', () => {
    registry.register(makeHandle(), makeSandbox())
    const updated = makeHandle({ status: 'paused' })
    registry.updateHandle('agent-1', updated)

    expect(registry.getById('agent-1')!.handle.status).toBe('paused')
  })

  it('throws when updating handle for unknown agent', () => {
    expect(() =>
      registry.updateHandle('nonexistent', makeHandle({ id: 'nonexistent' }))
    ).toThrow('Agent nonexistent is not registered')
  })

  it('updates sandbox info partially', () => {
    registry.register(makeHandle(), makeSandbox())
    registry.updateSandbox('agent-1', {
      lastHeartbeatAt: '2026-02-10T01:00:00.000Z',
    })

    const entry = registry.getById('agent-1')!
    expect(entry.sandbox.lastHeartbeatAt).toBe('2026-02-10T01:00:00.000Z')
    expect(entry.sandbox.transport.type).toBe('local_http')
  })

  it('throws when updating sandbox for unknown agent', () => {
    expect(() =>
      registry.updateSandbox('nonexistent', { lastHeartbeatAt: 'x' })
    ).toThrow('Agent nonexistent is not registered')
  })

  it('killAll clears all agents and returns their ids', () => {
    registry.register(makeHandle({ id: 'a1' }), makeSandbox({ agentId: 'a1' }))
    registry.register(makeHandle({ id: 'a2' }), makeSandbox({ agentId: 'a2' }))

    const killed = registry.killAll()
    expect(killed.sort()).toEqual(['a1', 'a2'])
    expect(registry.size).toBe(0)
    expect(registry.getAll()).toEqual([])
  })

  it('killAll on empty registry returns empty array', () => {
    expect(registry.killAll()).toEqual([])
  })
})
