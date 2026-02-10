/**
 * Tests for HTTP endpoints of the Claude adapter shim.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { makeTestBrief, startTestServer, type TestClient } from './helpers.js'
import type http from 'node:http'

describe('Health endpoint', () => {
  let client: TestClient
  let close: () => Promise<void>

  beforeAll(async () => {
    const srv = await startTestServer()
    client = srv.client
    close = srv.close
  })

  afterAll(async () => {
    await close()
  })

  it('returns 200', async () => {
    const resp = await client.get('/health')
    expect(resp.status).toBe(200)
  })

  it('has correct shape', async () => {
    const resp = await client.get('/health')
    expect(resp.body.status).toBe('healthy')
    expect(resp.body.uptimeMs).toBeDefined()
    expect(resp.body.agentStatus).toBeDefined()
    expect(resp.body.resourceUsage).toBeDefined()
    expect(resp.body.pendingEventBufferSize).toBeDefined()
  })

  it('uptime increases', async () => {
    const r1 = await client.get('/health')
    await new Promise(r => setTimeout(r, 50))
    const r2 = await client.get('/health')
    expect(r2.body.uptimeMs).toBeGreaterThanOrEqual(r1.body.uptimeMs)
  })
})

describe('Spawn endpoint', () => {
  let client: TestClient
  let close: () => Promise<void>

  beforeAll(async () => {
    const srv = await startTestServer()
    client = srv.client
    close = srv.close
  })

  afterAll(async () => {
    await close()
  })

  it('returns agent handle', async () => {
    const resp = await client.post('/spawn', makeTestBrief())
    expect(resp.status).toBe(200)
    expect(resp.body.id).toBe('agent-test-001')
    expect(resp.body.pluginName).toBe('claude-mock')
    expect(resp.body.status).toBe('running')
    expect(resp.body.sessionId).toBeDefined()
  })

  it('returns 409 when agent already running', async () => {
    const resp = await client.post('/spawn', makeTestBrief())
    expect(resp.status).toBe(409)
  })

  it('health reflects running agent', async () => {
    const resp = await client.get('/health')
    expect(['running', 'waiting_on_human']).toContain(resp.body.agentStatus)
  })
})

describe('Kill endpoint', () => {
  let client: TestClient
  let close: () => Promise<void>

  beforeAll(async () => {
    const srv = await startTestServer()
    client = srv.client
    close = srv.close
  })

  afterAll(async () => {
    await close()
  })

  it('returns 404 when no agent', async () => {
    const resp = await client.post('/kill', { grace: true })
    expect(resp.status).toBe(404)
  })

  it('kills after spawn (graceful)', async () => {
    await client.post('/spawn', makeTestBrief())
    const resp = await client.post('/kill', { grace: true })
    expect(resp.status).toBe(200)
    expect(resp.body.cleanShutdown).toBe(true)
  })
})

describe('Kill endpoint (force)', () => {
  let client: TestClient
  let close: () => Promise<void>

  beforeAll(async () => {
    const srv = await startTestServer()
    client = srv.client
    close = srv.close
  })

  afterAll(async () => {
    await close()
  })

  it('force kill sets cleanShutdown false', async () => {
    await client.post('/spawn', makeTestBrief())
    const resp = await client.post('/kill', { grace: false })
    expect(resp.status).toBe(200)
    expect(resp.body.cleanShutdown).toBe(false)
  })
})

describe('Pause endpoint', () => {
  let client: TestClient
  let close: () => Promise<void>

  beforeAll(async () => {
    const srv = await startTestServer()
    client = srv.client
    close = srv.close
  })

  afterAll(async () => {
    await close()
  })

  it('returns 404 when no agent', async () => {
    const resp = await client.post('/pause')
    expect(resp.status).toBe(404)
  })

  it('returns serialized state', async () => {
    await client.post('/spawn', makeTestBrief())
    const resp = await client.post('/pause')
    expect(resp.status).toBe(200)
    expect(resp.body.agentId).toBe('agent-test-001')
    expect(resp.body.pluginName).toBe('claude-mock')
    expect(resp.body.sessionId).toBeDefined()
    expect(resp.body.checkpoint).toBeDefined()
    expect(resp.body.checkpoint.sdk).toBe('claude-mock')
    expect(resp.body.lastSequence).toBeDefined()
    expect(resp.body.serializedBy).toBe('pause')
  })
})

describe('Resume endpoint', () => {
  let client: TestClient
  let close: () => Promise<void>

  beforeAll(async () => {
    const srv = await startTestServer()
    client = srv.client
    close = srv.close
  })

  afterAll(async () => {
    await close()
  })

  it('resumes from paused state', async () => {
    await client.post('/spawn', makeTestBrief())
    const pauseResp = await client.post('/pause')
    const state = pauseResp.body

    const resp = await client.post('/resume', state)
    expect(resp.status).toBe(200)
    expect(resp.body.status).toBe('running')
    expect(resp.body.pluginName).toBe('claude-mock')
  })
})

describe('Resolve endpoint', () => {
  let client: TestClient
  let close: () => Promise<void>

  beforeAll(async () => {
    const srv = await startTestServer()
    client = srv.client
    close = srv.close
  })

  afterAll(async () => {
    await close()
  })

  it('returns 404 when no agent', async () => {
    const resp = await client.post('/resolve', {
      decisionId: 'fake',
      resolution: {
        type: 'option',
        chosenOptionId: 'opt-1',
        rationale: 'test',
        actionKind: 'create',
      },
    })
    expect(resp.status).toBe(404)
  })

  it('returns 404 for wrong decision id', async () => {
    await client.post('/spawn', makeTestBrief())
    // Wait for runner to reach the decision point
    await new Promise(r => setTimeout(r, 700))

    const resp = await client.post('/resolve', {
      decisionId: 'wrong-id',
      resolution: {
        type: 'option',
        chosenOptionId: 'opt-1',
        rationale: 'test',
        actionKind: 'create',
      },
    })
    expect(resp.status).toBe(404)
  })
})

describe('Inject-context endpoint', () => {
  let client: TestClient
  let close: () => Promise<void>

  beforeAll(async () => {
    const srv = await startTestServer()
    client = srv.client
    close = srv.close
  })

  afterAll(async () => {
    await close()
  })

  it('accepts context injection', async () => {
    const resp = await client.post('/inject-context', {
      content: 'Updated context',
      format: 'markdown',
      snapshotVersion: 2,
      estimatedTokens: 100,
      priority: 'recommended',
    })
    expect(resp.status).toBe(200)
    expect(resp.body.status).toBe('accepted')
  })
})

describe('Update-brief endpoint', () => {
  let client: TestClient
  let close: () => Promise<void>

  beforeAll(async () => {
    const srv = await startTestServer()
    client = srv.client
    close = srv.close
  })

  afterAll(async () => {
    await close()
  })

  it('returns 404 when no agent', async () => {
    const resp = await client.post('/update-brief', { role: 'updated-role' })
    expect(resp.status).toBe(404)
  })

  it('accepts brief update', async () => {
    await client.post('/spawn', makeTestBrief())
    const resp = await client.post('/update-brief', { role: 'updated-role' })
    expect(resp.status).toBe(200)
    expect(resp.body.status).toBe('accepted')
  })
})
