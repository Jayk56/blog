/**
 * Artifact upload helper for uploading content to the backend on ArtifactEvents.
 */

import type { AdapterEvent, ArtifactEvent } from './models.js'

/** Parse AGENT_BOOTSTRAP env var if present. */
export function getBootstrapConfig(): Record<string, unknown> | null {
  const raw = process.env.AGENT_BOOTSTRAP
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Get the artifact upload endpoint from bootstrap config. */
export function getArtifactUploadEndpoint(): string | null {
  const config = getBootstrapConfig()
  if (config && typeof config.artifactUploadEndpoint === 'string') {
    return config.artifactUploadEndpoint
  }
  return null
}

/** Upload artifact content to the backend, return backendUri or null on failure. */
export async function uploadArtifactContent(
  endpoint: string,
  agentId: string,
  artifactId: string,
  content: string = '',
  mimeType?: string,
): Promise<string | null> {
  try {
    const payload: Record<string, unknown> = {
      agentId,
      artifactId,
      content,
    }
    if (mimeType) {
      payload.mimeType = mimeType
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    })

    if (response.status === 201) {
      const data = await response.json() as { backendUri?: string }
      return data.backendUri ?? null
    }
  } catch {
    // Best-effort: if upload fails, we still forward the event with original URI
  }
  return null
}

/** If the event contains an ArtifactEvent, upload content and rewrite the URI. */
export async function rewriteArtifactUri(
  event: AdapterEvent,
  endpoint: string,
): Promise<AdapterEvent> {
  if (event.event.type !== 'artifact') {
    return event
  }

  const inner = event.event as ArtifactEvent
  const backendUri = await uploadArtifactContent(
    endpoint,
    inner.agentId,
    inner.artifactId,
    '',  // Mock mode has no real content
    inner.mimeType,
  )

  if (backendUri) {
    return {
      ...event,
      event: {
        ...inner,
        uri: backendUri,
      },
    }
  }

  return event
}
