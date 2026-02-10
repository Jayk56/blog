import { describe, expect, it } from 'vitest'

import {
  MCPProvisioner,
  createDefaultProvisioner,
  type BackendMCPServer,
  type ToolMCPMapping,
  type ResolvedMCPServer,
} from '../../src/gateway/mcp-provisioner'
import type { MCPServerConfig, WorkspaceMount } from '../../src/types/brief'

function makeMounts(): WorkspaceMount[] {
  return [
    { hostPath: '/host/src', sandboxPath: '/workspace/src', readOnly: false },
    { hostPath: '/host/docs', sandboxPath: '/workspace/docs', readOnly: true },
  ]
}

describe('MCPProvisioner', () => {
  describe('explicit MCP servers from brief', () => {
    it('passes through explicit stdio MCP server config', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        {
          name: 'custom-fs',
          transport: 'stdio',
          command: 'my-mcp-server',
          args: ['--mode', 'read-write'],
          env: { LOG_LEVEL: 'debug' },
        },
      ]

      const result = provisioner.provision(mcpServers, [], [], 'token-123')

      expect(result.servers).toHaveLength(1)
      expect(result.servers[0].name).toBe('custom-fs')
      expect(result.servers[0].transport).toBe('stdio')
      expect(result.servers[0].command).toBe('my-mcp-server')
      expect(result.servers[0].args).toEqual(['--mode', 'read-write'])
    })

    it('passes through network MCP server config', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        {
          name: 'remote-db',
          transport: 'sse',
          url: 'https://mcp.example.com/db',
          headers: { 'X-Custom': 'value' },
        },
      ]

      const result = provisioner.provision(mcpServers, [], [], 'token-123')

      expect(result.servers).toHaveLength(1)
      expect(result.servers[0].transport).toBe('sse')
      expect(result.servers[0].url).toBe('https://mcp.example.com/db')
      expect(result.servers[0].headers).toEqual({ 'X-Custom': 'value' })
    })

    it('defaults transport to stdio when not specified', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        { name: 'tool-server', command: 'my-tool' },
      ]

      const result = provisioner.provision(mcpServers, [], [], 'token')

      expect(result.servers[0].transport).toBe('stdio')
    })

    it('handles multiple explicit servers', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        { name: 'server-a', transport: 'stdio', command: 'a' },
        { name: 'server-b', transport: 'sse', url: 'https://b.com' },
        { name: 'server-c', transport: 'http', url: 'https://c.com' },
      ]

      const result = provisioner.provision(mcpServers, [], [], 'token')

      expect(result.servers).toHaveLength(3)
      expect(result.servers.map((s) => s.name)).toEqual([
        'server-a',
        'server-b',
        'server-c',
      ])
    })

    it('passes opaque config through', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        {
          name: 'custom',
          transport: 'stdio',
          command: 'custom-mcp',
          config: { maxFiles: 100, pattern: '*.ts' },
        },
      ]

      const result = provisioner.provision(mcpServers, [], [], 'token')

      expect(result.servers[0].config).toEqual({
        maxFiles: 100,
        pattern: '*.ts',
      })
    })
  })

  describe('filesystem scoping', () => {
    it('injects MCP_ALLOWED_PATHS for filesystem stdio servers', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        { name: 'filesystem', transport: 'stdio', command: 'mcp-server-filesystem' },
      ]

      const result = provisioner.provision(
        mcpServers,
        [],
        makeMounts(),
        'token'
      )

      expect(result.servers[0].env?.MCP_ALLOWED_PATHS).toBe(
        '/workspace/src:/workspace/docs'
      )
    })

    it('sets mount paths as args for filesystem servers with no args', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        { name: 'filesystem', transport: 'stdio', command: 'mcp-server-filesystem' },
      ]

      const result = provisioner.provision(
        mcpServers,
        [],
        makeMounts(),
        'token'
      )

      expect(result.servers[0].args).toEqual([
        '/workspace/src',
        '/workspace/docs',
      ])
    })

    it('preserves explicit args for filesystem servers', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        {
          name: 'filesystem',
          transport: 'stdio',
          command: 'mcp-server-filesystem',
          args: ['/custom/path'],
        },
      ]

      const result = provisioner.provision(
        mcpServers,
        [],
        makeMounts(),
        'token'
      )

      // Explicit args should be preserved
      expect(result.servers[0].args).toEqual(['/custom/path'])
    })

    it('does not scope non-filesystem stdio servers', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        { name: 'terminal', transport: 'stdio', command: 'mcp-server-terminal' },
      ]

      const result = provisioner.provision(
        mcpServers,
        [],
        makeMounts(),
        'token'
      )

      expect(result.servers[0].env?.MCP_ALLOWED_PATHS).toBeUndefined()
    })

    it('does not scope network transport servers', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        { name: 'filesystem', transport: 'sse', url: 'https://fs.com' },
      ]

      const result = provisioner.provision(
        mcpServers,
        [],
        makeMounts(),
        'token'
      )

      expect(result.servers[0].env).toBeUndefined()
    })

    it('handles empty mounts gracefully', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        { name: 'filesystem', transport: 'stdio', command: 'mcp-server-filesystem' },
      ]

      const result = provisioner.provision(mcpServers, [], [], 'token')

      // No scoping applied when no mounts
      expect(result.servers[0].env?.MCP_ALLOWED_PATHS).toBeUndefined()
    })

    it('detects filesystem servers by config.type', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        {
          name: 'my-fs',
          transport: 'stdio',
          command: 'custom-fs-server',
          config: { type: 'filesystem' },
        },
      ]

      const result = provisioner.provision(
        mcpServers,
        [],
        makeMounts(),
        'token'
      )

      expect(result.servers[0].env?.MCP_ALLOWED_PATHS).toBeDefined()
    })
  })

  describe('tool-based auto-provisioning', () => {
    it('auto-provisions MCP servers based on allowedTools', () => {
      const mappings: ToolMCPMapping[] = [
        {
          toolPattern: 'Read',
          serverTemplate: {
            name: 'filesystem',
            transport: 'stdio',
            command: 'mcp-server-filesystem',
          },
        },
      ]
      const provisioner = new MCPProvisioner(mappings)

      const result = provisioner.provision(
        undefined,
        ['Read', 'Write'],
        [],
        'token'
      )

      expect(result.servers).toHaveLength(1)
      expect(result.servers[0].name).toBe('filesystem')
    })

    it('does not auto-provision when tool is not in allowedTools', () => {
      const mappings: ToolMCPMapping[] = [
        {
          toolPattern: 'Read',
          serverTemplate: {
            name: 'filesystem',
            transport: 'stdio',
            command: 'mcp-server-filesystem',
          },
        },
      ]
      const provisioner = new MCPProvisioner(mappings)

      const result = provisioner.provision(
        undefined,
        ['Bash', 'Git'],
        [],
        'token'
      )

      expect(result.servers).toHaveLength(0)
    })

    it('deduplicates when explicit config overrides auto-provision', () => {
      const mappings: ToolMCPMapping[] = [
        {
          toolPattern: 'Read',
          serverTemplate: {
            name: 'filesystem',
            transport: 'stdio',
            command: 'mcp-server-filesystem',
          },
        },
      ]
      const provisioner = new MCPProvisioner(mappings)

      // Explicit config with the same name takes priority
      const mcpServers: MCPServerConfig[] = [
        {
          name: 'filesystem',
          transport: 'stdio',
          command: 'custom-fs',
          args: ['--custom'],
        },
      ]

      const result = provisioner.provision(
        mcpServers,
        ['Read'],
        [],
        'token'
      )

      expect(result.servers).toHaveLength(1)
      expect(result.servers[0].command).toBe('custom-fs') // explicit wins
    })

    it('deduplicates across multiple tool mappings to same server', () => {
      const mappings: ToolMCPMapping[] = [
        {
          toolPattern: 'Read',
          serverTemplate: {
            name: 'filesystem',
            transport: 'stdio',
            command: 'mcp-server-filesystem',
          },
        },
        {
          toolPattern: 'Write',
          serverTemplate: {
            name: 'filesystem',
            transport: 'stdio',
            command: 'mcp-server-filesystem',
          },
        },
        {
          toolPattern: 'Edit',
          serverTemplate: {
            name: 'filesystem',
            transport: 'stdio',
            command: 'mcp-server-filesystem',
          },
        },
      ]
      const provisioner = new MCPProvisioner(mappings)

      const result = provisioner.provision(
        undefined,
        ['Read', 'Write', 'Edit'],
        [],
        'token'
      )

      expect(result.servers).toHaveLength(1)
      expect(result.servers[0].name).toBe('filesystem')
    })

    it('supports prefix matching with * pattern', () => {
      const mappings: ToolMCPMapping[] = [
        {
          toolPattern: 'Web*',
          serverTemplate: {
            name: 'browser',
            transport: 'stdio',
            command: 'mcp-server-browser',
          },
        },
      ]
      const provisioner = new MCPProvisioner(mappings)

      const result = provisioner.provision(
        undefined,
        ['WebSearch', 'WebFetch'],
        [],
        'token'
      )

      expect(result.servers).toHaveLength(1)
      expect(result.servers[0].name).toBe('browser')
    })

    it('applies filesystem scoping to auto-provisioned servers', () => {
      const mappings: ToolMCPMapping[] = [
        {
          toolPattern: 'Read',
          serverTemplate: {
            name: 'filesystem',
            transport: 'stdio',
            command: 'mcp-server-filesystem',
          },
        },
      ]
      const provisioner = new MCPProvisioner(mappings)

      const result = provisioner.provision(
        undefined,
        ['Read'],
        makeMounts(),
        'token'
      )

      expect(result.servers[0].env?.MCP_ALLOWED_PATHS).toBe(
        '/workspace/src:/workspace/docs'
      )
    })
  })

  describe('backend-hosted servers', () => {
    it('includes backend servers with auth token', () => {
      const backendServers: BackendMCPServer[] = [
        {
          name: 'shared-db',
          transport: 'sse',
          url: 'http://localhost:3001/mcp/db',
          requiresAuth: true,
        },
      ]
      const provisioner = new MCPProvisioner([], backendServers)

      const result = provisioner.provision(
        undefined,
        [],
        [],
        'my-backend-token'
      )

      expect(result.servers).toHaveLength(1)
      expect(result.servers[0].name).toBe('shared-db')
      expect(result.servers[0].url).toBe('http://localhost:3001/mcp/db')
      expect(result.servers[0].headers).toEqual({
        Authorization: 'Bearer my-backend-token',
      })
    })

    it('does not inject auth header when not required', () => {
      const backendServers: BackendMCPServer[] = [
        {
          name: 'public-api',
          transport: 'http',
          url: 'http://localhost:3001/mcp/public',
          requiresAuth: false,
        },
      ]
      const provisioner = new MCPProvisioner([], backendServers)

      const result = provisioner.provision(
        undefined,
        [],
        [],
        'token'
      )

      expect(result.servers[0].headers).toBeUndefined()
    })

    it('deduplicates when explicit config overrides backend server', () => {
      const backendServers: BackendMCPServer[] = [
        {
          name: 'shared-db',
          transport: 'sse',
          url: 'http://localhost:3001/mcp/db',
          requiresAuth: true,
        },
      ]
      const provisioner = new MCPProvisioner([], backendServers)

      const mcpServers: MCPServerConfig[] = [
        {
          name: 'shared-db',
          transport: 'sse',
          url: 'http://custom-db:8080/mcp',
        },
      ]

      const result = provisioner.provision(
        mcpServers,
        [],
        [],
        'token'
      )

      expect(result.servers).toHaveLength(1)
      expect(result.servers[0].url).toBe('http://custom-db:8080/mcp') // explicit wins
    })
  })

  describe('env output', () => {
    it('produces valid JSON envValue', () => {
      const provisioner = new MCPProvisioner()
      const mcpServers: MCPServerConfig[] = [
        { name: 'test', transport: 'stdio', command: 'test-server' },
      ]

      const result = provisioner.provision(mcpServers, [], [], 'token')

      expect(result.envKey).toBe('MCP_SERVERS')
      const parsed = JSON.parse(result.envValue)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].name).toBe('test')
    })

    it('produces empty array when no servers', () => {
      const provisioner = new MCPProvisioner()

      const result = provisioner.provision(undefined, [], [], 'token')

      expect(result.servers).toHaveLength(0)
      expect(JSON.parse(result.envValue)).toEqual([])
    })
  })

  describe('runtime configuration', () => {
    it('addToolMapping adds a new mapping', () => {
      const provisioner = new MCPProvisioner()
      expect(provisioner.getToolMappings()).toHaveLength(0)

      provisioner.addToolMapping({
        toolPattern: 'CustomTool',
        serverTemplate: {
          name: 'custom',
          transport: 'stdio',
          command: 'custom-mcp',
        },
      })

      expect(provisioner.getToolMappings()).toHaveLength(1)

      const result = provisioner.provision(
        undefined,
        ['CustomTool'],
        [],
        'token'
      )
      expect(result.servers).toHaveLength(1)
    })

    it('addBackendServer adds a new backend server', () => {
      const provisioner = new MCPProvisioner()
      expect(provisioner.getBackendServers()).toHaveLength(0)

      provisioner.addBackendServer({
        name: 'dynamic',
        transport: 'sse',
        url: 'http://dynamic.com',
        requiresAuth: false,
      })

      expect(provisioner.getBackendServers()).toHaveLength(1)
    })
  })

  describe('priority ordering', () => {
    it('explicit > auto-provisioned > backend (dedup by name)', () => {
      const mappings: ToolMCPMapping[] = [
        {
          toolPattern: 'Read',
          serverTemplate: {
            name: 'filesystem',
            transport: 'stdio',
            command: 'auto-fs',
          },
        },
      ]
      const backendServers: BackendMCPServer[] = [
        {
          name: 'filesystem',
          transport: 'sse',
          url: 'http://backend-fs.com',
          requiresAuth: true,
        },
      ]
      const provisioner = new MCPProvisioner(mappings, backendServers)

      const mcpServers: MCPServerConfig[] = [
        {
          name: 'filesystem',
          transport: 'stdio',
          command: 'explicit-fs',
        },
      ]

      const result = provisioner.provision(
        mcpServers,
        ['Read'],
        [],
        'token'
      )

      expect(result.servers).toHaveLength(1)
      expect(result.servers[0].command).toBe('explicit-fs') // explicit wins
    })

    it('auto-provisioned > backend when no explicit config', () => {
      const mappings: ToolMCPMapping[] = [
        {
          toolPattern: 'Read',
          serverTemplate: {
            name: 'filesystem',
            transport: 'stdio',
            command: 'auto-fs',
          },
        },
      ]
      const backendServers: BackendMCPServer[] = [
        {
          name: 'filesystem',
          transport: 'sse',
          url: 'http://backend-fs.com',
          requiresAuth: true,
        },
      ]
      const provisioner = new MCPProvisioner(mappings, backendServers)

      const result = provisioner.provision(
        undefined,
        ['Read'],
        [],
        'token'
      )

      expect(result.servers).toHaveLength(1)
      expect(result.servers[0].command).toBe('auto-fs') // auto wins over backend
    })
  })
})

describe('createDefaultProvisioner', () => {
  it('creates provisioner with standard tool mappings', () => {
    const provisioner = createDefaultProvisioner()
    const mappings = provisioner.getToolMappings()

    expect(mappings.length).toBeGreaterThan(0)

    // Should map Read -> filesystem
    const readMapping = mappings.find((m) => m.toolPattern === 'Read')
    expect(readMapping).toBeDefined()
    expect(readMapping!.serverTemplate.name).toBe('filesystem')

    // Should map Bash -> terminal
    const bashMapping = mappings.find((m) => m.toolPattern === 'Bash')
    expect(bashMapping).toBeDefined()
    expect(bashMapping!.serverTemplate.name).toBe('terminal')

    // Should map Git -> git
    const gitMapping = mappings.find((m) => m.toolPattern === 'Git')
    expect(gitMapping).toBeDefined()
    expect(gitMapping!.serverTemplate.name).toBe('git')
  })

  it('provisions filesystem server for Read tool', () => {
    const provisioner = createDefaultProvisioner()

    const result = provisioner.provision(
      undefined,
      ['Read'],
      makeMounts(),
      'token'
    )

    expect(result.servers).toHaveLength(1)
    expect(result.servers[0].name).toBe('filesystem')
    expect(result.servers[0].command).toBe('mcp-server-filesystem')
    expect(result.servers[0].env?.MCP_ALLOWED_PATHS).toBeDefined()
  })

  it('provisions multiple servers for diverse tool set', () => {
    const provisioner = createDefaultProvisioner()

    const result = provisioner.provision(
      undefined,
      ['Read', 'Write', 'Bash', 'Git', 'WebSearch'],
      [],
      'token'
    )

    const names = result.servers.map((s) => s.name)
    expect(names).toContain('filesystem')
    expect(names).toContain('terminal')
    expect(names).toContain('git')
    expect(names).toContain('browser')
    // Deduplication: only one filesystem despite Read+Write
    expect(names.filter((n) => n === 'filesystem')).toHaveLength(1)
  })

  it('provisions nothing for unknown tools', () => {
    const provisioner = createDefaultProvisioner()

    const result = provisioner.provision(
      undefined,
      ['CustomAnalyze', 'Deploy'],
      [],
      'token'
    )

    expect(result.servers).toHaveLength(0)
  })
})
