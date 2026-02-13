import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChildProcessManager } from '../../src/gateway/child-process-manager'
import type { SandboxBootstrap } from '../../src/types'

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
  describe('cleanup', () => {
    it('removes tracking on cleanup', () => {
      const manager = new ChildProcessManager()
      manager.cleanup('agent-1')
      // Should not throw
      expect(manager.getProcess('agent-1')).toBeUndefined()
    })
  })

  describe('spawnShim', () => {
    it('fails when child exits before announcing port', async () => {
      const fetchMock = vi.fn(async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof globalThis.fetch

      const manager = new ChildProcessManager(fetchMock)

      await expect(
        manager.spawnShim('agent-1', {
          command: 'sh',
          args: ['-c', 'echo "no port here" && exit 1'],
          bootstrap: makeBootstrap(),
          healthPollIntervalMs: 10,
          healthStartupTimeoutMs: 5000,
        })
      ).rejects.toThrow('exited before announcing port')
    }, 10_000)

    it('fails when health poll times out after port announcement', async () => {
      const fetchMock = vi.fn(async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof globalThis.fetch

      const manager = new ChildProcessManager(fetchMock)

      await expect(
        manager.spawnShim('agent-1', {
          command: 'sh',
          args: ['-c', 'echo \'{"port":9999}\' && sleep 60'],
          bootstrap: makeBootstrap(),
          healthPollIntervalMs: 10,
          healthStartupTimeoutMs: 50,
        })
      ).rejects.toThrow('did not become healthy within 50ms')
    }, 10_000)

    it('succeeds when child announces port and health poll returns ok', async () => {
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
        command: 'sh',
        args: ['-c', 'echo \'{"port":9999}\' && sleep 60'],
        bootstrap: makeBootstrap(),
        healthPollIntervalMs: 10,
        healthStartupTimeoutMs: 5000,
      })

      expect(result.transport.type).toBe('local_http')
      expect(result.port).toBe(9999)
      expect(result.transport.rpcEndpoint).toBe('http://localhost:9999')
      expect(result.transport.eventStreamEndpoint).toBe('ws://localhost:9999/events')
      expect(result.process).toBeDefined()

      // Cleanup
      result.process.kill('SIGKILL')
      manager.cleanup('agent-1')
    }, 10_000)
  })

  describe('process management', () => {
    it('getProcess returns undefined for untracked agent', () => {
      const manager = new ChildProcessManager()
      expect(manager.getProcess('nonexistent')).toBeUndefined()
    })
  })
})
