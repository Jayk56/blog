/**
 * Test fixtures for integration tests.
 *
 * Provides scripted event sequences, mock agent briefs, and helper factories
 * for all 18 Phase 1 acceptance criteria.
 */
import type { AdapterEvent, AgentBrief, KnowledgeSnapshot, AgentEvent } from '../../src/types'
import type { MockShimEvent } from './mock-adapter-shim'

const NOW = '2026-02-10T00:00:00.000Z'

let seqCounter = 0
export function resetSeqCounter(): void {
  seqCounter = 0
}

/** Creates an AdapterEvent with auto-incrementing sequence. */
export function makeAdapterEvent(
  event: AgentEvent,
  overrides: Partial<Omit<AdapterEvent, 'event'>> = {},
): AdapterEvent {
  seqCounter++
  return {
    sourceEventId: overrides.sourceEventId ?? `evt-${seqCounter}`,
    sourceSequence: overrides.sourceSequence ?? seqCounter,
    sourceOccurredAt: overrides.sourceOccurredAt ?? NOW,
    runId: overrides.runId ?? 'run-test-1',
    event,
  }
}

/** Wraps an AdapterEvent into a MockShimEvent. */
export function shimEvent(
  event: AgentEvent,
  delayMs = 10,
  blockOnDecisionId?: string,
  adapterOverrides?: Partial<Omit<AdapterEvent, 'event'>>,
): MockShimEvent {
  return {
    delayMs,
    event: makeAdapterEvent(event, adapterOverrides),
    blockOnDecisionId,
  }
}

/** Minimal empty knowledge snapshot for agent briefs. */
export function emptySnapshot(): KnowledgeSnapshot {
  return {
    version: 0,
    generatedAt: NOW,
    workstreams: [],
    pendingDecisions: [],
    recentCoherenceIssues: [],
    artifactIndex: [],
    activeAgents: [],
    estimatedTokens: 0,
  }
}

/** Creates a minimal valid AgentBrief for testing. */
export function makeAgentBrief(overrides: Partial<AgentBrief> = {}): AgentBrief {
  return {
    agentId: overrides.agentId ?? 'test-agent-1',
    role: overrides.role ?? 'Test Agent',
    description: overrides.description ?? 'An agent for integration tests',
    workstream: overrides.workstream ?? 'testing',
    readableWorkstreams: overrides.readableWorkstreams ?? [],
    constraints: overrides.constraints ?? [],
    escalationProtocol: overrides.escalationProtocol ?? {
      alwaysEscalate: [],
      escalateWhen: [],
      neverEscalate: [],
    },
    controlMode: overrides.controlMode ?? 'orchestrator',
    projectBrief: overrides.projectBrief ?? {
      title: 'Test Project',
      description: 'A project for integration testing',
      goals: ['Test all acceptance criteria'],
      checkpoints: ['All tests passing'],
    },
    knowledgeSnapshot: overrides.knowledgeSnapshot ?? emptySnapshot(),
    allowedTools: overrides.allowedTools ?? ['Read', 'Write', 'Bash'],
    providerConfig: overrides.providerConfig,
  }
}

// ── Scripted event sequences for specific acceptance criteria ──

/**
 * AC3: StatusEvent and ToolCallEvent streaming.
 * Events that flow through the pipeline after spawn.
 */
export function statusAndToolCallSequence(agentId: string): MockShimEvent[] {
  resetSeqCounter()
  return [
    shimEvent({ type: 'status', agentId, message: 'Agent started' }),
    shimEvent({ type: 'status', agentId, message: 'Reading codebase' }),
    shimEvent({
      type: 'tool_call',
      agentId,
      toolCallId: 'tc-1',
      toolName: 'Read',
      phase: 'requested',
      input: { path: '/src/index.ts' },
      approved: true,
    }),
    shimEvent({
      type: 'tool_call',
      agentId,
      toolCallId: 'tc-1',
      toolName: 'Read',
      phase: 'completed',
      input: { path: '/src/index.ts' },
      output: 'file contents...',
      approved: true,
      durationMs: 42,
    }),
    shimEvent({ type: 'status', agentId, message: 'Analysis complete' }),
  ]
}

/**
 * AC4: DecisionEvent with tool_approval that blocks until resolved.
 */
export function decisionBlockSequence(agentId: string): MockShimEvent[] {
  resetSeqCounter()
  return [
    shimEvent({ type: 'status', agentId, message: 'Starting task' }),
    shimEvent(
      {
        type: 'decision',
        subtype: 'tool_approval',
        agentId,
        decisionId: 'dec-1',
        toolName: 'Bash',
        toolArgs: { command: 'rm -rf /' },
        severity: 'high',
        blastRadius: 'large',
      },
      10,
      'dec-1', // Block here until resolved
    ),
    // These events emit only after the decision is resolved
    shimEvent({ type: 'status', agentId, message: 'Decision resolved, continuing' }),
    shimEvent({
      type: 'completion',
      agentId,
      summary: 'Task completed',
      artifactsProduced: [],
      decisionsNeeded: [],
      outcome: 'success',
    }),
  ]
}

/**
 * AC5: ArtifactEvent with URI rewriting.
 */
export function artifactSequence(agentId: string): MockShimEvent[] {
  resetSeqCounter()
  return [
    shimEvent({ type: 'status', agentId, message: 'Creating artifact' }),
    shimEvent({
      type: 'artifact',
      agentId,
      artifactId: 'art-1',
      name: 'report.md',
      kind: 'document',
      workstream: 'testing',
      status: 'draft',
      qualityScore: 0.85,
      provenance: {
        createdBy: agentId,
        createdAt: NOW,
        sourcePath: '/docs/report.md',
      },
      uri: 'file:///tmp/sandbox/report.md',
    }),
    shimEvent({ type: 'status', agentId, message: 'Artifact uploaded' }),
  ]
}

/**
 * AC5 + AC13: ArtifactEvent with conflicting sourcePath (coherence test).
 */
export function artifactConflictSequence(agentId: string): MockShimEvent[] {
  resetSeqCounter()
  return [
    shimEvent({
      type: 'artifact',
      agentId,
      artifactId: 'art-conflict-1',
      name: 'shared-config.json',
      kind: 'config',
      workstream: 'frontend',
      status: 'draft',
      qualityScore: 0.9,
      provenance: {
        createdBy: agentId,
        createdAt: NOW,
        sourcePath: '/config/shared.json',
      },
    }),
    shimEvent({
      type: 'artifact',
      agentId,
      artifactId: 'art-conflict-2',
      name: 'shared-config.json',
      kind: 'config',
      workstream: 'backend',
      status: 'draft',
      qualityScore: 0.8,
      provenance: {
        createdBy: agentId,
        createdAt: NOW,
        sourcePath: '/config/shared.json', // Same path! Should trigger Layer 0 coherence
      },
    }),
  ]
}

/**
 * AC9: Agent crash (events that stop abruptly).
 * The mock shim is configured to crash after emitting 2 events.
 */
export function crashSequence(agentId: string): MockShimEvent[] {
  resetSeqCounter()
  return [
    shimEvent({ type: 'status', agentId, message: 'Starting...' }),
    shimEvent({
      type: 'tool_call',
      agentId,
      toolCallId: 'tc-crash',
      toolName: 'Read',
      phase: 'running',
      input: {},
      approved: true,
    }),
    // The mock shim will crash before emitting this event
    shimEvent({ type: 'status', agentId, message: 'This should never be seen' }),
  ]
}

/**
 * AC10: Malformed event that should be quarantined.
 * We include a well-formed event followed by a malformed one.
 */
export function malformedEventSequence(agentId: string): MockShimEvent[] {
  resetSeqCounter()
  return [
    shimEvent({ type: 'status', agentId, message: 'Valid event' }),
    // Malformed: missing agentId and wrong type
    {
      delayMs: 10,
      event: {
        sourceEventId: 'evt-malformed',
        sourceSequence: 2,
        sourceOccurredAt: 'not-a-date', // Invalid datetime
        runId: 'run-test-1',
        event: {
          type: 'status',
          // Missing agentId
          message: 'malformed event',
        } as any,
      },
    },
  ]
}

/**
 * AC16: Backpressure test sequence.
 * Generates more events than the per-agent queue capacity (500).
 */
export function backpressureSequence(agentId: string, count = 600): MockShimEvent[] {
  resetSeqCounter()
  const events: MockShimEvent[] = []

  // Fill with low-priority ToolCallEvents
  for (let i = 0; i < count; i++) {
    events.push(
      shimEvent(
        {
          type: 'tool_call',
          agentId,
          toolCallId: `tc-bp-${i}`,
          toolName: 'Read',
          phase: 'completed',
          input: { file: `file-${i}.ts` },
          approved: true,
          durationMs: 5,
        },
        0, // No delay, fire rapidly
      ),
    )
  }

  // Add a high-priority decision event that should survive backpressure
  events.push(
    shimEvent({
      type: 'decision',
      subtype: 'tool_approval',
      agentId,
      decisionId: 'dec-bp-survive',
      toolName: 'Bash',
      toolArgs: { command: 'test' },
    }),
  )

  return events
}

/**
 * AC6 + AC15: Emergency brake and orphaned decision sequence.
 * Agent emits a decision, gets killed via brake, decision becomes orphaned.
 */
export function brakeAndOrphanSequence(agentId: string): MockShimEvent[] {
  resetSeqCounter()
  return [
    shimEvent({ type: 'status', agentId, message: 'Working...' }),
    shimEvent(
      {
        type: 'decision',
        subtype: 'tool_approval',
        agentId,
        decisionId: 'dec-orphan',
        toolName: 'Deploy',
        toolArgs: { target: 'production' },
        severity: 'critical',
        blastRadius: 'large',
      },
      10,
      'dec-orphan', // Block on this decision
    ),
    // This event won't emit because brake kills the agent first
    shimEvent({ type: 'status', agentId, message: 'Should not appear' }),
  ]
}

/**
 * AC8 + AC12: Trust score update sequence.
 * Agent emits a decision, it gets resolved, trust updates should flow.
 */
export function trustUpdateSequence(agentId: string): MockShimEvent[] {
  resetSeqCounter()
  return [
    shimEvent({ type: 'status', agentId, message: 'Starting task' }),
    shimEvent(
      {
        type: 'decision',
        subtype: 'tool_approval',
        agentId,
        decisionId: 'dec-trust',
        toolName: 'Write',
        toolArgs: { path: '/src/main.ts', content: '...' },
      },
      10,
      'dec-trust',
    ),
    shimEvent({ type: 'status', agentId, message: 'Continuing after approval' }),
    shimEvent({
      type: 'completion',
      agentId,
      summary: 'Done',
      artifactsProduced: [],
      decisionsNeeded: [],
      outcome: 'success',
    }),
  ]
}
