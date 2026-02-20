import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import express from 'express'

import { listenEphemeral } from '../helpers/listen-ephemeral'
import {
  getProfile,
  listProfiles,
  isCalibrationProfileName,
} from '../../src/intelligence/calibration-profiles'
import type { CalibrationProfileName } from '../../src/intelligence/calibration-profiles'
import { TrustEngine } from '../../src/intelligence/trust-engine'
import { createTrustRouter } from '../../src/routes/trust'
import type { WebSocketHub } from '../../src/ws-hub'
import type { KnowledgeStore } from '../../src/types/service-interfaces'

// ── Helpers ──────────────────────────────────────────────────────────

function createMockWsHub() {
  const broadcasts: unknown[] = []
  return {
    broadcast: (msg: unknown) => { broadcasts.push(msg) },
    handleUpgrade: () => {},
    broadcasts,
  } as unknown as WebSocketHub & { broadcasts: unknown[] }
}

function createMockKnowledgeStore() {
  const auditLog: Array<{ entityType: string; entityId: string; action: string; callerAgentId?: string; details?: unknown }> = []
  return {
    getSnapshot: async () => ({
      version: 0,
      generatedAt: new Date().toISOString(),
      workstreams: [],
      pendingDecisions: [],
      recentCoherenceIssues: [],
      artifactIndex: [],
      activeAgents: [],
      estimatedTokens: 0,
    }),
    appendEvent: async () => {},
    appendAuditLog: (entityType: string, entityId: string, action: string, callerAgentId?: string, details?: unknown) => {
      auditLog.push({ entityType, entityId, action, callerAgentId, details })
    },
    auditLog,
  } as unknown as KnowledgeStore & { auditLog: typeof auditLog }
}

function createTestApp() {
  const trustEngine = new TrustEngine()
  const wsHub = createMockWsHub()
  const knowledgeStore = createMockKnowledgeStore()

  const app = express()
  app.use(express.json())
  app.use('/api/trust', createTrustRouter({ trustEngine, wsHub, knowledgeStore }))

  const server = createServer(app as any)
  let baseUrl = ''

  return {
    trustEngine, wsHub, knowledgeStore, server,
    get baseUrl() { return baseUrl },
    async start() {
      const port = await listenEphemeral(server)
      baseUrl = `http://localhost:${port}`
    },
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

// ── Unit tests: profile definitions ──────────────────────────────────

describe('Calibration Profiles', () => {
  describe('profile definitions', () => {
    it('lists all 3 profiles', () => {
      const profiles = listProfiles()
      expect(profiles).toHaveLength(3)
      const names = profiles.map(p => p.name)
      expect(names).toContain('conservative')
      expect(names).toContain('balanced')
      expect(names).toContain('permissive')
    })

    it('conservative has lower ceilings and faster decay', () => {
      const profile = getProfile('conservative')
      expect(profile.config.initialScore).toBe(30)
      expect(profile.config.ceilingScore).toBe(60)
      expect(profile.config.decayCeiling).toBe(25)
      expect(profile.config.decayRatePerTick).toBe(0.02)
      expect(profile.config.riskWeightingEnabled).toBe(true)
      expect(profile.config.riskWeightMap).toBeDefined()
    })

    it('permissive has higher initial scores and slower decay', () => {
      const profile = getProfile('permissive')
      expect(profile.config.initialScore).toBe(70)
      expect(profile.config.ceilingScore).toBe(100)
      expect(profile.config.decayCeiling).toBe(60)
      expect(profile.config.decayRatePerTick).toBe(0.005)
      expect(profile.config.floorScore).toBe(30)
    })

    it('balanced has empty config (matches defaults)', () => {
      const profile = getProfile('balanced')
      expect(profile.config).toEqual({})
    })

    it('all profiles return valid TrustCalibrationConfig partials', () => {
      for (const profile of listProfiles()) {
        expect(profile.name).toBeTruthy()
        expect(profile.displayName).toBeTruthy()
        expect(profile.description).toBeTruthy()
        expect(typeof profile.config).toBe('object')
      }
    })

    it('isCalibrationProfileName validates correctly', () => {
      expect(isCalibrationProfileName('conservative')).toBe(true)
      expect(isCalibrationProfileName('balanced')).toBe(true)
      expect(isCalibrationProfileName('permissive')).toBe(true)
      expect(isCalibrationProfileName('aggressive')).toBe(false)
      expect(isCalibrationProfileName('')).toBe(false)
    })
  })

  describe('TrustEngine.reconfigure', () => {
    it('profile activation reconfigures engine', () => {
      const engine = new TrustEngine()
      const defaultConfig = engine.getConfig()
      expect(defaultConfig.initialScore).toBe(50)

      const conservative = getProfile('conservative')
      engine.reconfigure(conservative.config)

      const newConfig = engine.getConfig()
      expect(newConfig.initialScore).toBe(30)
      expect(newConfig.ceilingScore).toBe(60)
      expect(newConfig.decayRatePerTick).toBe(0.02)
    })

    it('agent scores preserved on reconfigure', () => {
      const engine = new TrustEngine()
      engine.registerAgent('a', 0)
      engine.applyOutcome('a', 'task_completed_clean', 1) // +3 -> 53

      const scoreBefore = engine.getScore('a')
      expect(scoreBefore).toBe(53)

      const permissive = getProfile('permissive')
      engine.reconfigure(permissive.config)

      // Score is preserved
      expect(engine.getScore('a')).toBe(53)
      // But config has changed
      expect(engine.getConfig().initialScore).toBe(70)
    })

    it('balanced reconfigure restores defaults', () => {
      const engine = new TrustEngine({ initialScore: 30, ceilingScore: 60 })
      expect(engine.getConfig().initialScore).toBe(30)

      const balanced = getProfile('balanced')
      engine.reconfigure(balanced.config)

      expect(engine.getConfig().initialScore).toBe(50)
      expect(engine.getConfig().ceilingScore).toBe(100)
    })
  })

  // ── Route integration tests ──────────────────────────────────────────

  describe('routes', () => {
    let ctx: ReturnType<typeof createTestApp>

    beforeEach(async () => {
      ctx = createTestApp()
      await ctx.start()
    })

    afterEach(async () => {
      await ctx.stop()
    })

    it('GET /api/trust/profiles returns all 3 profiles', async () => {
      const res = await fetch(`${ctx.baseUrl}/api/trust/profiles`)
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.profiles).toHaveLength(3)
      expect(data.activeProfile).toBe('balanced')
      expect(data.profiles.map((p: any) => p.name).sort()).toEqual(['balanced', 'conservative', 'permissive'])
    })

    it('POST /api/trust/profile/:name activates correctly', async () => {
      const res = await fetch(`${ctx.baseUrl}/api/trust/profile/conservative`, { method: 'POST' })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.activated).toBe(true)
      expect(data.profile).toBe('conservative')
      expect(data.config.initialScore).toBe(30)

      // Verify the profile is now reported as active
      const listRes = await fetch(`${ctx.baseUrl}/api/trust/profiles`)
      const listData = await listRes.json()
      expect(listData.activeProfile).toBe('conservative')
    })

    it('invalid profile name returns 400', async () => {
      const res = await fetch(`${ctx.baseUrl}/api/trust/profile/aggressive`, { method: 'POST' })
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toContain('Invalid profile name')
    })

    it('profile activation logs to audit', async () => {
      await fetch(`${ctx.baseUrl}/api/trust/profile/permissive`, { method: 'POST' })

      expect(ctx.knowledgeStore.auditLog).toHaveLength(1)
      const entry = ctx.knowledgeStore.auditLog[0]
      expect(entry.entityType).toBe('trust_calibration')
      expect(entry.entityId).toBe('permissive')
      expect(entry.action).toBe('profile_activated')
    })

    it('profile activation broadcasts via WebSocket', async () => {
      await fetch(`${ctx.baseUrl}/api/trust/profile/conservative`, { method: 'POST' })

      expect(ctx.wsHub.broadcasts).toHaveLength(1)
      const msg = ctx.wsHub.broadcasts[0] as any
      expect(msg.type).toBe('trust_config_update')
      expect(msg.profile).toBe('conservative')
    })
  })
})
