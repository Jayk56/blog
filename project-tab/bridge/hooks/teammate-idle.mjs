#!/usr/bin/env node

/**
 * TeammateIdle hook for the project-tab bridge.
 *
 * Fires when a teammate becomes idle. Maps to a LifecycleEvent(idle)
 * and POSTs to the project-tab server's bridge ingest endpoint.
 *
 * Input (stdin JSON):
 *   { agent_id, reason }
 *
 * Environment:
 *   BRIDGE_SERVER_URL - Base URL of project-tab server
 *   BRIDGE_AGENT_ID   - This agent's ID
 *   BRIDGE_RUN_ID     - Optional session/run ID
 *
 * Exit: Always 0 (hooks must never block the agent).
 */

import { getConfig, postEvent, readStdinJson } from './lib/bridge-client.mjs'
import { createAdapterEvent, createLifecycleEvent } from './lib/event-factory.mjs'

async function main() {
  const config = getConfig()
  if (!config) process.exit(0)

  const input = await readStdinJson()

  const { serverUrl, agentId, runId } = config
  const reason = input?.reason || 'Agent idle'
  const lifecyclePayload = createLifecycleEvent('idle', reason)
  const adapterEvent = createAdapterEvent(agentId, runId, lifecyclePayload)

  await postEvent(serverUrl, adapterEvent)
}

main().catch(() => {}).finally(() => process.exit(0))
