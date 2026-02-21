#!/usr/bin/env node

/**
 * PostToolUse hook for the project-tab bridge.
 *
 * Reads tool call result from stdin, maps to AdapterEvent(s),
 * and POSTs to the project-tab server's bridge ingest endpoint.
 *
 * Input (stdin JSON):
 *   { tool_name, tool_input, tool_use_id, tool_output, is_error }
 *
 * Environment:
 *   BRIDGE_SERVER_URL - Base URL of project-tab server
 *   BRIDGE_AGENT_ID   - This agent's ID
 *   BRIDGE_RUN_ID     - Optional session/run ID
 *
 * Exit: Always 0 (hooks must never block the agent).
 */

import { getConfig, postEvent, readStdinJson } from './lib/bridge-client.mjs'
import {
  createAdapterEvent,
  createToolCallEvent,
  createArtifactEvent,
  createErrorEvent,
} from './lib/event-factory.mjs'

async function main() {
  const config = getConfig()
  if (!config) process.exit(0)

  const input = await readStdinJson()
  if (!input) process.exit(0)

  const { serverUrl, agentId, runId } = config
  const events = []

  // Map to tool_call event
  const toolCallPayload = createToolCallEvent(input)
  events.push(createAdapterEvent(agentId, runId, toolCallPayload))

  // If Write or Edit, also emit artifact event
  const artifactPayload = createArtifactEvent(input)
  if (artifactPayload) {
    events.push(createAdapterEvent(agentId, runId, artifactPayload))
  }

  // If error, also emit error event
  if (input.is_error) {
    const errorPayload = createErrorEvent(
      `Tool ${input.tool_name} failed`,
      { toolName: input.tool_name }
    )
    events.push(createAdapterEvent(agentId, runId, errorPayload))
  }

  // Fire-and-forget all events in parallel
  await Promise.all(events.map((e) => postEvent(serverUrl, e)))
}

main().catch(() => {}).finally(() => process.exit(0))
