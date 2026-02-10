/**
 * Shared test fixtures and helpers for Claude adapter shim tests.
 */

import http from 'node:http'
import type { AgentBrief } from '../src/models.js'
import { createApp, setupWebSocket } from '../src/app.js'

export function makeTestBrief(agentId = 'agent-test-001'): AgentBrief {
  return {
    agentId,
    role: 'test-agent',
    description: 'A test agent for integration testing',
    workstream: 'testing',
    readableWorkstreams: ['testing'],
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
      goals: ['Test goal'],
      checkpoints: ['Test checkpoint'],
    },
    knowledgeSnapshot: {
      version: 1,
      generatedAt: '2025-01-01T00:00:00Z',
      workstreams: [],
      pendingDecisions: [],
      recentCoherenceIssues: [],
      artifactIndex: [],
      activeAgents: [],
      estimatedTokens: 0,
    },
    allowedTools: ['Read', 'Edit', 'Bash'],
  }
}

/**
 * Helper to make HTTP requests to the test server.
 */
export class TestClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async get(path: string): Promise<{ status: number; json: () => Promise<any>; body: any }> {
    const res = await fetch(`${this.baseUrl}${path}`)
    const body = await res.json()
    return { status: res.status, json: async () => body, body }
  }

  async post(path: string, body?: unknown): Promise<{ status: number; json: () => Promise<any>; body: any }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    let resBody: any
    const text = await res.text()
    try {
      resBody = JSON.parse(text)
    } catch {
      resBody = text
    }
    return { status: res.status, json: async () => resBody, body: resBody }
  }
}

/**
 * Start a test server and return the client + cleanup function.
 */
export async function startTestServer(): Promise<{
  client: TestClient
  baseUrl: string
  server: http.Server
  close: () => Promise<void>
}> {
  const app = createApp({ mock: true })
  const server = http.createServer(app)
  setupWebSocket(server, app)

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const addr = server.address() as { port: number }
  const baseUrl = `http://127.0.0.1:${addr.port}`
  const client = new TestClient(baseUrl)

  const close = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  }

  return { client, baseUrl, server, close }
}
