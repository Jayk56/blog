import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import express from 'express'
import { listenEphemeral } from '../helpers/listen-ephemeral'
import { createProjectRouter } from '../../src/routes/project'
import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import { DecisionQueue } from '../../src/intelligence/decision-queue'
import type { ControlMode } from '../../src/types/events'

function createTestApp(controlModeValue: ControlMode = 'orchestrator') {
  const store = new KnowledgeStore(':memory:')
  const decisionQueue = new DecisionQueue()
  const controlMode = { getMode: () => controlModeValue, setMode: () => {} }
  const app = express()
  app.use(express.json())
  app.use('/api/project', createProjectRouter({
    knowledgeStoreImpl: store,
    decisionQueue,
    trustEngine: {} as any,
    controlMode,
  }))
  const server = createServer(app as any)
  let baseUrl = ''
  return {
    store,
    decisionQueue,
    server,
    get baseUrl() { return baseUrl },
    async start() {
      const port = await listenEphemeral(server)
      baseUrl = `http://localhost:${port}`
    },
    async close() {
      store.close()
      await new Promise<void>(r => server.close(() => r()))
    }
  }
}

const seedPayload = {
  project: {
    title: 'Test Project',
    description: 'A test',
    goals: ['Build it'],
    checkpoints: ['v1.0']
  },
  workstreams: [
    { id: 'core', name: 'Core', description: 'Core work', keyFiles: ['src/'], exports: ['App', 'Server'], dependencies: ['tests'] },
    { id: 'tests', name: 'Tests', description: 'Test work', keyFiles: ['test/'] }
  ],
  artifacts: [
    { name: 'main.ts', kind: 'code' as const, workstream: 'core', uri: 'src/main.ts' }
  ],
  defaultTools: ['Read', 'Write'],
  defaultConstraints: ['No bugs']
}

describe('project routes', () => {
  let app: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    app = createTestApp()
    await app.start()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('POST /api/project/seed', () => {
    it('returns 201 with project config', async () => {
      const res = await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })
      expect(res.status).toBe(201)
      const body = await res.json() as any
      expect(body.project.title).toBe('Test Project')
      expect(body.project.description).toBe('A test')
      expect(body.project.goals).toEqual(['Build it'])
      expect(body.project.checkpoints).toEqual(['v1.0'])
      expect(body.project.id).toBeTypeOf('string')
      expect(body.workstreamsCreated).toBe(2)
      expect(body.artifactsSeeded).toBe(1)
    })

    it('creates workstreams in store', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })
      const snapshot = app.store.getSnapshot()
      const wsIds = snapshot.workstreams.map(w => w.id)
      expect(wsIds).toContain('core')
      expect(wsIds).toContain('tests')
    })

    it('seeds artifacts', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })
      const artifacts = app.store.listArtifacts()
      expect(artifacts).toHaveLength(1)
      expect(artifacts[0].name).toBe('main.ts')
      expect(artifacts[0].kind).toBe('code')
      expect(artifacts[0].workstream).toBe('core')
      expect(artifacts[0].status).toBe('approved')
      expect(artifacts[0].agentId).toBe('bootstrap')
    })

    it('returns 400 on validation error', async () => {
      const res = await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: { title: '' } })
      })
      expect(res.status).toBe(400)
      const body = await res.json() as any
      expect(body.error).toBe('Validation failed')
    })

    it('upserts on second seed', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })

      const updatedPayload = {
        ...seedPayload,
        project: { ...seedPayload.project, title: 'Updated Project' }
      }

      const res = await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPayload)
      })
      expect(res.status).toBe(201)

      const config = app.store.getProjectConfig()
      expect(config!.title).toBe('Updated Project')
    })
  })

  describe('GET /api/project', () => {
    it('returns 404 when no project seeded', async () => {
      const res = await fetch(`${app.baseUrl}/api/project`)
      expect(res.status).toBe(404)
      const body = await res.json() as any
      expect(body.error).toBe('No project seeded')
    })

    it('returns project after seeding', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })

      const res = await fetch(`${app.baseUrl}/api/project`)
      expect(res.status).toBe(200)
      const body = await res.json() as any
      expect(body.title).toBe('Test Project')
      expect(body.defaultTools).toEqual(['Read', 'Write'])
      expect(body.defaultConstraints).toEqual(['No bugs'])
    })
  })

  describe('POST /api/project/draft-brief', () => {
    it('returns 409 when no project seeded', async () => {
      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes stuff', workstream: 'core' })
      })
      expect(res.status).toBe(409)
      const body = await res.json() as any
      expect(body.error).toBe('No project seeded')
    })

    it('returns complete brief', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })

      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes stuff', workstream: 'core' })
      })
      expect(res.status).toBe(200)
      const body = await res.json() as any
      expect(body.brief).toBeDefined()
      expect(body.brief.role).toBe('coder')
      expect(body.brief.description).toBe('Codes stuff')
      expect(body.brief.workstream).toBe('core')
    })

    it('generated brief has correct structure', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })

      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes stuff', workstream: 'core' })
      })
      const { brief } = (await res.json()) as any

      // agentId auto-generated
      expect(brief.agentId).toMatch(/^agent-/)
      // readableWorkstreams defaults to other workstreams
      expect(brief.readableWorkstreams).toEqual(['tests'])
      // constraints include defaults
      expect(brief.constraints).toContain('No bugs')
      // escalation protocol
      expect(brief.escalationProtocol.escalateWhen).toHaveLength(2)
      // controlMode
      expect(brief.controlMode).toBe('orchestrator')
      // projectBrief
      expect(brief.projectBrief.title).toBe('Test Project')
      expect(brief.projectBrief.goals).toEqual(['Build it'])
      // knowledgeSnapshot
      expect(brief.knowledgeSnapshot).toBeDefined()
      expect(brief.knowledgeSnapshot.version).toBeTypeOf('number')
      // allowedTools from defaults
      expect(brief.allowedTools).toEqual(['Read', 'Write'])
    })

    it('uses provided agentId', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })

      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'my-agent-42',
          role: 'coder',
          description: 'Codes stuff',
          workstream: 'core'
        })
      })
      const { brief } = (await res.json()) as any
      expect(brief.agentId).toBe('my-agent-42')
    })

    it('merges additional constraints and tools', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })

      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'coder',
          description: 'Codes stuff',
          workstream: 'core',
          additionalConstraints: ['Extra rule'],
          additionalTools: ['Bash', 'Glob']
        })
      })
      const { brief } = (await res.json()) as any
      expect(brief.constraints).toEqual(['No bugs', 'Extra rule'])
      expect(brief.allowedTools).toEqual(['Read', 'Write', 'Bash', 'Glob'])
    })
  })

  describe('POST /api/project/draft-brief — workstream context', () => {
    beforeEach(async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })
    })

    it('brief includes workstreamContext when workstream exists in config', async () => {
      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes', workstream: 'core' })
      })
      const { brief } = (await res.json()) as any
      expect(brief.workstreamContext).toBeDefined()
    })

    it('workstreamContext.description matches seeded workstream', async () => {
      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes', workstream: 'core' })
      })
      const { brief } = (await res.json()) as any
      expect(brief.workstreamContext.description).toBe('Core work')
    })

    it('workstreamContext.keyFiles matches seeded workstream', async () => {
      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes', workstream: 'core' })
      })
      const { brief } = (await res.json()) as any
      expect(brief.workstreamContext.keyFiles).toEqual(['src/'])
    })

    it('workstreamContext.exports passed through when present', async () => {
      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes', workstream: 'core' })
      })
      const { brief } = (await res.json()) as any
      expect(brief.workstreamContext.exports).toEqual(['App', 'Server'])
    })

    it('workstreamContext.dependencies passed through when present', async () => {
      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes', workstream: 'core' })
      })
      const { brief } = (await res.json()) as any
      expect(brief.workstreamContext.dependencies).toEqual(['tests'])
    })

    it('returns 400 for unknown workstream ID', async () => {
      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes', workstream: 'nonexistent' })
      })
      expect(res.status).toBe(400)
      const body = await res.json() as any
      expect(body.error).toContain('Unknown workstream')
      expect(body.error).toContain('nonexistent')
    })
  })

  describe('POST /api/project/draft-brief -- enriched brief', () => {
    it('controlMode reflects actual mode from ControlModeManager', async () => {
      const adaptiveApp = createTestApp('adaptive')
      await adaptiveApp.start()

      await fetch(`${adaptiveApp.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })

      const res = await fetch(`${adaptiveApp.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes', workstream: 'core' })
      })
      const { brief } = (await res.json()) as any
      expect(brief.controlMode).toBe('adaptive')

      await adaptiveApp.close()
    })

    it('workstreamContext includes enrichment fields', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })

      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes', workstream: 'core' })
      })
      const { brief } = (await res.json()) as any

      // Enrichment fields should be present
      expect(brief.workstreamContext.activeAgentIds).toBeDefined()
      expect(brief.workstreamContext.artifactCount).toBeTypeOf('number')
      expect(brief.workstreamContext.pendingDecisionCount).toBeTypeOf('number')
      expect(brief.workstreamContext.recentCoherenceIssueCount).toBeTypeOf('number')
    })

    it('pendingDecisionCount reflects queued decisions', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })

      // Enqueue a decision for the 'core' workstream
      app.decisionQueue.enqueue({
        type: 'decision',
        subtype: 'option',
        agentId: 'agent-1',
        decisionId: 'dec-1',
        title: 'Test decision',
        summary: 'A test',
        severity: 'medium',
        confidence: 0.5,
        blastRadius: 'small',
        options: [{ id: 'opt-1', label: 'Option 1', description: 'First' }],
        affectedArtifactIds: [],
        requiresRationale: false,
      }, 0)

      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes', workstream: 'core' })
      })
      const { brief } = (await res.json()) as any

      // The snapshot should contain the pending decision
      expect(brief.knowledgeSnapshot.pendingDecisions).toHaveLength(1)
      expect(brief.knowledgeSnapshot.pendingDecisions[0].id).toBe('dec-1')
    })

    it('artifactCount reflects seeded artifacts', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })

      const res = await fetch(`${app.baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', description: 'Codes', workstream: 'core' })
      })
      const { brief } = (await res.json()) as any

      // 'core' workstream has 1 seeded artifact
      expect(brief.workstreamContext.artifactCount).toBe(1)
    })
  })

  describe('POST /api/project/seed?mode=merge', () => {
    const initialPayload = {
      ...seedPayload,
      workstreams: [
        { id: 'core', name: 'Core', description: 'Human-written core description', keyFiles: ['src/old.ts'], _autoDescription: false },
        { id: 'tests', name: 'Tests', description: 'Test work', keyFiles: ['test/'] },
      ],
    }

    const updatedPayload = {
      project: {
        title: 'Updated Project',
        description: 'Updated desc',
        goals: ['New goal'],
        checkpoints: ['v2.0']
      },
      workstreams: [
        { id: 'core', name: 'Core', description: 'Auto-generated core desc', keyFiles: ['src/new.ts'], _autoDescription: true },
        { id: 'newws', name: 'New WS', description: 'Brand new', keyFiles: ['src/new/'] },
      ],
      artifacts: [
        { name: 'new.ts', kind: 'code' as const, workstream: 'core', uri: 'src/new.ts' }
      ],
    }

    it('preserves human-edited descriptions on merge', async () => {
      // Seed initial
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(initialPayload)
      })

      // Merge
      const res = await fetch(`${app.baseUrl}/api/project/seed?mode=merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPayload)
      })
      expect(res.status).toBe(201)
      const body = await res.json() as any
      expect(body.merged).toBe(true)

      // Human-edited description should be preserved
      const coreWs = body.project.workstreams.find((w: any) => w.id === 'core')
      expect(coreWs.description).toBe('Human-written core description')
      // keyFiles should be overwritten from scanned
      expect(coreWs.keyFiles).toEqual(['src/new.ts'])
    })

    it('adds new workstreams on merge', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(initialPayload)
      })

      const res = await fetch(`${app.baseUrl}/api/project/seed?mode=merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPayload)
      })
      const body = await res.json() as any
      const wsIds = body.project.workstreams.map((w: any) => w.id)
      expect(wsIds).toContain('core')
      expect(wsIds).toContain('tests')  // kept from existing
      expect(wsIds).toContain('newws')  // added from scanned
    })

    it('returns merged: false when not in merge mode', async () => {
      await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })
      const res = await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })
      const body = await res.json() as any
      expect(body.merged).toBe(false)
    })

    it('falls through to normal seed when no existing config on merge', async () => {
      const res = await fetch(`${app.baseUrl}/api/project/seed?mode=merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })
      expect(res.status).toBe(201)
      const body = await res.json() as any
      expect(body.merged).toBe(false)
      expect(body.project.title).toBe('Test Project')
    })
  })

  describe('POST /api/project/seed — provenance and schemaVersion', () => {
    it('stores provenance from payload', async () => {
      const payloadWithProvenance = {
        ...seedPayload,
        schemaVersion: 1,
        provenance: {
          source: 'bootstrap-cli' as const,
          gitCommit: 'abc123',
          gitBranch: 'main',
          repoRoot: '/tmp/repo',
          scannedAt: '2025-01-01T00:00:00.000Z',
        },
      }
      const res = await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadWithProvenance)
      })
      expect(res.status).toBe(201)
      const body = await res.json() as any
      expect(body.project.provenance.source).toBe('bootstrap-cli')
      expect(body.project.provenance.gitCommit).toBe('abc123')
    })

    it('defaults provenance source to api when not provided', async () => {
      const res = await fetch(`${app.baseUrl}/api/project/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload)
      })
      expect(res.status).toBe(201)
      const body = await res.json() as any
      expect(body.project.provenance.source).toBe('api')
    })
  })
})
