import { beforeEach, describe, expect, it } from 'vitest'

import { AgentRegistry } from '../../src/registry/agent-registry'
import type { AgentHandle } from '../../src/types'

function makeHandle(overrides: Partial<AgentHandle> = {}): AgentHandle {
  return {
    id: 'agent-1',
    pluginName: 'openai-local',
    status: 'running',
    sessionId: 'session-1',
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
    expect(registry.listHandles()).toEqual([])
  })

  it('registers an agent and retrieves it by id', () => {
    const handle = makeHandle()
    registry.registerHandle(handle)

    expect(registry.size).toBe(1)

    const entry = registry.getHandle('agent-1')
    expect(entry).toBeDefined()
    expect(entry!.id).toBe('agent-1')
  })

  it('throws on duplicate registration', () => {
    registry.registerHandle(makeHandle())
    expect(() => registry.registerHandle(makeHandle())).toThrow(
      'Agent agent-1 is already registered'
    )
  })

  it('returns null for unknown agent id', () => {
    expect(registry.getHandle('nonexistent')).toBeNull()
  })

  it('removes an agent', () => {
    registry.registerHandle(makeHandle())
    registry.removeHandle('agent-1')
    expect(registry.size).toBe(0)
    expect(registry.getHandle('agent-1')).toBeNull()
  })

  it('removeHandle is a no-op for unknown agents', () => {
    registry.removeHandle('nonexistent')
    expect(registry.size).toBe(0)
  })

  it('lists all registered agents', () => {
    registry.registerHandle(makeHandle({ id: 'a1' }))
    registry.registerHandle(makeHandle({ id: 'a2' }))
    registry.registerHandle(makeHandle({ id: 'a3' }))

    const all = registry.listHandles()
    expect(all).toHaveLength(3)
    const ids = all.map((a) => a.id).sort()
    expect(ids).toEqual(['a1', 'a2', 'a3'])
  })

  it('listHandles returns a copy, not a reference', () => {
    registry.registerHandle(makeHandle())
    const all1 = registry.listHandles()
    const all2 = registry.listHandles()
    expect(all1).not.toBe(all2)
  })

  it('updates agent handle', () => {
    registry.registerHandle(makeHandle())
    registry.updateHandle('agent-1', { status: 'paused' })

    expect(registry.getHandle('agent-1')!.status).toBe('paused')
  })

  it('ignores updates for unknown agents', () => {
    registry.updateHandle('nonexistent', { status: 'paused' })
    expect(registry.getHandle('nonexistent')).toBeNull()
  })

  it('supports optional filtering in listHandles', () => {
    registry.registerHandle(makeHandle({ id: 'a1', pluginName: 'openai', status: 'running' }))
    registry.registerHandle(makeHandle({ id: 'a2', pluginName: 'claude', status: 'paused' }))
    registry.registerHandle(makeHandle({ id: 'a3', pluginName: 'openai', status: 'paused' }))

    expect(registry.listHandles({ pluginName: 'openai' }).map((h) => h.id).sort()).toEqual(['a1', 'a3'])
    expect(registry.listHandles({ status: 'paused' }).map((h) => h.id).sort()).toEqual(['a2', 'a3'])
    expect(registry.listHandles({ pluginName: 'openai', status: 'paused' }).map((h) => h.id)).toEqual(['a3'])
  })
})
