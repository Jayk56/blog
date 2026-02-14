/**
 * PreToolUse hook script for Claude Code decision gating.
 *
 * Called synchronously by Claude's hook system before each tool call.
 * Reads tool call info from stdin, posts to the backend's tool-gate endpoint,
 * blocks until the human resolves the decision, then returns allow/deny.
 *
 * Environment:
 *   AGENT_BOOTSTRAP — JSON string with { backendUrl, agentId, backendToken }
 *
 * Stdin (JSON):
 *   { tool_name, tool_input, tool_use_id }
 *
 * Stdout (JSON):
 *   { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
 */

/**
 * Core logic exported for unit testing.
 *
 * @param {{ tool_name: string, tool_input: Record<string, unknown>, tool_use_id: string }} input
 * @param {{ backendUrl: string, agentId: string, backendToken: string }} bootstrap
 * @returns {Promise<{ permissionDecision: string, permissionDecisionReason: string }>}
 */
export async function evaluateToolUse(input, bootstrap) {
  const { backendUrl, agentId, backendToken } = bootstrap
  const { tool_name: toolName, tool_input: toolInput, tool_use_id: toolUseId } = input

  const url = `${backendUrl}/api/tool-gate/request-approval`
  const body = JSON.stringify({
    agentId,
    toolName,
    toolInput: toolInput ?? {},
    toolUseId: toolUseId ?? 'unknown',
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(backendToken ? { Authorization: `Bearer ${backendToken}` } : {}),
    },
    body,
    signal: AbortSignal.timeout(360_000), // 6 min — longer than server's 5-min timeout
  })

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error')
    return {
      permissionDecision: 'deny',
      permissionDecisionReason: `Backend returned ${response.status}: ${text}`,
    }
  }

  const result = await response.json()
  const action = result.action

  // approve or modify → allow, reject → deny
  const permissionDecision = action === 'reject' ? 'deny' : 'allow'
  const permissionDecisionReason = result.rationale ?? (result.timedOut ? 'Timed out' : `Action: ${action}`)

  return { permissionDecision, permissionDecisionReason }
}

/**
 * Read all of stdin as a string.
 * @returns {Promise<string>}
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

/**
 * Write the hook response to stdout.
 * @param {string} permissionDecision
 * @param {string} permissionDecisionReason
 */
function writeResponse(permissionDecision, permissionDecisionReason) {
  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason,
    },
  })
  process.stdout.write(output)
}

// ── Main (only runs when executed directly, not when imported for testing) ──

const isMain = !process.env.__HOOK_TEST_MODE

if (isMain) {
  try {
    const raw = await readStdin()
    const input = JSON.parse(raw)

    const bootstrapRaw = process.env.AGENT_BOOTSTRAP
    if (!bootstrapRaw) {
      writeResponse('deny', 'AGENT_BOOTSTRAP env not set')
      process.exit(0)
    }

    const bootstrap = JSON.parse(bootstrapRaw)
    if (!bootstrap.backendUrl || !bootstrap.agentId) {
      writeResponse('deny', 'AGENT_BOOTSTRAP missing backendUrl or agentId')
      process.exit(0)
    }

    const result = await evaluateToolUse(input, bootstrap)
    writeResponse(result.permissionDecision, result.permissionDecisionReason)
  } catch (err) {
    writeResponse('deny', `Hook error: ${err?.message ?? String(err)}`)
  }
}
