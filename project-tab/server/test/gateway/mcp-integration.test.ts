import { describe, expect, it, vi } from 'vitest'

import {
  ContainerPlugin,
} from '../../src/gateway/container-plugin'
import { ContainerOrchestrator } from '../../src/gateway/container-orchestrator'
import { MCPProvisioner, createDefaultProvisioner } from '../../src/gateway/mcp-provisioner'
import type {
  AgentBrief,
  AgentHandle,
  ContainerTransport,
} from '../../src/types'

function makeHandle(overrides: Partial<AgentHandle> = {}): AgentHandle {
  return {
    id: 'agent-mcp',
    pluginName: 'openai-container',
    status: 'running',
    sessionId: 'session-mcp',
    ...overrides,
  }
}

function makeMinimalBrief(overrides: Partial<AgentBrief> = {}): AgentBrief {
  return {
    agentId: 'agent-mcp',
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
      description: 'Test',
      goals: ['ship'],
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
    allowedTools: ['Read', 'Write', 'Bash'],
    ...overrides,
  }
}

function makeTransport(): ContainerTransport {
  return {
    type: 'container',
    sandboxId: 'sandbox-agent-mcp-abc123',
    rpcEndpoint: 'http://localhost:9200',
    eventStreamEndpoint: 'ws://localhost:9200/events',
    healthEndpoint: 'http://localhost:9200/health',
  }
}

function makeMockOrchestrator(): ContainerOrchestrator {
  const orch = new ContainerOrchestrator(
    {} as import('dockerode'),
    vi.fn() as unknown as typeof globalThis.fetch
  )
  vi.spyOn(orch, 'createSandbox').mockResolvedValue({
    containerId: 'abc123',
    transport: makeTransport(),
    port: 9200,
  })
  vi.spyOn(orch, 'cleanup').mockResolvedValue(undefined)
  vi.spyOn(orch, 'onExit').mockImplementation(() => {})
  return orch
}

function spawnFetch(): typeof globalThis.fetch {
  return vi.fn(async () => {
    return new Response(JSON.stringify(makeHandle()), { status: 200 })
  }) as unknown as typeof globalThis.fetch
}

describe('ContainerPlugin + MCPProvisioner integration', () => {
  it('injects MCP_SERVERS env when provisioner is configured', async () => {
    const orchestrator = makeMockOrchestrator()
    const provisioner = createDefaultProvisioner()

    const plugin = new ContainerPlugin({
      name: 'openai-container',
      version: '1.0.0',
      capabilities: {
        supportsPause: true,
        supportsResume: true,
        supportsKill: true,
        supportsHotBriefUpdate: false,
      },
      orchestrator,
      image: 'project-tab/adapter-openai:latest',
      backendUrl: 'http://localhost:3001',
      generateToken: async () => ({
        token: 'test-token',
        expiresAt: '2026-02-12T00:00:00.000Z',
      }),
      fetchFn: spawnFetch(),
      mcpProvisioner: provisioner,
    })

    await plugin.spawn(makeMinimalBrief())

    // Verify createSandbox was called with env containing MCP_SERVERS
    const createCall = (
      orchestrator.createSandbox as ReturnType<typeof vi.fn>
    ).mock.calls[0]
    const options = createCall[1]
    expect(options.env).toBeDefined()
    expect(options.env.MCP_SERVERS).toBeDefined()

    const mcpServers = JSON.parse(options.env.MCP_SERVERS)
    expect(Array.isArray(mcpServers)).toBe(true)

    // Read + Write -> filesystem, Bash -> terminal
    const names = mcpServers.map((s: { name: string }) => s.name)
    expect(names).toContain('filesystem')
    expect(names).toContain('terminal')
  })

  it('does not inject MCP_SERVERS env when no provisioner', async () => {
    const orchestrator = makeMockOrchestrator()

    const plugin = new ContainerPlugin({
      name: 'openai-container',
      version: '1.0.0',
      capabilities: {
        supportsPause: true,
        supportsResume: true,
        supportsKill: true,
        supportsHotBriefUpdate: false,
      },
      orchestrator,
      image: 'project-tab/adapter-openai:latest',
      backendUrl: 'http://localhost:3001',
      generateToken: async () => ({
        token: 'test-token',
        expiresAt: '2026-02-12T00:00:00.000Z',
      }),
      fetchFn: spawnFetch(),
      // No mcpProvisioner
    })

    await plugin.spawn(makeMinimalBrief())

    const createCall = (
      orchestrator.createSandbox as ReturnType<typeof vi.fn>
    ).mock.calls[0]
    const options = createCall[1]
    expect(options.env).toBeUndefined()
  })

  it('uses brief.mcpServers when provided', async () => {
    const orchestrator = makeMockOrchestrator()
    const provisioner = new MCPProvisioner()

    const plugin = new ContainerPlugin({
      name: 'openai-container',
      version: '1.0.0',
      capabilities: {
        supportsPause: true,
        supportsResume: true,
        supportsKill: true,
        supportsHotBriefUpdate: false,
      },
      orchestrator,
      image: 'project-tab/adapter-openai:latest',
      backendUrl: 'http://localhost:3001',
      generateToken: async () => ({
        token: 'test-token',
        expiresAt: '2026-02-12T00:00:00.000Z',
      }),
      fetchFn: spawnFetch(),
      mcpProvisioner: provisioner,
    })

    const brief = makeMinimalBrief({
      mcpServers: [
        {
          name: 'custom-tool',
          transport: 'stdio',
          command: 'my-custom-mcp',
          args: ['--verbose'],
        },
      ],
    })

    await plugin.spawn(brief)

    const createCall = (
      orchestrator.createSandbox as ReturnType<typeof vi.fn>
    ).mock.calls[0]
    const options = createCall[1]
    const mcpServers = JSON.parse(options.env.MCP_SERVERS)

    expect(mcpServers).toHaveLength(1)
    expect(mcpServers[0].name).toBe('custom-tool')
    expect(mcpServers[0].command).toBe('my-custom-mcp')
  })

  it('applies filesystem scoping from workspace mounts', async () => {
    const orchestrator = makeMockOrchestrator()
    const provisioner = createDefaultProvisioner()

    const plugin = new ContainerPlugin({
      name: 'openai-container',
      version: '1.0.0',
      capabilities: {
        supportsPause: true,
        supportsResume: true,
        supportsKill: true,
        supportsHotBriefUpdate: false,
      },
      orchestrator,
      image: 'project-tab/adapter-openai:latest',
      backendUrl: 'http://localhost:3001',
      generateToken: async () => ({
        token: 'test-token',
        expiresAt: '2026-02-12T00:00:00.000Z',
      }),
      fetchFn: spawnFetch(),
      mcpProvisioner: provisioner,
    })

    const brief = makeMinimalBrief({
      workspaceRequirements: {
        mounts: [
          {
            hostPath: '/host/project',
            sandboxPath: '/workspace/project',
            readOnly: false,
          },
        ],
        capabilities: ['terminal'],
      },
    })

    await plugin.spawn(brief)

    const createCall = (
      orchestrator.createSandbox as ReturnType<typeof vi.fn>
    ).mock.calls[0]
    const options = createCall[1]
    const mcpServers = JSON.parse(options.env.MCP_SERVERS)

    const fsServer = mcpServers.find(
      (s: { name: string }) => s.name === 'filesystem'
    )
    expect(fsServer).toBeDefined()
    expect(fsServer.env.MCP_ALLOWED_PATHS).toBe('/workspace/project')
    expect(fsServer.args).toEqual(['/workspace/project'])
  })

  it('uses backend token for authenticated backend MCP servers', async () => {
    const orchestrator = makeMockOrchestrator()
    const provisioner = new MCPProvisioner([], [
      {
        name: 'shared-knowledge',
        transport: 'sse',
        url: 'http://localhost:3001/mcp/knowledge',
        requiresAuth: true,
      },
    ])

    const plugin = new ContainerPlugin({
      name: 'openai-container',
      version: '1.0.0',
      capabilities: {
        supportsPause: true,
        supportsResume: true,
        supportsKill: true,
        supportsHotBriefUpdate: false,
      },
      orchestrator,
      image: 'project-tab/adapter-openai:latest',
      backendUrl: 'http://localhost:3001',
      generateToken: async () => ({
        token: 'agent-specific-token',
        expiresAt: '2026-02-12T00:00:00.000Z',
      }),
      fetchFn: spawnFetch(),
      mcpProvisioner: provisioner,
    })

    await plugin.spawn(makeMinimalBrief({ allowedTools: [] }))

    const createCall = (
      orchestrator.createSandbox as ReturnType<typeof vi.fn>
    ).mock.calls[0]
    const options = createCall[1]
    const mcpServers = JSON.parse(options.env.MCP_SERVERS)

    const knowledgeServer = mcpServers.find(
      (s: { name: string }) => s.name === 'shared-knowledge'
    )
    expect(knowledgeServer).toBeDefined()
    expect(knowledgeServer.headers.Authorization).toBe(
      'Bearer agent-specific-token'
    )
  })
})
