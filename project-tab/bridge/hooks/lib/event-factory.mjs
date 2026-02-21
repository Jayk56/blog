import { randomUUID } from 'node:crypto'

let sequence = 0

/**
 * Creates an AdapterEvent envelope with auto-incrementing sequence.
 *
 * @param {string} agentId - The agent ID sending this event.
 * @param {string} runId - The run/session ID.
 * @param {object} event - The AgentEvent payload.
 * @returns {object} An AdapterEvent envelope.
 */
export function createAdapterEvent(agentId, runId, event) {
  return {
    sourceEventId: randomUUID(),
    sourceSequence: sequence++,
    sourceOccurredAt: new Date().toISOString(),
    runId,
    event: { ...event, agentId },
  }
}

/**
 * Creates a tool_call event from PostToolUse hook input.
 *
 * @param {object} hookInput - The PostToolUse stdin JSON.
 * @returns {object} A ToolCallEvent payload (without agentId).
 */
export function createToolCallEvent(hookInput) {
  const { tool_name, tool_input, tool_use_id, tool_output, is_error } = hookInput
  return {
    type: 'tool_call',
    toolCallId: tool_use_id || randomUUID(),
    toolName: tool_name,
    phase: is_error ? 'failed' : 'completed',
    input: typeof tool_input === 'object' && tool_input !== null ? tool_input : {},
    output: tool_output,
    approved: true,
  }
}

/**
 * Creates an artifact event from a Write or Edit tool call.
 *
 * @param {object} hookInput - The PostToolUse stdin JSON.
 * @returns {object|null} An ArtifactEvent payload (without agentId), or null if not applicable.
 */
export function createArtifactEvent(hookInput) {
  const { tool_name, tool_input } = hookInput
  if (tool_name !== 'Write' && tool_name !== 'Edit') return null

  const filePath = tool_input?.file_path || tool_input?.path || ''
  if (!filePath) return null

  const name = filePath.split('/').pop() || filePath
  const kind = inferArtifactKind(filePath)

  return {
    type: 'artifact',
    artifactId: randomUUID(),
    name,
    kind,
    workstream: 'default',
    status: 'draft',
    qualityScore: 0.5,
    provenance: {
      createdBy: 'bridge',
      createdAt: new Date().toISOString(),
      sourcePath: filePath,
    },
  }
}

/**
 * Creates a completion event from TaskCompleted hook input.
 *
 * @param {object} hookInput - The TaskCompleted stdin JSON.
 * @returns {object} A CompletionEvent payload (without agentId).
 */
export function createCompletionEvent(hookInput) {
  return {
    type: 'completion',
    summary: hookInput.task_description || 'Task completed',
    artifactsProduced: [],
    decisionsNeeded: [],
    outcome: 'success',
  }
}

/**
 * Creates a lifecycle event.
 *
 * @param {string} action - The lifecycle action (e.g. 'started', 'idle').
 * @param {string} [reason] - Optional reason string.
 * @returns {object} A LifecycleEvent payload (without agentId).
 */
export function createLifecycleEvent(action, reason) {
  const event = { type: 'lifecycle', action }
  if (reason) event.reason = reason
  return event
}

/**
 * Creates an error event.
 *
 * @param {string} message - Error message.
 * @param {object} [context] - Optional context with toolName/lastAction.
 * @returns {object} An ErrorEvent payload (without agentId).
 */
export function createErrorEvent(message, context) {
  return {
    type: 'error',
    severity: 'warning',
    message,
    recoverable: true,
    category: 'tool',
    ...(context ? { context } : {}),
  }
}

/**
 * Infers the artifact kind from a file path.
 *
 * @param {string} filePath
 * @returns {string} One of: code, test, config, document, design, other.
 */
function inferArtifactKind(filePath) {
  const lower = filePath.toLowerCase()

  // Test files
  if (/\.(test|spec)\.[^.]+$/.test(lower) || /test_/.test(lower.split('/').pop() || '')) {
    return 'test'
  }

  // Config files
  if (/\.(json|ya?ml|toml|ini|env|rc)$/.test(lower) ||
      /config|\.eslint|\.prettier|tsconfig|package\.json/.test(lower)) {
    return 'config'
  }

  // Code files
  if (/\.(ts|js|tsx|jsx|py|rs|go|java|rb|c|cpp|h|hpp|cs|swift|kt|mjs|cjs)$/.test(lower)) {
    return 'code'
  }

  // Document files
  if (/\.(md|txt|rst|adoc|html|css|scss)$/.test(lower)) {
    return 'document'
  }

  // Design files
  if (/\.(svg|fig|sketch|png|jpg|jpeg|gif|webp)$/.test(lower)) {
    return 'design'
  }

  return 'other'
}
