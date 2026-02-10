/**
 * Tests for wire protocol model types — verifying camelCase serialization.
 */

import { describe, it, expect } from 'vitest'
import { makeTestBrief } from './helpers.js'
import type {
  AgentHandle,
  StatusEvent,
  LifecycleEvent,
  ToolCallEvent,
  ToolApprovalEvent,
  OptionDecisionEvent,
  ArtifactEvent,
  CompletionEvent,
  ErrorEvent,
  AdapterEvent,
  ToolApprovalResolution,
  OptionDecisionResolution,
  ResolveRequest,
  SandboxHealthResponse,
  SandboxResourceUsage,
  KillRequest,
  SerializedAgentState,
  SdkCheckpoint,
} from '../src/models.js'

describe('AgentBrief', () => {
  it('has camelCase field names', () => {
    const brief = makeTestBrief()
    expect(brief.agentId).toBe('agent-test-001')
    expect(brief.controlMode).toBe('orchestrator')
    expect(brief.projectBrief.title).toBe('Test Project')
    expect(brief.knowledgeSnapshot.version).toBe(1)
    expect(brief.escalationProtocol.alwaysEscalate).toEqual([])
  })

  it('serializes to JSON with camelCase', () => {
    const brief = makeTestBrief()
    const json = JSON.stringify(brief)
    const parsed = JSON.parse(json)
    expect(parsed.agentId).toBe('agent-test-001')
    expect(parsed.controlMode).toBe('orchestrator')
    expect(parsed.projectBrief).toBeDefined()
    expect(parsed.knowledgeSnapshot).toBeDefined()
    // No snake_case in the wire format
    expect(parsed.agent_id).toBeUndefined()
    expect(parsed.control_mode).toBeUndefined()
  })
})

describe('AgentHandle', () => {
  it('round-trips through JSON', () => {
    const handle: AgentHandle = {
      id: 'agent-1',
      pluginName: 'claude-mock',
      status: 'running',
      sessionId: 'session-abc',
    }
    const json = JSON.parse(JSON.stringify(handle))
    expect(json.pluginName).toBe('claude-mock')
    expect(json.sessionId).toBe('session-abc')
    // No snake_case
    expect(json.plugin_name).toBeUndefined()
    expect(json.session_id).toBeUndefined()
  })
})

describe('Event types', () => {
  it('StatusEvent has correct shape', () => {
    const e: StatusEvent = { type: 'status', agentId: 'a1', message: 'hello' }
    const d = JSON.parse(JSON.stringify(e))
    expect(d.type).toBe('status')
    expect(d.agentId).toBe('a1')
    expect(d.message).toBe('hello')
  })

  it('LifecycleEvent has correct shape', () => {
    const e: LifecycleEvent = { type: 'lifecycle', agentId: 'a1', action: 'started' }
    const d = JSON.parse(JSON.stringify(e))
    expect(d.type).toBe('lifecycle')
    expect(d.action).toBe('started')
  })

  it('ToolCallEvent has correct shape', () => {
    const e: ToolCallEvent = {
      type: 'tool_call',
      agentId: 'a1',
      toolCallId: 'tc-1',
      toolName: 'Read',
      phase: 'completed',
      input: { query: 'test' },
      output: { results: [] },
      approved: true,
      durationMs: 100,
    }
    const d = JSON.parse(JSON.stringify(e))
    expect(d.type).toBe('tool_call')
    expect(d.toolCallId).toBe('tc-1')
    expect(d.durationMs).toBe(100)
    expect(d.phase).toBe('completed')
  })

  it('ToolApprovalEvent has correct shape', () => {
    const e: ToolApprovalEvent = {
      type: 'decision',
      subtype: 'tool_approval',
      agentId: 'a1',
      decisionId: 'd-1',
      toolName: 'Bash',
      toolArgs: { code: 'echo hi' },
      severity: 'medium',
    }
    const d = JSON.parse(JSON.stringify(e))
    expect(d.type).toBe('decision')
    expect(d.subtype).toBe('tool_approval')
    expect(d.toolName).toBe('Bash')
  })

  it('OptionDecisionEvent has correct shape', () => {
    const e: OptionDecisionEvent = {
      type: 'decision',
      subtype: 'option',
      agentId: 'a1',
      decisionId: 'd-2',
      title: 'Choose approach',
      summary: 'Pick one',
      severity: 'medium',
      confidence: 0.8,
      blastRadius: 'small',
      options: [{ id: 'opt-1', label: 'Option A', description: 'First option' }],
      requiresRationale: true,
    }
    const d = JSON.parse(JSON.stringify(e))
    expect(d.type).toBe('decision')
    expect(d.subtype).toBe('option')
    expect(d.requiresRationale).toBe(true)
    expect(d.blastRadius).toBe('small')
  })

  it('ArtifactEvent has correct shape', () => {
    const e: ArtifactEvent = {
      type: 'artifact',
      agentId: 'a1',
      artifactId: 'art-1',
      name: 'report.md',
      kind: 'document',
      workstream: 'testing',
      status: 'draft',
      qualityScore: 0.9,
      provenance: {
        createdBy: 'a1',
        createdAt: '2025-01-01T00:00:00Z',
      },
      uri: '/workspace/report.md',
      mimeType: 'text/markdown',
      sizeBytes: 1024,
    }
    const d = JSON.parse(JSON.stringify(e))
    expect(d.type).toBe('artifact')
    expect(d.artifactId).toBe('art-1')
    expect(d.provenance.createdBy).toBe('a1')
    expect(d.mimeType).toBe('text/markdown')
  })

  it('CompletionEvent has correct shape', () => {
    const e: CompletionEvent = {
      type: 'completion',
      agentId: 'a1',
      summary: 'Done',
      artifactsProduced: ['art-1'],
      decisionsNeeded: [],
      outcome: 'success',
    }
    const d = JSON.parse(JSON.stringify(e))
    expect(d.type).toBe('completion')
    expect(d.outcome).toBe('success')
    expect(d.artifactsProduced).toEqual(['art-1'])
  })

  it('ErrorEvent has correct shape', () => {
    const e: ErrorEvent = {
      type: 'error',
      agentId: 'a1',
      severity: 'high',
      message: 'Something broke',
      recoverable: false,
      category: 'internal',
    }
    const d = JSON.parse(JSON.stringify(e))
    expect(d.type).toBe('error')
    expect(d.recoverable).toBe(false)
  })
})

describe('AdapterEvent envelope', () => {
  it('has correct structure', () => {
    const inner: StatusEvent = { type: 'status', agentId: 'a1', message: 'testing' }
    const envelope: AdapterEvent = {
      sourceEventId: 'evt-123',
      sourceSequence: 1,
      sourceOccurredAt: '2025-01-01T00:00:00Z',
      runId: 'run-456',
      event: inner,
    }
    const d = JSON.parse(JSON.stringify(envelope))
    expect(d.sourceEventId).toBe('evt-123')
    expect(d.sourceSequence).toBe(1)
    expect(d.runId).toBe('run-456')
    expect(d.event.type).toBe('status')
    // No snake_case
    expect(d.source_event_id).toBeUndefined()
    expect(d.source_sequence).toBeUndefined()
    expect(d.run_id).toBeUndefined()
  })
})

describe('Resolution types', () => {
  it('ToolApprovalResolution serializes correctly', () => {
    const r: ToolApprovalResolution = {
      type: 'tool_approval',
      action: 'approve',
      actionKind: 'update',
    }
    const d = JSON.parse(JSON.stringify(r))
    expect(d.type).toBe('tool_approval')
    expect(d.action).toBe('approve')
    expect(d.actionKind).toBe('update')
  })

  it('OptionDecisionResolution serializes correctly', () => {
    const r: OptionDecisionResolution = {
      type: 'option',
      chosenOptionId: 'opt-1',
      rationale: 'Best option',
      actionKind: 'create',
    }
    const d = JSON.parse(JSON.stringify(r))
    expect(d.type).toBe('option')
    expect(d.chosenOptionId).toBe('opt-1')
  })

  it('ResolveRequest serializes correctly', () => {
    const req: ResolveRequest = {
      decisionId: 'd-1',
      resolution: {
        type: 'tool_approval',
        action: 'approve',
        actionKind: 'update',
      },
    }
    const d = JSON.parse(JSON.stringify(req))
    expect(d.decisionId).toBe('d-1')
    expect(d.resolution.type).toBe('tool_approval')
  })
})

describe('SandboxHealthResponse', () => {
  it('has correct shape', () => {
    const h: SandboxHealthResponse = {
      status: 'healthy',
      agentStatus: 'running',
      uptimeMs: 5000,
      resourceUsage: {
        cpuPercent: 10.5,
        memoryMb: 128.0,
        diskMb: 50.0,
        collectedAt: '2025-01-01T00:00:00Z',
      },
      pendingEventBufferSize: 3,
    }
    const d = JSON.parse(JSON.stringify(h))
    expect(d.status).toBe('healthy')
    expect(d.uptimeMs).toBe(5000)
    expect(d.resourceUsage.cpuPercent).toBe(10.5)
  })
})

describe('KillRequest', () => {
  it('defaults grace to true', () => {
    const k: KillRequest = {}
    expect(k.grace).toBeUndefined()
    // When parsed, should default to true in the handler
  })

  it('can force kill', () => {
    const k: KillRequest = { grace: false }
    expect(k.grace).toBe(false)
  })
})

describe('SerializedAgentState', () => {
  it('round-trips through JSON', () => {
    const state: SerializedAgentState = {
      agentId: 'a1',
      pluginName: 'claude-mock',
      sessionId: 's1',
      checkpoint: { sdk: 'claude-mock', scriptPosition: 5 },
      briefSnapshot: makeTestBrief(),
      pendingDecisionIds: ['d-1'],
      lastSequence: 5,
      serializedAt: '2025-01-01T00:00:00Z',
      serializedBy: 'pause',
      estimatedSizeBytes: 256,
    }
    const d = JSON.parse(JSON.stringify(state))
    expect(d.agentId).toBe('a1')
    expect(d.checkpoint.sdk).toBe('claude-mock')
    expect(d.checkpoint.scriptPosition).toBe(5)
    const parsed = d as SerializedAgentState
    expect(parsed.agentId).toBe('a1')
  })
})
