/**
 * Tests for the mock runner scripted event sequence.
 */

import { describe, it, expect } from 'vitest'
import { MockRunner } from '../src/mock-runner.js'
import { makeTestBrief } from './helpers.js'
import type {
  LifecycleEvent,
  StatusEvent,
  ToolCallEvent,
  OptionDecisionEvent,
  ArtifactEvent,
  CompletionEvent,
  ResolveRequest,
} from '../src/models.js'

function createRunner(): MockRunner {
  return new MockRunner(makeTestBrief())
}

describe('MockRunner', () => {
  it('emits lifecycle(started) as first event', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 150))

    const events = runner.drainEvents()
    expect(events.length).toBeGreaterThanOrEqual(1)
    const first = events[0]
    expect(first.event.type).toBe('lifecycle')
    expect((first.event as LifecycleEvent).action).toBe('started')
  })

  it('emits status event second', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 200))

    const events = runner.drainEvents()
    expect(events.length).toBeGreaterThanOrEqual(2)
    const second = events[1]
    expect(second.event.type).toBe('status')
    expect((second.event as StatusEvent).message).toBe('Analyzing codebase...')
  })

  it('emits tool_call phases for Read tool', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 400))

    const events = runner.drainEvents()
    const toolCalls = events.filter(e => e.event.type === 'tool_call')
    // Read: requested, running, completed; Edit: requested, completed
    const readCalls = toolCalls.filter(e => (e.event as ToolCallEvent).toolName === 'Read')
    expect(readCalls.length).toBe(3)
    const phases = readCalls.map(e => (e.event as ToolCallEvent).phase)
    expect(phases).toEqual(['requested', 'running', 'completed'])
  })

  it('emits tool_call phases for Edit tool', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 500))

    const events = runner.drainEvents()
    const toolCalls = events.filter(e => e.event.type === 'tool_call')
    const editCalls = toolCalls.filter(e => (e.event as ToolCallEvent).toolName === 'Edit')
    expect(editCalls.length).toBe(2) // requested + completed
    const phases = editCalls.map(e => (e.event as ToolCallEvent).phase)
    expect(phases).toEqual(['requested', 'completed'])
  })

  it('emits option decision and waits', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 600))

    const events = runner.drainEvents()
    const decisions = events.filter(e => e.event.type === 'decision')
    expect(decisions.length).toBe(1)
    const decision = decisions[0].event as OptionDecisionEvent
    expect(decision.subtype).toBe('option')
    expect(decision.title).toBe('Architecture pattern for pipeline module')
    expect(decision.options.length).toBe(3)
    expect(decision.recommendedOptionId).toBe('opt-hybrid')

    // Runner should be waiting
    expect(runner.handle.status).toBe('waiting_on_human')
  })

  it('completes full sequence after resolve', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 600))

    // Drain pre-resolve events
    const preEvents = runner.drainEvents()
    const decisions = preEvents.filter(e => e.event.type === 'decision')
    expect(decisions.length).toBe(1)
    const decisionId = (decisions[0].event as OptionDecisionEvent).decisionId

    // Resolve the decision
    const resolved = runner.resolveDecision({
      decisionId,
      resolution: {
        type: 'option',
        chosenOptionId: 'opt-hybrid',
        rationale: 'Best balance of simplicity and flexibility',
        actionKind: 'create',
      },
    })
    expect(resolved).toBe(true)

    // Wait for post-resolve events
    await new Promise(r => setTimeout(r, 300))
    const postEvents = runner.drainEvents()

    const types = postEvents.map(e => e.event.type)
    expect(types).toContain('artifact')
    expect(types).toContain('completion')

    // Check artifact
    const artifactEvent = postEvents.find(e => e.event.type === 'artifact')!
    expect((artifactEvent.event as ArtifactEvent).name).toBe('pipeline.ts')
    expect((artifactEvent.event as ArtifactEvent).kind).toBe('code')

    // Check completion
    const completionEvent = postEvents.find(e => e.event.type === 'completion')!
    expect((completionEvent.event as CompletionEvent).outcome).toBe('success')

    // Runner should be done
    expect(runner.handle.status).toBe('completed')
    expect(runner.isRunning).toBe(false)
  })

  it('produces monotonically increasing sequence numbers', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 600))

    const preEvents = runner.drainEvents()
    const decisions = preEvents.filter(e => e.event.type === 'decision')
    const decisionId = (decisions[0].event as OptionDecisionEvent).decisionId

    runner.resolveDecision({
      decisionId,
      resolution: {
        type: 'option',
        chosenOptionId: 'opt-chain',
        rationale: 'Simplest',
        actionKind: 'create',
      },
    })
    await new Promise(r => setTimeout(r, 300))
    const postEvents = runner.drainEvents()

    const allEvents = [...preEvents, ...postEvents]
    const sequences = allEvents.map(e => e.sourceSequence)
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b))
    // All unique
    expect(new Set(sequences).size).toBe(sequences.length)
  })

  it('all events share the same runId', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 600))

    const preEvents = runner.drainEvents()
    const decisions = preEvents.filter(e => e.event.type === 'decision')
    const decisionId = (decisions[0].event as OptionDecisionEvent).decisionId

    runner.resolveDecision({
      decisionId,
      resolution: {
        type: 'option',
        chosenOptionId: 'opt-events',
        rationale: 'Most flexible',
        actionKind: 'create',
      },
    })
    await new Promise(r => setTimeout(r, 300))
    const postEvents = runner.drainEvents()

    const allEvents = [...preEvents, ...postEvents]
    const runIds = new Set(allEvents.map(e => e.runId))
    expect(runIds.size).toBe(1)
  })

  it('all events have the correct agentId', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 600))

    const preEvents = runner.drainEvents()
    const decisions = preEvents.filter(e => e.event.type === 'decision')
    const decisionId = (decisions[0].event as OptionDecisionEvent).decisionId

    runner.resolveDecision({
      decisionId,
      resolution: {
        type: 'option',
        chosenOptionId: 'opt-hybrid',
        rationale: 'Good balance',
        actionKind: 'create',
      },
    })
    await new Promise(r => setTimeout(r, 300))
    const postEvents = runner.drainEvents()

    const allEvents = [...preEvents, ...postEvents]
    for (const event of allEvents) {
      expect((event.event as any).agentId).toBe('agent-test-001')
    }
  })

  it('kill stops the runner', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 150))

    const response = await runner.kill(true)
    expect(response.cleanShutdown).toBe(true)
    expect(runner.isRunning).toBe(false)

    // Should have a killed lifecycle event
    const events = runner.drainEvents()
    const lifecycleEvents = events.filter(e => e.event.type === 'lifecycle')
    const killed = lifecycleEvents.filter(e => (e.event as LifecycleEvent).action === 'killed')
    expect(killed.length).toBe(1)
  })

  it('force kill sets cleanShutdown to false', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 150))

    const response = await runner.kill(false)
    expect(response.cleanShutdown).toBe(false)
  })

  it('pause returns serialized state', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 200))

    const state = await runner.pause()
    expect(state.agentId).toBe('agent-test-001')
    expect(state.pluginName).toBe('claude-mock')
    expect(state.checkpoint.sdk).toBe('claude-mock')
    expect(state.serializedBy).toBe('pause')
    expect(runner.isRunning).toBe(false)
  })

  it('resolve with wrong id returns false', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 600))

    const resolved = runner.resolveDecision({
      decisionId: 'nonexistent',
      resolution: {
        type: 'option',
        chosenOptionId: 'opt-1',
        rationale: 'test',
        actionKind: 'create',
      },
    })
    expect(resolved).toBe(false)
  })

  it('uses claude-mock as plugin name', () => {
    const runner = createRunner()
    expect(runner.handle.pluginName).toBe('claude-mock')
    expect(MockRunner.PLUGIN_NAME).toBe('claude-mock')
  })

  it('has claude-specific capabilities (no pause support)', async () => {
    // The Claude adapter declares supportsPause=false
    // Verify that pause still works (best-effort) but indicates it in checkpoint
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 200))

    const state = await runner.pause()
    expect(state.checkpoint.sdk).toBe('claude-mock')
    // Claude adapter indicates partial support via the sdk field
    expect(state.serializedBy).toBe('pause')
  })

  it('decision options have expected fields', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 600))

    const events = runner.drainEvents()
    const decisions = events.filter(e => e.event.type === 'decision')
    const decision = decisions[0].event as OptionDecisionEvent

    for (const opt of decision.options) {
      expect(opt.id).toBeDefined()
      expect(opt.label).toBeDefined()
      expect(opt.description).toBeDefined()
      expect(opt.tradeoffs).toBeDefined()
    }
  })

  it('artifact has provenance and workstream', async () => {
    const runner = createRunner()
    runner.start()
    await new Promise(r => setTimeout(r, 600))

    const preEvents = runner.drainEvents()
    const decisions = preEvents.filter(e => e.event.type === 'decision')
    const decisionId = (decisions[0].event as OptionDecisionEvent).decisionId

    runner.resolveDecision({
      decisionId,
      resolution: {
        type: 'option',
        chosenOptionId: 'opt-hybrid',
        rationale: 'Good balance',
        actionKind: 'create',
      },
    })
    await new Promise(r => setTimeout(r, 300))
    const postEvents = runner.drainEvents()

    const artifactEvent = postEvents.find(e => e.event.type === 'artifact')!
    const artifact = artifactEvent.event as ArtifactEvent
    expect(artifact.workstream).toBe('testing')
    expect(artifact.provenance.createdBy).toBe('agent-test-001')
    expect(artifact.provenance.createdAt).toBeDefined()
    expect(artifact.mimeType).toBe('text/typescript')
  })
})
