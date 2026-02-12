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

  router.get('/artifacts/:id/content', (req, res) => {
    if (!deps.knowledgeStoreImpl) {
      res.status(501).json({ error: 'Content retrieval not supported' })
      return
    }

    // First get the artifact to find its agent ID
    const artifact = deps.knowledgeStoreImpl.getArtifact(req.params.id)
    if (!artifact) {
      res.status(404).json({ error: 'Artifact not found' })
      return
    }

    // Then get the content using both agent ID and artifact ID
    const result = deps.knowledgeStoreImpl.getArtifactContent(artifact.agentId, req.params.id)
    if (!result) {
      res.status(404).json({ error: 'Artifact content not found' })
      return
    }

    if (result.mimeType) {
      res.setHeader('Content-Type', result.mimeType)
    }
    res.status(200).send(result.content)
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
    const content = body.content as string | undefined
    const mimeType = body.mimeType as string | undefined

    if (!agentId || !artifactId) {
      res.status(400).json({ error: 'Missing agentId or artifactId' })
      return
    }

    // Generate a stable backend URI for the artifact
    const backendUri = `artifact://${agentId}/${artifactId}`

    // Store content if the knowledge store supports it
    if (deps.knowledgeStoreImpl && content !== undefined) {
      try {
        deps.knowledgeStoreImpl.storeArtifactContent(agentId, artifactId, content, mimeType)
      } catch (err) {
        res.status(500).json({
          error: 'Failed to store artifact content',
          message: (err as Error).message
        })
        return
      }
    }

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
