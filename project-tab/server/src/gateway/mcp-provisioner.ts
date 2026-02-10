/**
 * MCP Server Provisioner for sandbox-local MCP configuration.
 *
 * At container provision time, resolves which MCP servers to start inside
 * each agent's sandbox based on AgentBrief.mcpServers, allowedTools,
 * and workspace mounts. Generates the environment config that the adapter
 * shim reads to start MCP servers alongside the agent process.
 *
 * Two transport modes:
 * - **stdio**: MCP servers run inside the sandbox as child processes of the
 *   adapter shim. Config includes command, args, and env. Filesystem-scoped
 *   to the agent's mounted paths.
 * - **network** (sse/http/ws): MCP servers run on the backend. Config includes
 *   the backend URL endpoint, authenticated with the sandbox's backendToken.
 */

import type { MCPServerConfig, WorkspaceMount } from '../types/brief'

/** A resolved MCP server ready for injection into a sandbox. */
export interface ResolvedMCPServer {
  name: string
  transport: 'stdio' | 'http' | 'sse' | 'ws'
  /** For stdio: command to run inside the container. */
  command?: string
  /** For stdio: arguments to the command. */
  args?: string[]
  /** For stdio: environment variables for the MCP server process. */
  env?: Record<string, string>
  /** For network: URL endpoint to connect to. */
  url?: string
  /** For network: HTTP headers (e.g., Authorization). */
  headers?: Record<string, string>
  /** Additional opaque config forwarded to the adapter shim. */
  config?: Record<string, unknown>
}

/** Result of provisioning MCP servers for an agent sandbox. */
export interface MCPProvisionResult {
  /** Resolved MCP server configs to inject into the sandbox. */
  servers: ResolvedMCPServer[]
  /** Environment variable containing the JSON-serialized server list. */
  envKey: string
  /** The JSON string to set as the env value. */
  envValue: string
}

/** Registry entry for a backend-hosted MCP server. */
export interface BackendMCPServer {
  name: string
  transport: 'http' | 'sse' | 'ws'
  /** Base URL of the backend MCP server endpoint. */
  url: string
  /** Whether to inject the sandbox's backendToken as Authorization header. */
  requiresAuth: boolean
}

/** Known tool-to-MCP-server mapping for auto-provisioning. */
export interface ToolMCPMapping {
  /** Tool name pattern (exact match or prefix with '*' suffix). */
  toolPattern: string
  /** MCP server config template to provision when the tool is allowed. */
  serverTemplate: Omit<ResolvedMCPServer, 'name'> & { name: string }
}

/**
 * MCPProvisioner resolves MCP server configurations for agent sandboxes.
 *
 * It combines three sources:
 * 1. Explicit `AgentBrief.mcpServers` — always included
 * 2. Tool-based auto-provisioning — maps allowedTools to default MCP servers
 * 3. Backend-hosted servers — network-accessible shared MCP servers
 */
export class MCPProvisioner {
  private readonly toolMappings: ToolMCPMapping[]
  private readonly backendServers: BackendMCPServer[]

  constructor(
    toolMappings: ToolMCPMapping[] = [],
    backendServers: BackendMCPServer[] = []
  ) {
    this.toolMappings = toolMappings
    this.backendServers = backendServers
  }

  /**
   * Provision MCP servers for an agent sandbox.
   *
   * @param mcpServers Explicit MCP server configs from AgentBrief
   * @param allowedTools Tool names the agent is allowed to use
   * @param mounts Workspace mounts for filesystem scoping
   * @param backendToken Token for authenticating network MCP connections
   * @returns MCPProvisionResult with resolved servers and env config
   */
  provision(
    mcpServers: MCPServerConfig[] | undefined,
    allowedTools: string[],
    mounts: WorkspaceMount[],
    backendToken: string
  ): MCPProvisionResult {
    const servers: ResolvedMCPServer[] = []
    const seenNames = new Set<string>()

    // 1. Explicit MCP servers from the brief (highest priority)
    if (mcpServers) {
      for (const config of mcpServers) {
        const resolved = this.resolveExplicitServer(config, mounts)
        servers.push(resolved)
        seenNames.add(resolved.name)
      }
    }

    // 2. Auto-provision from allowedTools (skip if already explicitly configured)
    for (const mapping of this.toolMappings) {
      if (seenNames.has(mapping.serverTemplate.name)) continue

      if (this.matchesTool(mapping.toolPattern, allowedTools)) {
        const resolved = this.applyFilesystemScoping(
          { ...mapping.serverTemplate },
          mounts
        )
        servers.push(resolved)
        seenNames.add(resolved.name)
      }
    }

    // 3. Backend-hosted servers (skip if already explicitly configured)
    for (const backendServer of this.backendServers) {
      if (seenNames.has(backendServer.name)) continue

      // Only include backend servers if the agent has tools that might need them
      const resolved: ResolvedMCPServer = {
        name: backendServer.name,
        transport: backendServer.transport,
        url: backendServer.url,
        headers: backendServer.requiresAuth
          ? { Authorization: `Bearer ${backendToken}` }
          : undefined
      }
      servers.push(resolved)
      seenNames.add(resolved.name)
    }

    const envValue = JSON.stringify(servers)

    return {
      servers,
      envKey: 'MCP_SERVERS',
      envValue
    }
  }

  /** Register a new tool-to-MCP mapping at runtime. */
  addToolMapping(mapping: ToolMCPMapping): void {
    this.toolMappings.push(mapping)
  }

  /** Register a backend-hosted MCP server. */
  addBackendServer(server: BackendMCPServer): void {
    this.backendServers.push(server)
  }

  /** Get the current tool mappings (for inspection/testing). */
  getToolMappings(): readonly ToolMCPMapping[] {
    return this.toolMappings
  }

  /** Get the current backend servers (for inspection/testing). */
  getBackendServers(): readonly BackendMCPServer[] {
    return this.backendServers
  }

  /**
   * Resolve an explicit MCPServerConfig from the brief into a ResolvedMCPServer.
   * Applies filesystem scoping for stdio servers.
   */
  private resolveExplicitServer(
    config: MCPServerConfig,
    mounts: WorkspaceMount[]
  ): ResolvedMCPServer {
    const transport = config.transport ?? 'stdio'

    const resolved: ResolvedMCPServer = {
      name: config.name,
      transport: transport as ResolvedMCPServer['transport'],
      command: config.command,
      args: config.args,
      env: config.env,
      url: config.url,
      headers: config.headers,
      config: config.config
    }

    if (transport === 'stdio') {
      return this.applyFilesystemScoping(resolved, mounts)
    }

    return resolved
  }

  /**
   * Apply filesystem scoping to a stdio MCP server.
   *
   * For filesystem-type MCP servers, restricts the allowed directories
   * to only the paths that are mounted into the sandbox. This ensures
   * the MCP server can only access files the agent is allowed to see.
   */
  private applyFilesystemScoping(
    server: ResolvedMCPServer,
    mounts: WorkspaceMount[]
  ): ResolvedMCPServer {
    if (server.transport !== 'stdio') return server

    // If this is a filesystem MCP server, inject allowed paths from mounts
    const isFilesystemServer = server.name === 'filesystem' ||
      server.config?.type === 'filesystem' ||
      (server.command && server.command.includes('filesystem'))

    if (isFilesystemServer && mounts.length > 0) {
      const allowedPaths = mounts.map((m) => m.sandboxPath)
      server.env = {
        ...server.env,
        MCP_ALLOWED_PATHS: allowedPaths.join(':')
      }
      // Also pass as args if no args are specified (common pattern for FS servers)
      if (!server.args || server.args.length === 0) {
        server.args = allowedPaths
      }
    }

    return server
  }

  /**
   * Check if any of the allowed tools matches a tool pattern.
   * Supports exact match and prefix match with '*' suffix.
   */
  private matchesTool(pattern: string, allowedTools: string[]): boolean {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1)
      return allowedTools.some((t) => t.startsWith(prefix))
    }
    return allowedTools.includes(pattern)
  }
}

/**
 * Create a default MCPProvisioner with standard tool-to-MCP mappings.
 *
 * Default mappings (based on design doc inference table):
 * - Read/Write/Edit tools -> filesystem MCP server
 * - Bash tool -> terminal MCP server
 * - Git tool -> git MCP server
 * - WebSearch/WebFetch -> browser MCP server
 */
export function createDefaultProvisioner(): MCPProvisioner {
  return new MCPProvisioner([
    {
      toolPattern: 'Read',
      serverTemplate: {
        name: 'filesystem',
        transport: 'stdio',
        command: 'mcp-server-filesystem',
        args: [],
        env: {}
      }
    },
    {
      toolPattern: 'Write',
      serverTemplate: {
        name: 'filesystem',
        transport: 'stdio',
        command: 'mcp-server-filesystem',
        args: [],
        env: {}
      }
    },
    {
      toolPattern: 'Edit',
      serverTemplate: {
        name: 'filesystem',
        transport: 'stdio',
        command: 'mcp-server-filesystem',
        args: [],
        env: {}
      }
    },
    {
      toolPattern: 'Bash',
      serverTemplate: {
        name: 'terminal',
        transport: 'stdio',
        command: 'mcp-server-terminal',
        args: [],
        env: {}
      }
    },
    {
      toolPattern: 'Git',
      serverTemplate: {
        name: 'git',
        transport: 'stdio',
        command: 'mcp-server-git',
        args: [],
        env: {}
      }
    },
    {
      toolPattern: 'WebSearch',
      serverTemplate: {
        name: 'browser',
        transport: 'stdio',
        command: 'mcp-server-browser',
        args: [],
        env: {}
      }
    },
    {
      toolPattern: 'WebFetch',
      serverTemplate: {
        name: 'browser',
        transport: 'stdio',
        command: 'mcp-server-browser',
        args: [],
        env: {}
      }
    }
  ])
}
