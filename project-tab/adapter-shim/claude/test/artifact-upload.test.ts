/**
 * Tests for artifact upload helper and providerConfig passthrough.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { getBootstrapConfig, getArtifactUploadEndpoint } from '../src/artifact-upload.js'
import { makeTestBrief, startTestServer } from './helpers.js'

describe('Bootstrap config parsing', () => {
  const originalEnv = process.env.AGENT_BOOTSTRAP

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AGENT_BOOTSTRAP
    } else {
      process.env.AGENT_BOOTSTRAP = originalEnv
    }
  })

  it('returns null when AGENT_BOOTSTRAP is not set', () => {
    delete process.env.AGENT_BOOTSTRAP
    expect(getBootstrapConfig()).toBeNull()
  })

  it('parses valid AGENT_BOOTSTRAP JSON', () => {
    const config = {
      backendUrl: 'http://localhost:3001',
      artifactUploadEndpoint: 'http://localhost:3001/api/artifacts',
      agentId: 'agent-1',
    }
    process.env.AGENT_BOOTSTRAP = JSON.stringify(config)
    const result = getBootstrapConfig()
    expect(result).not.toBeNull()
    expect(result!.artifactUploadEndpoint).toBe('http://localhost:3001/api/artifacts')
  })

  it('returns null for invalid JSON', () => {
    process.env.AGENT_BOOTSTRAP = 'not-json{{{'
    expect(getBootstrapConfig()).toBeNull()
  })

  it('returns artifact upload endpoint from config', () => {
    process.env.AGENT_BOOTSTRAP = JSON.stringify({
      artifactUploadEndpoint: 'http://backend:3001/api/artifacts',
    })
    expect(getArtifactUploadEndpoint()).toBe('http://backend:3001/api/artifacts')
  })

  it('returns null when endpoint not in config', () => {
    process.env.AGENT_BOOTSTRAP = JSON.stringify({
      backendUrl: 'http://localhost:3001',
    })
    expect(getArtifactUploadEndpoint()).toBeNull()
  })
})

describe('providerConfig passthrough: GET /debug/config', () => {
  it('returns null when no agent is running', async () => {
    const { client, close } = await startTestServer()
    try {
      const res = await client.get('/debug/config')
      expect(res.status).toBe(200)
      expect(res.body.providerConfig).toBeNull()
    } finally {
      await close()
    }
  })

  it('returns providerConfig after spawn with config', async () => {
    const { client, close } = await startTestServer()
    try {
      const brief = {
        ...makeTestBrief('agent-config-1'),
        providerConfig: { temperature: 0.7, maxTokens: 4096 },
      }
      const spawnRes = await client.post('/spawn', brief)
      expect(spawnRes.status).toBe(200)

      const configRes = await client.get('/debug/config')
      expect(configRes.status).toBe(200)
      expect(configRes.body.providerConfig).toEqual({ temperature: 0.7, maxTokens: 4096 })
    } finally {
      await close()
    }
  })

  it('returns null when no providerConfig in brief', async () => {
    const { client, close } = await startTestServer()
    try {
      const brief = makeTestBrief('agent-no-config')
      const spawnRes = await client.post('/spawn', brief)
      expect(spawnRes.status).toBe(200)

      const configRes = await client.get('/debug/config')
      expect(configRes.status).toBe(200)
      expect(configRes.body.providerConfig).toBeNull()
    } finally {
      await close()
    }
  })

  it('preserves complex nested providerConfig', async () => {
    const { client, close } = await startTestServer()
    try {
      const providerConfig = {
        model: 'claude-opus-4-6',
        temperature: 0.3,
        stop: ['\n\n'],
        extra: { nested: { deep: true } },
      }
      const brief = {
        ...makeTestBrief('agent-complex'),
        providerConfig,
      }
      const spawnRes = await client.post('/spawn', brief)
      expect(spawnRes.status).toBe(200)

      const configRes = await client.get('/debug/config')
      expect(configRes.status).toBe(200)
      expect(configRes.body.providerConfig).toEqual(providerConfig)
    } finally {
      await close()
    }
  })
})
