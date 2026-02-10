import { Router } from 'express'

import type { ApiRouteDeps } from './index'

/**
 * Creates routes for /api/artifacts and /api/coherence endpoints.
 * Also handles POST /api/artifacts for artifact uploads from adapter shims.
 */
export function createArtifactsRouter(deps: ApiRouteDeps): Router {
  const router = Router()

  router.get('/artifacts', async (_req, res) => {
    try {
      const snapshot = await deps.knowledgeStore.getSnapshot()
      res.status(200).json({ artifacts: snapshot.artifactIndex })
    } catch (err) {
      res.status(500).json({ error: 'Failed to get artifacts', message: (err as Error).message })
    }
  })

  router.get('/artifacts/:id', async (req, res) => {
    try {
      const snapshot = await deps.knowledgeStore.getSnapshot()
      const artifact = snapshot.artifactIndex.find((a) => a.id === req.params.id)
      if (!artifact) {
        res.status(404).json({ error: 'Artifact not found' })
        return
      }
      res.status(200).json({ artifact })
    } catch (err) {
      res.status(500).json({ error: 'Failed to get artifact', message: (err as Error).message })
    }
  })

  router.post('/artifacts', (req, res) => {
    // Artifact upload from adapter shim
    // The adapter sends artifact content along with metadata
    const body = req.body as Record<string, unknown>
    const agentId = body.agentId as string | undefined
    const artifactId = body.artifactId as string | undefined

    if (!agentId || !artifactId) {
      res.status(400).json({ error: 'Missing agentId or artifactId' })
      return
    }

    // Generate a stable backend URI for the artifact
    const backendUri = `artifact://${agentId}/${artifactId}`

    res.status(201).json({
      backendUri,
      artifactId,
      stored: true
    })
  })

  router.get('/coherence', async (_req, res) => {
    try {
      const snapshot = await deps.knowledgeStore.getSnapshot()
      res.status(200).json({ issues: snapshot.recentCoherenceIssues })
    } catch (err) {
      res.status(500).json({ error: 'Failed to get coherence issues', message: (err as Error).message })
    }
  })

  return router
}
