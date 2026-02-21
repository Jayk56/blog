#!/usr/bin/env node

/**
 * Session Stop hook for the project-tab bridge.
 *
 * Fires when a Claude Code session ends. Sends a lifecycle:completed
 * event to the project-tab server's bridge ingest endpoint.
 *
 * Environment:
 *   BRIDGE_SERVER_URL - Base URL of project-tab server
 *   BRIDGE_AGENT_ID   - This agent's ID
 *   BRIDGE_RUN_ID     - Optional session/run ID
 *
 * Exit: Always 0 (hooks must never block the agent).
 */

import { getConfig, postEvent } from './lib/bridge-client.mjs'
import { createAdapterEvent, createLifecycleEvent } from './lib/event-factory.mjs'

async function main() {
  const config = getConfig()
  if (!config) process.exit(0)

  const { serverUrl, agentId, runId } = config
  const lifecyclePayload = createLifecycleEvent('completed', 'Session ended')
  const adapterEvent = createAdapterEvent(agentId, runId, lifecyclePayload)

  await postEvent(serverUrl, adapterEvent)
}

main().catch(() => {}).finally(() => process.exit(0))
