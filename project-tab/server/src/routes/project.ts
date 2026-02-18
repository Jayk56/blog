import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { projectSeedSchema, draftBriefRequestSchema, projectPatchSchema } from '../validation/schemas'
import { parseBody } from './utils'
import { mergeSeeds, configToSeedPayload } from '../lib/merge-seeds'
import type { ApiRouteDeps } from './index'
import type { ProjectConfig, ProjectSeedPayload } from '../types/project-config'
import type { AgentBrief } from '../types'
import type { ArtifactEvent } from '../types/events'

type ProjectDeps = Pick<ApiRouteDeps, 'knowledgeStoreImpl' | 'decisionQueue' | 'trustEngine' | 'controlMode'>

export function createProjectRouter(deps: ProjectDeps): Router {
  const router = Router()

  // POST /api/project/seed
  router.post('/seed', (req, res) => {
    const payload = parseBody(req, res, projectSeedSchema)
    if (!payload) return

    const mode = req.query.mode as string | undefined
    const now = new Date().toISOString()
    const existingConfig = deps.knowledgeStoreImpl!.getProjectConfig()
    let merged = false

    // If merge mode, merge incoming payload with existing config
    let effectivePayload: ProjectSeedPayload = payload
    if (mode === 'merge' && existingConfig) {
      const existingSeed = configToSeedPayload(existingConfig)
      effectivePayload = mergeSeeds(existingSeed, payload)
      merged = true
    }

    const config: ProjectConfig = {
      id: existingConfig?.id ?? randomUUID(),
      title: effectivePayload.project.title,
      description: effectivePayload.project.description,
      goals: effectivePayload.project.goals,
      checkpoints: effectivePayload.project.checkpoints,
      constraints: effectivePayload.project.constraints ?? [],
      framework: effectivePayload.project.framework,
      workstreams: effectivePayload.workstreams,
      defaultTools: effectivePayload.defaultTools ?? ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      defaultConstraints: effectivePayload.defaultConstraints ?? [],
      defaultEscalation: {
        alwaysEscalate: effectivePayload.defaultEscalation?.alwaysEscalate ?? [],
        neverEscalate: effectivePayload.defaultEscalation?.neverEscalate ?? [],
      },
      repoRoot: effectivePayload.repoRoot,
      provenance: effectivePayload.provenance ?? { source: 'api' },
      createdAt: existingConfig?.createdAt ?? now,
      updatedAt: now,
    }

    deps.knowledgeStoreImpl!.storeProjectConfig(config)

    for (const ws of effectivePayload.workstreams) {
      deps.knowledgeStoreImpl!.ensureWorkstream(ws.id, ws.name)
    }

    const artifacts = effectivePayload.artifacts ?? []
    for (const artifact of artifacts) {
      const artifactEvent: ArtifactEvent = {
        type: 'artifact',
        agentId: 'bootstrap',
        artifactId: `seed-${randomUUID().slice(0, 8)}`,
        name: artifact.name,
        kind: artifact.kind,
        workstream: artifact.workstream,
        status: 'approved',
        qualityScore: 1.0,
        provenance: { createdBy: 'bootstrap', createdAt: now },
        uri: artifact.uri,
        contentHash: artifact.contentHash,
        sizeBytes: artifact.sizeBytes,
      }
      deps.knowledgeStoreImpl!.storeArtifact(artifactEvent)
    }

    res.status(201).json({
      project: config,
      workstreamsCreated: effectivePayload.workstreams.length,
      artifactsSeeded: artifacts.length,
      merged,
    })
  })

  // GET /api/project
  router.get('/', (_req, res) => {
    const config = deps.knowledgeStoreImpl!.getProjectConfig()
    if (!config) {
      res.status(404).json({ error: 'No project seeded' })
      return
    }
    res.json(config)
  })

  // PATCH /api/project
  router.patch('/', (req, res) => {
    const patch = parseBody(req, res, projectPatchSchema)
    if (!patch) return

    const config = deps.knowledgeStoreImpl!.getProjectConfig()
    if (!config) {
      res.status(404).json({ error: 'No project seeded' })
      return
    }

    const updated = {
      ...config,
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.goals !== undefined && { goals: patch.goals }),
      ...(patch.constraints !== undefined && { constraints: patch.constraints }),
      updatedAt: new Date().toISOString(),
    }

    deps.knowledgeStoreImpl!.storeProjectConfig(updated)
    res.json({ project: updated })
  })

  // POST /api/project/draft-brief
  router.post('/draft-brief', (req, res) => {
    const body = parseBody(req, res, draftBriefRequestSchema)
    if (!body) return

    const config = deps.knowledgeStoreImpl!.getProjectConfig()
    if (!config) {
      res.status(409).json({ error: 'No project seeded' })
      return
    }

    const pendingDecisions = deps.decisionQueue.listPending().map(q => q.event)
    const snapshot = deps.knowledgeStoreImpl!.getSnapshot(pendingDecisions)

    const wsDef = config.workstreams.find(w => w.id === body.workstream)
    if (!wsDef) {
      res.status(400).json({ error: `Unknown workstream: "${body.workstream}". Available: ${config.workstreams.map(w => w.id).join(', ')}` })
      return
    }
    const wsSummary = snapshot.workstreams.find(w => w.id === body.workstream)
    const workstreamContext = wsDef ? {
      description: wsDef.description,
      keyFiles: wsDef.keyFiles,
      exports: wsDef.exports,
      dependencies: wsDef.dependencies,
      status: wsDef.status,
      // Enrichment from live state
      activeAgentIds: wsSummary?.activeAgentIds ?? [],
      artifactCount: wsSummary?.artifactCount ?? 0,
      pendingDecisionCount: wsSummary?.pendingDecisionCount ?? 0,
      recentCoherenceIssueCount: snapshot.recentCoherenceIssues
        .filter(issue => issue.affectedWorkstreams.includes(body.workstream)).length,
    } : undefined

    const brief: AgentBrief = {
      agentId: body.agentId ?? `agent-${randomUUID().slice(0, 8)}`,
      role: body.role,
      description: body.description,
      workstream: body.workstream,
      readableWorkstreams: body.readableWorkstreams ?? config.workstreams.filter(w => w.id !== body.workstream).map(w => w.id),
      constraints: [...config.defaultConstraints, ...(body.additionalConstraints ?? [])],
      escalationProtocol: {
        alwaysEscalate: config.defaultEscalation.alwaysEscalate,
        escalateWhen: [
          { predicate: { field: 'confidence', op: 'lt', value: 0.7 }, description: 'Low confidence decisions' },
          { predicate: { field: 'blastRadius', op: 'gte', value: 'large' }, description: 'Large blast radius changes' },
        ],
        neverEscalate: config.defaultEscalation.neverEscalate,
      },
      controlMode: deps.controlMode.getMode(),
      projectBrief: {
        id: config.id,
        title: config.title,
        description: config.description,
        goals: config.goals,
        checkpoints: config.checkpoints,
        constraints: config.constraints,
      },
      knowledgeSnapshot: snapshot,
      allowedTools: [...config.defaultTools, ...(body.additionalTools ?? [])],
      modelPreference: body.modelPreference,
      workstreamContext,
    }

    res.json({ brief })
  })

  return router
}
