/**
 * Map Claude CLI stream-json NDJSON events to wire protocol AgentEvent objects.
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  AgentEvent,
  ArtifactKind,
} from './models.js'

export function inferArtifactKind(filePath: string): ArtifactKind {
  const base = filePath.split('/').pop() ?? filePath
  const ext = (base.includes('.') ? '.' + base.split('.').pop()! : '').toLowerCase()

  if (base.includes('.test.') || base.includes('.spec.') || base.startsWith('test_')) {
    return 'test'
  }
  if (['.ts', '.js', '.py', '.rs', '.go', '.java', '.tsx', '.jsx'].includes(ext)) return 'code'
  if (['.md', '.txt', '.rst'].includes(ext)) return 'document'
  if (['.json', '.yaml', '.yml', '.toml', '.ini', '.cfg'].includes(ext)) return 'config'
  return 'other'
}

interface OpenToolCall {
  toolCallId: string
  toolName: string
  startTime: number
  input?: Record<string, unknown>
}

export class ClaudeEventMapper {
  readonly agentId: string
  readonly workstream: string
  sessionId: string | null = null

  private _openToolCalls = new Map<string, OpenToolCall>()

  constructor(agentId: string, workstream: string) {
    this.agentId = agentId
    this.workstream = workstream
  }

  mapEvent(data: Record<string, unknown>): AgentEvent[] {
    const type = data.type as string | undefined
    const events: AgentEvent[] = []

    if (!type) return events

    // System init -- extract session ID
    if (type === 'system' && data.subtype === 'init') {
      this.sessionId = (data.session_id ?? data.sessionId ?? null) as string | null
      return events
    }

    // Assistant message
    if (type === 'assistant') {
      return this._handleAssistant(data)
    }

    // User message (tool results from Claude CLI)
    if (type === 'user') {
      const msg = data.message as Record<string, unknown> | undefined
      if (msg) {
        return this._handleToolResults(msg.content as Array<Record<string, unknown>> | undefined)
      }
      return events
    }

    // Result message (final completion)
    if (type === 'result') {
      return this._handleResult(data)
    }

    return events
  }

  private _handleAssistant(data: Record<string, unknown>): AgentEvent[] {
    const events: AgentEvent[] = []
    // stream-json wraps content inside data.message.content
    const msg = data.message as Record<string, unknown> | undefined
    const content = (msg?.content ?? data.content) as Array<Record<string, unknown>> | undefined

    if (!Array.isArray(content)) {
      // Might be a simple text message — extract from data.text or a plain string message
      const text = (data.text ?? (typeof msg === 'string' ? msg : '')) as string
      if (text) {
        events.push({
          type: 'status',
          agentId: this.agentId,
          message: text.length > 500 ? text.slice(0, 497) + '...' : text,
        })
      }
      return events
    }

    for (const block of content) {
      if (block.type === 'text') {
        const text = (block.text ?? '') as string
        if (text) {
          events.push({
            type: 'status',
            agentId: this.agentId,
            message: text.length > 500 ? text.slice(0, 497) + '...' : text,
          })
        }
      } else if (block.type === 'tool_use') {
        const toolUseId = (block.id ?? uuidv4()) as string
        const toolName = (block.name ?? 'unknown') as string
        const input = (block.input ?? {}) as Record<string, unknown>
        const toolCallId = uuidv4()

        this._openToolCalls.set(toolUseId, {
          toolCallId,
          toolName,
          startTime: Date.now(),
          input,
        })

        events.push({
          type: 'tool_call',
          agentId: this.agentId,
          toolCallId,
          toolName,
          phase: 'requested',
          input,
          approved: true,
        })
      }
    }

    return events
  }

  private _handleToolResults(content: Array<Record<string, unknown>> | undefined): AgentEvent[] {
    const events: AgentEvent[] = []
    if (!Array.isArray(content)) return events

    for (const block of content) {
      if (block.type === 'tool_result') {
        const toolUseId = (block.tool_use_id ?? block.toolUseId ?? '') as string
        const tc = this._openToolCalls.get(toolUseId)
        const toolCallId = tc?.toolCallId ?? uuidv4()
        const toolName = tc?.toolName ?? 'unknown'
        const isError = block.is_error === true || block.isError === true
        const durationMs = tc ? Date.now() - tc.startTime : undefined

        events.push({
          type: 'tool_call',
          agentId: this.agentId,
          toolCallId,
          toolName,
          phase: isError ? 'failed' : 'completed',
          output: block.content ?? block.output,
          approved: true,
          durationMs,
        })

        // Artifact detection: Write or Edit with file_path
        if (!isError && tc && (toolName === 'Write' || toolName === 'Edit')) {
          const filePath = (tc.input?.file_path ?? tc.input?.filePath ?? '') as string
          if (filePath) {
            const fileName = filePath.split('/').pop() ?? filePath
            const nowIso = new Date().toISOString()
            events.push({
              type: 'artifact',
              agentId: this.agentId,
              artifactId: uuidv4(),
              name: fileName,
              kind: inferArtifactKind(filePath),
              workstream: this.workstream,
              status: 'draft',
              qualityScore: 0.5,
              provenance: {
                createdBy: this.agentId,
                createdAt: nowIso,
              },
              uri: filePath,
            })
          }
        }

        if (tc) {
          this._openToolCalls.delete(toolUseId)
        }
      }
    }
    return events
  }

  private _handleResult(data: Record<string, unknown>): AgentEvent[] {
    const events: AgentEvent[] = []
    // Handle any inline tool results
    const content = data.content as Array<Record<string, unknown>> | undefined
    events.push(...this._handleToolResults(content))

    // Check if this is a final result (has result field or subtype)
    const subtype = data.subtype as string | undefined
    const resultField = data.result as string | undefined
    if (subtype === 'success' || resultField !== undefined) {
      const summary = (resultField ?? data.summary ?? 'Claude session completed') as string
      events.push({
        type: 'completion',
        agentId: this.agentId,
        summary: summary.length > 500 ? summary.slice(0, 497) + '...' : summary,
        artifactsProduced: [],
        decisionsNeeded: [],
        outcome: 'success',
      })
    } else if (subtype === 'error' || subtype === 'max_turns') {
      events.push({
        type: 'completion',
        agentId: this.agentId,
        summary: (data.error ?? data.message ?? `Session ended: ${subtype}`) as string,
        artifactsProduced: [],
        decisionsNeeded: [],
        outcome: subtype === 'max_turns' ? 'max_turns' : 'abandoned',
      })
    }

    return events
  }
}
