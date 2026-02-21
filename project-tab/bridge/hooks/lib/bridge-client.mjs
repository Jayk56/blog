/**
 * Bridge HTTP client for posting events to the project-tab server.
 *
 * Reads configuration from environment variables:
 *   BRIDGE_SERVER_URL - Base URL of the project-tab server (e.g. http://localhost:3001)
 *   BRIDGE_AGENT_ID   - The agent ID for this hook instance
 *   BRIDGE_RUN_ID     - Optional run/session ID (defaults to agent ID)
 *
 * All requests are fire-and-forget: errors are swallowed so hooks never
 * block or break the agent's execution.
 */

/**
 * Reads bridge config from environment variables.
 *
 * @returns {{ serverUrl: string, agentId: string, runId: string } | null}
 *   Returns null if required env vars are missing.
 */
export function getConfig() {
  const serverUrl = process.env.BRIDGE_SERVER_URL
  const agentId = process.env.BRIDGE_AGENT_ID

  if (!serverUrl || !agentId) {
    return null
  }

  return {
    serverUrl: serverUrl.replace(/\/+$/, ''),
    agentId,
    runId: process.env.BRIDGE_RUN_ID || agentId,
  }
}

/**
 * Posts an AdapterEvent to the bridge ingest endpoint.
 * Fire-and-forget with a 5-second timeout. Errors are silently swallowed.
 *
 * @param {string} serverUrl - The base URL of the project-tab server.
 * @param {object} adapterEvent - The AdapterEvent envelope to send.
 * @returns {Promise<void>}
 */
export async function postEvent(serverUrl, adapterEvent) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    await fetch(`${serverUrl}/api/bridge/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adapterEvent),
      signal: controller.signal,
    })

    clearTimeout(timeout)
  } catch {
    // Fire-and-forget: swallow all errors
  }
}

/**
 * Reads all of stdin as a string.
 *
 * @returns {Promise<string>}
 */
export function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    // If stdin is already closed or empty, resolve quickly
    if (process.stdin.readableEnded) resolve(data)
  })
}

/**
 * Parses stdin JSON, returning the parsed object or null on failure.
 *
 * @returns {Promise<object|null>}
 */
export async function readStdinJson() {
  try {
    const raw = await readStdin()
    if (!raw.trim()) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}
