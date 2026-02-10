import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ContainerOrchestrator,
  type ContainerCreateOptions,
} from '../../src/gateway/container-orchestrator'
import type { SandboxBootstrap } from '../../src/types'

// ---- Mock Docker types ----

interface MockContainer {
  id: string
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  wait: ReturnType<typeof vi.fn>
}

interface MockDocker {
  createContainer: ReturnType<typeof vi.fn>
  getContainer: ReturnType<typeof vi.fn>
}

function makeMockContainer(id = 'abc123def456'): MockContainer {
  return {
    id,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    wait: vi.fn(() => new Promise(() => {})), // Never resolves by default
  }
}

function makeMockDocker(container?: MockContainer): MockDocker {
  const c = container ?? makeMockContainer()
  return {
    createContainer: vi.fn(async () => c),
    getContainer: vi.fn(() => c),
  }
}

function makeBootstrap(agentId = 'agent-1'): SandboxBootstrap {
  return {
    backendUrl: 'http://localhost:3001',
    backendToken: 'test-token',
    tokenExpiresAt: '2026-02-11T00:00:00.000Z',
    agentId,
    artifactUploadEndpoint: 'http://localhost:3001/api/artifacts',
  }
}

function makeOptions(
  overrides: Partial<ContainerCreateOptions> = {}
): ContainerCreateOptions {
  return {
    image: 'project-tab/adapter-openai:latest',
    bootstrap: makeBootstrap(),
    healthPollIntervalMs: 10,
    healthStartupTimeoutMs: 100,
    ...overrides,
  }
}

/** Mock fetch that returns healthy on first call. */
function healthyFetch(): typeof globalThis.fetch {
  return vi.fn(async () => {
    return new Response('{"status":"healthy"}', { status: 200 })
  }) as unknown as typeof globalThis.fetch
}

/** Mock fetch that always rejects (connection refused). */
function failingFetch(): typeof globalThis.fetch {
  return vi.fn(async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof globalThis.fetch
}

/** Mock fetch that fails N times then succeeds. */
function eventuallyHealthyFetch(failCount: number): typeof globalThis.fetch {
  let calls = 0
  return vi.fn(async () => {
    calls++
    if (calls <= failCount) {
      throw new TypeError('connection refused')
    }
    return new Response('{"status":"healthy"}', { status: 200 })
  }) as unknown as typeof globalThis.fetch
}

describe('ContainerOrchestrator', () => {
  describe('port allocation', () => {
    let orchestrator: ContainerOrchestrator

    beforeEach(() => {
      orchestrator = new ContainerOrchestrator(
        makeMockDocker() as unknown as import('dockerode'),
        healthyFetch()
      )
    })

    it('allocates ports starting at 9200', () => {
      const port = orchestrator.allocatePort()
      expect(port).toBe(9200)
    })

    it('allocates sequential ports', () => {
      const p1 = orchestrator.allocatePort()
      const p2 = orchestrator.allocatePort()
      const p3 = orchestrator.allocatePort()

      expect(p1).toBe(9200)
      expect(p2).toBe(9201)
      expect(p3).toBe(9202)
    })

    it('reuses released ports', () => {
      const p1 = orchestrator.allocatePort()
      const p2 = orchestrator.allocatePort()

      orchestrator.releasePort(p1)

      const p3 = orchestrator.allocatePort()
      expect(p3).toBe(p1) // Reuses port 9200
    })

    it('throws when all ports are exhausted', () => {
      // Allocate all 100 ports (9200-9299)
      for (let i = 0; i < 100; i++) {
        orchestrator.allocatePort()
      }

      expect(() => orchestrator.allocatePort()).toThrow(
        'No ports available in range 9200-9299'
      )
    })
  })

  describe('createSandbox', () => {
    it('creates and starts a container with correct config', async () => {
      const container = makeMockContainer()
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      const result = await orchestrator.createSandbox('agent-1', makeOptions())

      expect(docker.createContainer).toHaveBeenCalledOnce()
      expect(container.start).toHaveBeenCalledOnce()

      // Check container config
      const createCall = docker.createContainer.mock.calls[0][0]
      expect(createCall.Image).toBe('project-tab/adapter-openai:latest')
      expect(createCall.ExposedPorts).toEqual({ '8080/tcp': {} })
      expect(createCall.Labels['project-tab.agent-id']).toBe('agent-1')
      expect(createCall.Labels['project-tab.managed']).toBe('true')
    })

    it('injects bootstrap as environment variable', async () => {
      const container = makeMockContainer()
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      const bootstrap = makeBootstrap()
      await orchestrator.createSandbox(
        'agent-1',
        makeOptions({ bootstrap })
      )

      const createCall = docker.createContainer.mock.calls[0][0]
      const envArr = createCall.Env as string[]
      const bootstrapEnv = envArr.find((e: string) =>
        e.startsWith('AGENT_BOOTSTRAP=')
      )
      expect(bootstrapEnv).toBeDefined()
      const parsed = JSON.parse(bootstrapEnv!.replace('AGENT_BOOTSTRAP=', ''))
      expect(parsed.agentId).toBe('agent-1')
      expect(parsed.backendToken).toBe('test-token')
    })

    it('sets AGENT_PORT to 8080 (container internal port)', async () => {
      const container = makeMockContainer()
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      await orchestrator.createSandbox('agent-1', makeOptions())

      const createCall = docker.createContainer.mock.calls[0][0]
      const envArr = createCall.Env as string[]
      expect(envArr).toContain('AGENT_PORT=8080')
    })

    it('maps container port 8080 to allocated host port', async () => {
      const container = makeMockContainer()
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      const result = await orchestrator.createSandbox('agent-1', makeOptions())

      expect(result.port).toBe(9200)
      const createCall = docker.createContainer.mock.calls[0][0]
      expect(createCall.HostConfig.PortBindings).toEqual({
        '8080/tcp': [{ HostPort: '9200' }],
      })
    })

    it('returns ContainerTransport with correct endpoints', async () => {
      const container = makeMockContainer('deadbeef1234')
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      const result = await orchestrator.createSandbox('agent-1', makeOptions())

      expect(result.transport.type).toBe('container')
      expect(result.transport.sandboxId).toBe(
        'sandbox-agent-1-deadbeef1234'
      )
      expect(result.transport.rpcEndpoint).toBe('http://localhost:9200')
      expect(result.transport.eventStreamEndpoint).toBe(
        'ws://localhost:9200/events'
      )
      expect(result.transport.healthEndpoint).toBe(
        'http://localhost:9200/health'
      )
    })

    it('mounts persistent volume at /workspace', async () => {
      const container = makeMockContainer()
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      await orchestrator.createSandbox('agent-1', makeOptions())

      const createCall = docker.createContainer.mock.calls[0][0]
      const binds = createCall.HostConfig.Binds as string[]
      expect(binds).toContain(
        'project-tab-workspace-agent-1:/workspace'
      )
    })

    it('applies workspace requirement mounts with correct modes', async () => {
      const container = makeMockContainer()
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      await orchestrator.createSandbox(
        'agent-1',
        makeOptions({
          workspaceRequirements: {
            mounts: [
              {
                hostPath: '/host/code',
                sandboxPath: '/sandbox/code',
                readOnly: true,
              },
              {
                hostPath: '/host/data',
                sandboxPath: '/sandbox/data',
                readOnly: false,
              },
            ],
            capabilities: ['terminal', 'git'],
          },
        })
      )

      const createCall = docker.createContainer.mock.calls[0][0]
      const binds = createCall.HostConfig.Binds as string[]
      expect(binds).toContain('/host/code:/sandbox/code:ro')
      expect(binds).toContain('/host/data:/sandbox/data:rw')
    })

    it('applies resource limits from workspace requirements', async () => {
      const container = makeMockContainer()
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      await orchestrator.createSandbox(
        'agent-1',
        makeOptions({
          workspaceRequirements: {
            mounts: [],
            capabilities: [],
            resourceLimits: {
              cpuCores: 2,
              memoryMb: 1024,
            },
          },
        })
      )

      const createCall = docker.createContainer.mock.calls[0][0]
      expect(createCall.HostConfig.Memory).toBe(1024 * 1024 * 1024) // 1024 MB
      expect(createCall.HostConfig.NanoCpus).toBe(2 * 1e9)
    })

    it('uses default resource limits when none specified', async () => {
      const container = makeMockContainer()
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      await orchestrator.createSandbox('agent-1', makeOptions())

      const createCall = docker.createContainer.mock.calls[0][0]
      expect(createCall.HostConfig.Memory).toBe(512 * 1024 * 1024) // 512 MB default
      expect(createCall.HostConfig.NanoCpus).toBe(1 * 1e9) // 1 CPU default
    })

    it('passes extra env vars to container', async () => {
      const container = makeMockContainer()
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      await orchestrator.createSandbox(
        'agent-1',
        makeOptions({
          env: { MODEL: 'gpt-4', API_KEY: 'sk-test' },
        })
      )

      const createCall = docker.createContainer.mock.calls[0][0]
      const envArr = createCall.Env as string[]
      expect(envArr).toContain('MODEL=gpt-4')
      expect(envArr).toContain('API_KEY=sk-test')
    })

    it('fails when health poll times out', async () => {
      const container = makeMockContainer()
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        failingFetch()
      )

      await expect(
        orchestrator.createSandbox(
          'agent-1',
          makeOptions({
            healthPollIntervalMs: 10,
            healthStartupTimeoutMs: 50,
          })
        )
      ).rejects.toThrow('did not become healthy within 50ms')

      // Container should be cleaned up
      expect(container.stop).toHaveBeenCalledWith({ t: 0 })
      expect(container.remove).toHaveBeenCalledWith({ force: true })
    }, 10_000)

    it('releases port when health poll times out', async () => {
      const container = makeMockContainer()
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        failingFetch()
      )

      try {
        await orchestrator.createSandbox(
          'agent-1',
          makeOptions({
            healthPollIntervalMs: 10,
            healthStartupTimeoutMs: 50,
          })
        )
      } catch {
        // expected
      }

      // Port should be reusable
      const port = orchestrator.allocatePort()
      expect(port).toBe(9200)
    }, 10_000)

    it('succeeds when health poll eventually returns ok', async () => {
      const container = makeMockContainer()
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        eventuallyHealthyFetch(3)
      )

      const result = await orchestrator.createSandbox(
        'agent-1',
        makeOptions({
          healthPollIntervalMs: 10,
          healthStartupTimeoutMs: 5000,
        })
      )

      expect(result.transport.type).toBe('container')
      expect(result.containerId).toBe('abc123def456')
    }, 10_000)

    it('releases port on docker create failure', async () => {
      const docker = {
        createContainer: vi.fn(async () => {
          throw new Error('image not found')
        }),
        getContainer: vi.fn(),
      }
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      await expect(
        orchestrator.createSandbox('agent-1', makeOptions())
      ).rejects.toThrow('image not found')

      // Port should be reusable
      const port = orchestrator.allocatePort()
      expect(port).toBe(9200)
    })

    it('allocates different ports for different agents', async () => {
      const docker = makeMockDocker()
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      const r1 = await orchestrator.createSandbox('agent-1', makeOptions())
      const r2 = await orchestrator.createSandbox('agent-2', makeOptions())

      expect(r1.port).toBe(9200)
      expect(r2.port).toBe(9201)
    })
  })

  describe('container lifecycle', () => {
    let docker: MockDocker
    let container: MockContainer
    let orchestrator: ContainerOrchestrator

    beforeEach(async () => {
      container = makeMockContainer()
      docker = makeMockDocker(container)
      orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )
      // Pre-create a sandbox
      await orchestrator.createSandbox('agent-1', makeOptions())
    })

    it('stopContainer calls container.stop with timeout', async () => {
      await orchestrator.stopContainer('agent-1', 15)

      expect(docker.getContainer).toHaveBeenCalledWith('abc123def456')
      expect(container.stop).toHaveBeenCalledWith({ t: 15 })
    })

    it('stopContainer uses default 10s timeout', async () => {
      await orchestrator.stopContainer('agent-1')

      expect(container.stop).toHaveBeenCalledWith({ t: 10 })
    })

    it('stopContainer is no-op for unknown agent', async () => {
      await orchestrator.stopContainer('nonexistent')
      // Should not throw
    })

    it('killContainer calls container.kill', async () => {
      await orchestrator.killContainer('agent-1')

      expect(docker.getContainer).toHaveBeenCalledWith('abc123def456')
      expect(container.kill).toHaveBeenCalledOnce()
    })

    it('killContainer is no-op for unknown agent', async () => {
      await orchestrator.killContainer('nonexistent')
      // Should not throw
    })

    it('destroyContainer removes container and cleans up tracking', async () => {
      await orchestrator.destroyContainer('agent-1')

      expect(container.remove).toHaveBeenCalledWith({ force: true })
      expect(orchestrator.getContainerId('agent-1')).toBeUndefined()
    })

    it('destroyContainer is no-op for unknown agent', async () => {
      await orchestrator.destroyContainer('nonexistent')
      // Should not throw
    })

    it('cleanup destroys container and releases port', async () => {
      await orchestrator.cleanup('agent-1', 9200)

      expect(container.remove).toHaveBeenCalledWith({ force: true })
      expect(orchestrator.getContainerId('agent-1')).toBeUndefined()

      // Port should be reusable
      const port = orchestrator.allocatePort()
      expect(port).toBe(9200)
    })

    it('getContainerId returns containerId for tracked agent', () => {
      expect(orchestrator.getContainerId('agent-1')).toBe('abc123def456')
    })

    it('getContainerId returns undefined for unknown agent', () => {
      expect(orchestrator.getContainerId('nonexistent')).toBeUndefined()
    })
  })

  describe('exit monitoring', () => {
    it('calls exit listeners when container exits', async () => {
      let resolveWait: (data: { StatusCode: number }) => void
      const container: MockContainer = {
        ...makeMockContainer(),
        wait: vi.fn(
          () =>
            new Promise<{ StatusCode: number }>((resolve) => {
              resolveWait = resolve
            })
        ),
      }
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      await orchestrator.createSandbox('agent-1', makeOptions())

      const exitListener = vi.fn()
      orchestrator.onExit('agent-1', exitListener)

      // Simulate container exit
      resolveWait!({ StatusCode: 1 })

      // Wait for the promise chain to settle
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(exitListener).toHaveBeenCalledWith(1)
    })

    it('calls multiple exit listeners', async () => {
      let resolveWait: (data: { StatusCode: number }) => void
      const container: MockContainer = {
        ...makeMockContainer(),
        wait: vi.fn(
          () =>
            new Promise<{ StatusCode: number }>((resolve) => {
              resolveWait = resolve
            })
        ),
      }
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      await orchestrator.createSandbox('agent-1', makeOptions())

      const listener1 = vi.fn()
      const listener2 = vi.fn()
      orchestrator.onExit('agent-1', listener1)
      orchestrator.onExit('agent-1', listener2)

      resolveWait!({ StatusCode: 0 })
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(listener1).toHaveBeenCalledWith(0)
      expect(listener2).toHaveBeenCalledWith(0)
    })
  })

  describe('error resilience', () => {
    it('handles container.stop failure gracefully in stopContainer', async () => {
      const container = makeMockContainer()
      container.stop.mockRejectedValueOnce(new Error('already stopped'))
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      await orchestrator.createSandbox('agent-1', makeOptions())

      // Should not throw
      await orchestrator.stopContainer('agent-1')
    })

    it('handles container.kill failure gracefully in killContainer', async () => {
      const container = makeMockContainer()
      container.kill.mockRejectedValueOnce(new Error('already dead'))
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      await orchestrator.createSandbox('agent-1', makeOptions())

      // Should not throw
      await orchestrator.killContainer('agent-1')
    })

    it('handles container.remove failure gracefully in destroyContainer', async () => {
      const container = makeMockContainer()
      container.remove.mockRejectedValueOnce(new Error('already removed'))
      const docker = makeMockDocker(container)
      const orchestrator = new ContainerOrchestrator(
        docker as unknown as import('dockerode'),
        healthyFetch()
      )

      await orchestrator.createSandbox('agent-1', makeOptions())

      // Should not throw
      await orchestrator.destroyContainer('agent-1')
    })
  })
})
