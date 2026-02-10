import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChildProcessManager } from '../../src/gateway/child-process-manager'
import type { SandboxBootstrap } from '../../src/types'

// We cannot easily unit test actual child_process.spawn, so we focus on
// port allocation, cleanup logic, and the health polling flow.

function makeBootstrap(): SandboxBootstrap {
  return {
    backendUrl: 'http://localhost:3000',
    backendToken: 'test-token',
    tokenExpiresAt: '2026-02-11T00:00:00.000Z',
    agentId: 'agent-1',
    artifactUploadEndpoint: 'http://localhost:3000/api/artifacts',
  }
}

describe('ChildProcessManager', () => {
  describe('port allocation', () => {
    let manager: ChildProcessManager

    beforeEach(() => {
      manager = new ChildProcessManager()
    })

    it('allocates ports starting at 9100', () => {
      const port = manager.allocatePort()
      expect(port).toBe(9100)
    })

    it('allocates sequential ports', () => {
      const p1 = manager.allocatePort()
      const p2 = manager.allocatePort()
      const p3 = manager.allocatePort()

      expect(p1).toBe(9100)
      expect(p2).toBe(9101)
      expect(p3).toBe(9102)
    })

    it('reuses released ports', () => {
      const p1 = manager.allocatePort()
      const p2 = manager.allocatePort()

      manager.releasePort(p1)

      const p3 = manager.allocatePort()
      expect(p3).toBe(p1) // Reuses port 9100
    })

    it('throws when all ports are exhausted', () => {
      // Allocate all 100 ports (9100-9199)
      for (let i = 0; i < 100; i++) {
        manager.allocatePort()
      }

      expect(() => manager.allocatePort()).toThrow(
        'No ports available in range 9100-9199'
      )
    })
  })

  describe('cleanup', () => {
    it('releases port and removes tracking on cleanup', () => {
      const manager = new ChildProcessManager()

      const port = manager.allocatePort()
      expect(port).toBe(9100)

      manager.cleanup('agent-1', port)

      // Port should be reusable
      const reused = manager.allocatePort()
      expect(reused).toBe(9100)
    })
  })

  describe('spawnShim', () => {
    it('fails when health poll times out', async () => {
      // Mock fetch that always fails (connection refused)
      const fetchMock = vi.fn(async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof globalThis.fetch

      const manager = new ChildProcessManager(fetchMock)

      await expect(
        manager.spawnShim('agent-1', {
          command: 'echo',
          args: ['test'],
          bootstrap: makeBootstrap(),
          healthPollIntervalMs: 10,
          healthStartupTimeoutMs: 50,
        })
      ).rejects.toThrow('did not become healthy within 50ms')
    }, 10_000)

    it('succeeds when health poll returns ok', async () => {
      let callCount = 0
      const fetchMock = vi.fn(async () => {
        callCount++
        if (callCount < 3) {
          throw new TypeError('connection refused')
        }
        return new Response('{"status":"healthy"}', { status: 200 })
      }) as unknown as typeof globalThis.fetch

      const manager = new ChildProcessManager(fetchMock)

      const result = await manager.spawnShim('agent-1', {
        command: 'sleep',
        args: ['60'],
        bootstrap: makeBootstrap(),
        healthPollIntervalMs: 10,
        healthStartupTimeoutMs: 5000,
      })

      expect(result.transport.type).toBe('local_http')
      expect(result.port).toBe(9100)
      expect(result.transport.rpcEndpoint).toBe('http://localhost:9100')
      expect(result.transport.eventStreamEndpoint).toBe('ws://localhost:9100/events')
      expect(result.process).toBeDefined()

      // Cleanup
      result.process.kill('SIGKILL')
      manager.cleanup('agent-1', result.port)
    }, 10_000)
  })

  describe('process management', () => {
    it('getProcess returns undefined for untracked agent', () => {
      const manager = new ChildProcessManager()
      expect(manager.getProcess('nonexistent')).toBeUndefined()
    })
  })
})
