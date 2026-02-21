#!/usr/bin/env node

/**
 * TaskCompleted hook for the project-tab bridge.
 *
 * Fires when a task is marked complete. Maps to a CompletionEvent
 * and POSTs to the project-tab server's bridge ingest endpoint.
 *
 * Input (stdin JSON):
 *   { task_id, task_description, agent_id }
 *
 * Environment:
 *   BRIDGE_SERVER_URL - Base URL of project-tab server
 *   BRIDGE_AGENT_ID   - This agent's ID
 *   BRIDGE_RUN_ID     - Optional session/run ID
 *
 * Exit: Always 0 (hooks must never block the agent).
 */

import { getConfig, postEvent, readStdinJson } from './lib/bridge-client.mjs'
import { createAdapterEvent, createCompletionEvent } from './lib/event-factory.mjs'

async function main() {
  const config = getConfig()
  if (!config) process.exit(0)

  const input = await readStdinJson()
  if (!input) process.exit(0)

  const { serverUrl, agentId, runId } = config
  const completionPayload = createCompletionEvent(input)
  const adapterEvent = createAdapterEvent(agentId, runId, completionPayload)

  await postEvent(serverUrl, adapterEvent)
}

main().catch(() => {}).finally(() => process.exit(0))
