import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { exec } from 'node:child_process'
import * as path from 'node:path'
import express from 'express'
import { listenEphemeral } from '../helpers/listen-ephemeral'
import { createProjectRouter } from '../../src/routes/project'
import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import { DecisionQueue } from '../../src/intelligence/decision-queue'

const repoRoot = path.resolve(__dirname, '../..')
const scriptPath = path.join(repoRoot, 'scripts/bootstrap.ts')
const tsxBin = path.join(repoRoot, 'node_modules/.bin/tsx')

/**
 * Run a command asynchronously and return a promise that resolves with
 * stdout/stderr on success and rejects on non-zero exit or timeout.
 *
 * We must use async exec (not execSync) because the bootstrap CLI POSTs
 * to our in-process Express server -- execSync would block the event loop
 * and deadlock.
 */
function execAsync(cmd: string, opts: { cwd: string; timeout: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: opts.cwd, timeout: opts.timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`Command failed: ${err.message}\nstderr: ${stderr}\nstdout: ${stdout}`))
      else resolve({ stdout, stderr })
    })
  })
}

describe('E2E: bootstrap CLI -> server -> draft-brief', () => {
  let server: Server
  let baseUrl: string
  let store: KnowledgeStore

  beforeAll(async () => {
    store = new KnowledgeStore(':memory:')
    const decisionQueue = new DecisionQueue()
    const controlMode = { getMode: () => 'orchestrator' as const, setMode: () => {} }

    const app = express()
    app.use(express.json())
    app.use('/api/project', createProjectRouter({
      knowledgeStoreImpl: store,
      decisionQueue,
      trustEngine: {} as any,
      controlMode,
    }))

    server = createServer(app as any)
    const port = await listenEphemeral(server)
    baseUrl = `http://localhost:${port}`

    // Run bootstrap CLI asynchronously so the Express server can handle
    // the POST request (execSync would block the event loop and deadlock)
    await execAsync(
      `"${tsxBin}" "${scriptPath}" "${repoRoot}" --post --server "${baseUrl}" --no-llm`,
      { cwd: repoRoot, timeout: 60000 }
    )
  }, 65000)

  afterAll(async () => {
    store.close()
    await new Promise<void>(r => server.close(() => r()))
  })

  it('seeded project is retrievable via GET /api/project', async () => {
    const res = await fetch(`${baseUrl}/api/project`)
    expect(res.status).toBe(200)
    const config = await res.json() as any
    expect(config.title).toBeTruthy()
    expect(config.workstreams.length).toBeGreaterThan(0)
  })

  it('project has expected workstreams from repo scan', async () => {
    const res = await fetch(`${baseUrl}/api/project`)
    const config = await res.json() as any
    const wsIds = config.workstreams.map((w: any) => w.id)
    // Known workstreams in the project-tab server
    expect(wsIds).toContain('intelligence')
    expect(wsIds).toContain('routes')
    expect(wsIds).toContain('gateway')
    expect(wsIds).toContain('types')
  })

  it('workstreams have non-empty keyFiles', async () => {
    const res = await fetch(`${baseUrl}/api/project`)
    const config = await res.json() as any
    for (const ws of config.workstreams) {
      if (ws.id === 'integration') continue // integration may have no source files
      expect(ws.keyFiles.length, `${ws.id} should have keyFiles`).toBeGreaterThan(0)
    }
  })

  it('draft-brief produces valid brief for each workstream', async () => {
    const projRes = await fetch(`${baseUrl}/api/project`)
    const config = await projRes.json() as any

    for (const ws of config.workstreams) {
      const res = await fetch(`${baseUrl}/api/project/draft-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'builder',
          description: `Build ${ws.name} features`,
          workstream: ws.id,
        })
      })
      expect(res.status).toBe(200)
      const { brief } = await res.json() as any

      // Core brief fields
      expect(brief.agentId).toBeTruthy()
      expect(brief.workstream).toBe(ws.id)
      expect(brief.projectBrief).toBeDefined()
      expect(brief.knowledgeSnapshot).toBeDefined()
      expect(brief.constraints).toBeDefined()
      expect(brief.allowedTools.length).toBeGreaterThan(0)
      expect(brief.controlMode).toBe('orchestrator')

      // workstreamContext for non-integration workstreams
      if (ws.id !== 'integration') {
        expect(brief.workstreamContext, `${ws.id} should have workstreamContext`).toBeDefined()
        expect(brief.workstreamContext.description).toBeTruthy()
        expect(brief.workstreamContext.keyFiles.length).toBeGreaterThan(0)
      }
    }
  })
})
