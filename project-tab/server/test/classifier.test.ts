import { describe, expect, it } from 'vitest'

import { EventClassifier } from '../src/classifier'
import type { AgentEvent, EventEnvelope } from '../src/types'

function envelope(event: AgentEvent): EventEnvelope {
  return {
    sourceEventId: `${event.type}-${Math.random().toString(16).slice(2)}`,
    sourceSequence: 1,
    sourceOccurredAt: '2026-02-10T00:00:00.000Z',
    runId: 'run-1',
    ingestedAt: '2026-02-10T00:00:01.000Z',
    event
  }
}

describe('EventClassifier', () => {
  const classifier = new EventClassifier()

  it('routes each event type to the expected primary workspace', () => {
    const cases: Array<{ event: AgentEvent; workspace: string }> = [
      { event: { type: 'status', agentId: 'a', message: 's' }, workspace: 'briefing' },
      {
        event: {
          type: 'decision',
          subtype: 'option',
          agentId: 'a',
          decisionId: 'd1',
          title: 'Pick',
          summary: 'Pick one',
          severity: 'low',
          confidence: 0.5,
          blastRadius: 'small',
          options: [{ id: 'o1', label: 'A', description: 'A' }],
          affectedArtifactIds: [],
          requiresRationale: true
        },
        workspace: 'queue'
      },
      {
        event: {
          type: 'decision',
          subtype: 'tool_approval',
          agentId: 'a',
          decisionId: 'd2',
          toolName: 'Bash',
          toolArgs: {}
        },
        workspace: 'queue'
      },
      {
        event: {
          type: 'artifact',
          agentId: 'a',
          artifactId: 'art1',
          name: 'x',
          kind: 'code',
          workstream: 'core',
          status: 'draft',
          qualityScore: 0.8,
          provenance: { createdBy: 'a', createdAt: '2026-02-10T00:00:00.000Z' }
        },
        workspace: 'map'
      },
      {
        event: {
          type: 'coherence',
          agentId: 'a',
          issueId: 'c1',
          title: 'Issue',
          description: 'desc',
          category: 'gap',
          severity: 'medium',
          affectedWorkstreams: [],
          affectedArtifactIds: []
        },
        workspace: 'map'
      },
      {
        event: {
          type: 'tool_call',
          agentId: 'a',
          toolCallId: 't1',
          toolName: 'Read',
          phase: 'requested',
          input: {},
          approved: true
        },
        workspace: 'controls'
      },
      {
        event: {
          type: 'completion',
          agentId: 'a',
          summary: 'done',
          artifactsProduced: [],
          decisionsNeeded: [],
          outcome: 'success'
        },
        workspace: 'briefing'
      },
      {
        event: {
          type: 'error',
          agentId: 'a',
          severity: 'low',
          message: 'err',
          recoverable: true,
          category: 'internal'
        },
        workspace: 'controls'
      },
      {
        event: {
          type: 'delegation',
          agentId: 'a',
          action: 'spawned',
          childAgentId: 'b',
          childRole: 'helper',
          reason: 'work',
          delegationDepth: 1,
          rootAgentId: 'a'
        },
        workspace: 'controls'
      },
      {
        event: {
          type: 'guardrail',
          agentId: 'a',
          guardrailName: 'secret-check',
          level: 'output',
          tripped: false,
          message: 'ok'
        },
        workspace: 'controls'
      },
      {
        event: {
          type: 'lifecycle',
          agentId: 'a',
          action: 'started'
        },
        workspace: 'controls'
      },
      {
        event: {
          type: 'progress',
          agentId: 'a',
          operationId: 'p1',
          description: 'running',
          progressPct: 10
        },
        workspace: 'briefing'
      },
      {
        event: {
          type: 'raw_provider',
          agentId: 'a',
          providerName: 'openai',
          eventType: 'delta',
          payload: {}
        },
        workspace: 'controls'
      }
    ]

    for (const entry of cases) {
      const classified = classifier.classify(envelope(entry.event))
      expect(classified.workspace).toBe(entry.workspace)
    }
  })

  it('routes high-severity coherence events to queue as secondary', () => {
    const classified = classifier.classify(
      envelope({
        type: 'coherence',
        agentId: 'a',
        issueId: 'c2',
        title: 'High issue',
        description: 'desc',
        category: 'contradiction',
        severity: 'high',
        affectedWorkstreams: ['core'],
        affectedArtifactIds: []
      })
    )

    expect(classified.workspace).toBe('map')
    expect(classified.secondaryWorkspaces).toEqual(['queue'])
  })

  it('routes tripped guardrails to queue as secondary', () => {
    const classified = classifier.classify(
      envelope({
        type: 'guardrail',
        agentId: 'a',
        guardrailName: 'dangerous-tool',
        level: 'tool',
        tripped: true,
        message: 'blocked'
      })
    )

    expect(classified.workspace).toBe('controls')
    expect(classified.secondaryWorkspaces).toEqual(['queue'])
  })

  it('routes high-severity error events to briefing as secondary', () => {
    const classified = classifier.classify(
      envelope({
        type: 'error',
        agentId: 'a',
        severity: 'critical',
        message: 'fatal',
        recoverable: false,
        category: 'provider'
      })
    )

    expect(classified.workspace).toBe('controls')
    expect(classified.secondaryWorkspaces).toEqual(['briefing'])
  })
})
