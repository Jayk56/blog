import { describe, expect, it, vi } from 'vitest'

import {
  ConstraintInferenceService,
  type ConstraintInferenceStore,
  type ConstraintSuggestion,
} from '../../src/intelligence/constraint-inference-service'
import type { AuditLogEntry } from '../../src/intelligence/override-pattern-analyzer'

// ── Helpers ────────────────────────────────────────────────────────

function makeOverrideEntry(
  tick: number,
  overrides?: {
    agentId?: string
    workstreams?: string[]
    artifactKinds?: string[]
    toolName?: string
  }
): AuditLogEntry {
  return {
    entityType: 'trust_outcome',
    entityId: `d-${tick}`,
    action: 'decision_resolution',
    callerAgentId: overrides?.agentId ?? 'agent-1',
    timestamp: new Date().toISOString(),
    details: {
      agentId: overrides?.agentId ?? 'agent-1',
      outcome: 'human_overrides_agent_decision',
      effectiveDelta: -1,
      newScore: 45,
      tick,
      decisionSubtype: 'option',
      severity: 'medium',
      blastRadius: 'small',
      toolName: overrides?.toolName,
      affectedArtifactIds: [],
      affectedWorkstreams: overrides?.workstreams ?? [],
      affectedArtifactKinds: overrides?.artifactKinds ?? [],
    },
  }
}

function makeCoherenceEntry(
  issueId: string,
  workstreams: string[]
): AuditLogEntry {
  return {
    entityType: 'coherence_issue',
    entityId: issueId,
    action: 'create',
    callerAgentId: 'agent-1',
    timestamp: new Date().toISOString(),
    details: {
      affectedWorkstreams: workstreams,
    },
  }
}

function makeNonOverrideEntry(tick: number): AuditLogEntry {
  return {
    entityType: 'trust_outcome',
    entityId: `d-${tick}`,
    action: 'decision_resolution',
    callerAgentId: 'agent-1',
    timestamp: new Date().toISOString(),
    details: {
      agentId: 'agent-1',
      outcome: 'human_approves_recommended_option',
      effectiveDelta: 2,
      newScore: 52,
      tick,
      decisionSubtype: 'option',
      severity: 'medium',
      blastRadius: 'small',
      affectedWorkstreams: ['backend'],
      affectedArtifactKinds: ['code'],
    },
  }
}

function createMockStore(entries: AuditLogEntry[] = []): ConstraintInferenceStore {
  return {
    listAuditLog: vi.fn(() => entries),
    appendAuditLog: vi.fn(),
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('ConstraintInferenceService', () => {
  it('returns empty suggestions when no audit data exists', () => {
    const store = createMockStore([])
    const service = new ConstraintInferenceService(store)

    const suggestions = service.suggestConstraints()

    expect(suggestions).toEqual([])
  })

  it('returns empty suggestions when only non-override outcomes exist', () => {
    const entries = [
      makeNonOverrideEntry(1),
      makeNonOverrideEntry(2),
      makeNonOverrideEntry(3),
    ]
    const store = createMockStore(entries)
    const service = new ConstraintInferenceService(store)

    const suggestions = service.suggestConstraints()

    expect(suggestions).toEqual([])
  })

  it('suggests workstream constraint when override threshold met', () => {
    const entries = [
      makeOverrideEntry(1, { workstreams: ['backend'] }),
      makeOverrideEntry(2, { workstreams: ['backend'] }),
      makeOverrideEntry(3, { workstreams: ['backend'] }),
    ]
    const store = createMockStore(entries)
    const service = new ConstraintInferenceService(store)

    const suggestions = service.suggestConstraints()

    expect(suggestions.length).toBeGreaterThanOrEqual(1)
    const wsSuggestion = suggestions.find(
      (s) => s.source === 'override_pattern' && s.text.includes('backend')
    )
    expect(wsSuggestion).toBeDefined()
    expect(wsSuggestion!.text).toContain('backend')
    expect(wsSuggestion!.reasoning).toContain('3')
    expect(wsSuggestion!.relatedEvidence.length).toBeGreaterThan(0)
  })

  it('does not suggest workstream constraint below threshold', () => {
    const entries = [
      makeOverrideEntry(1, { workstreams: ['backend'] }),
      makeOverrideEntry(2, { workstreams: ['backend'] }),
    ]
    const store = createMockStore(entries)
    const service = new ConstraintInferenceService(store)

    const suggestions = service.suggestConstraints()
    const wsSuggestion = suggestions.find(
      (s) => s.source === 'override_pattern' && s.text.includes('backend')
    )
    expect(wsSuggestion).toBeUndefined()
  })

  it('suggests tool constraint when override threshold met', () => {
    const entries = [
      makeOverrideEntry(1, { toolName: 'Bash' }),
      makeOverrideEntry(2, { toolName: 'Bash' }),
      makeOverrideEntry(3, { toolName: 'Bash' }),
    ]
    const store = createMockStore(entries)
    const service = new ConstraintInferenceService(store)

    const suggestions = service.suggestConstraints()

    const toolSuggestion = suggestions.find(
      (s) => s.source === 'override_pattern' && s.text.includes('Bash')
    )
    expect(toolSuggestion).toBeDefined()
    expect(toolSuggestion!.text).toContain('Bash')
    expect(toolSuggestion!.reasoning).toContain('3')
  })

  it('suggests coordination constraint when coherence pattern threshold met', () => {
    const entries = [
      makeCoherenceEntry('issue-1', ['frontend', 'backend']),
      makeCoherenceEntry('issue-2', ['frontend', 'backend']),
    ]
    const store = createMockStore(entries)
    const service = new ConstraintInferenceService(store)

    const suggestions = service.suggestConstraints()

    const cohSuggestion = suggestions.find(
      (s) => s.source === 'coherence_pattern'
    )
    expect(cohSuggestion).toBeDefined()
    expect(cohSuggestion!.text).toContain('coordination')
    expect(cohSuggestion!.text).toContain('backend')
    expect(cohSuggestion!.text).toContain('frontend')
    expect(cohSuggestion!.reasoning).toContain('2')
  })

  it('does not suggest coherence constraint below threshold', () => {
    const entries = [
      makeCoherenceEntry('issue-1', ['frontend', 'backend']),
    ]
    const store = createMockStore(entries)
    const service = new ConstraintInferenceService(store)

    const suggestions = service.suggestConstraints()
    const cohSuggestion = suggestions.find(
      (s) => s.source === 'coherence_pattern'
    )
    expect(cohSuggestion).toBeUndefined()
  })

  it('assigns confidence levels correctly based on count', () => {
    // 3 overrides = medium, 5+ = high
    const entries = [
      // 5 overrides in backend → high confidence
      ...Array.from({ length: 5 }, (_, i) =>
        makeOverrideEntry(i + 1, { workstreams: ['backend'] })
      ),
      // 3 overrides in frontend → medium confidence
      ...Array.from({ length: 3 }, (_, i) =>
        makeOverrideEntry(i + 10, { workstreams: ['frontend'] })
      ),
    ]
    const store = createMockStore(entries)
    const service = new ConstraintInferenceService(store)

    const suggestions = service.suggestConstraints()

    const backendSuggestion = suggestions.find(
      (s) => s.source === 'override_pattern' && s.text.includes('backend')
    )
    const frontendSuggestion = suggestions.find(
      (s) => s.source === 'override_pattern' && s.text.includes('frontend')
    )
    expect(backendSuggestion?.confidence).toBe('high')
    expect(frontendSuggestion?.confidence).toBe('medium')
  })

  it('stores feedback in audit log when accepted', () => {
    const store = createMockStore([])
    const service = new ConstraintInferenceService(store)

    service.recordFeedback('cs-1', true, 'Some constraint text')

    expect(store.appendAuditLog).toHaveBeenCalledWith(
      'constraint_feedback',
      'cs-1',
      'accepted',
      undefined,
      { suggestionId: 'cs-1', accepted: true, suggestionText: 'Some constraint text' }
    )
  })

  it('stores feedback in audit log when dismissed', () => {
    const store = createMockStore([])
    const service = new ConstraintInferenceService(store)

    service.recordFeedback('cs-2', false)

    expect(store.appendAuditLog).toHaveBeenCalledWith(
      'constraint_feedback',
      'cs-2',
      'dismissed',
      undefined,
      { suggestionId: 'cs-2', accepted: false, suggestionText: undefined }
    )
  })

  it('generates unique suggestion IDs', () => {
    const entries = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeOverrideEntry(i + 1, { workstreams: ['ws-a'], toolName: 'Write' })
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeOverrideEntry(i + 10, { workstreams: ['ws-b'], toolName: 'Bash' })
      ),
    ]
    const store = createMockStore(entries)
    const service = new ConstraintInferenceService(store)

    const suggestions = service.suggestConstraints()

    const ids = suggestions.map((s) => s.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('ignores coherence entries with fewer than 2 workstreams', () => {
    const entries = [
      makeCoherenceEntry('issue-1', ['backend']),
      makeCoherenceEntry('issue-2', ['backend']),
      makeCoherenceEntry('issue-3', ['backend']),
    ]
    const store = createMockStore(entries)
    const service = new ConstraintInferenceService(store)

    const suggestions = service.suggestConstraints()
    const cohSuggestion = suggestions.find(
      (s) => s.source === 'coherence_pattern'
    )
    expect(cohSuggestion).toBeUndefined()
  })
})
