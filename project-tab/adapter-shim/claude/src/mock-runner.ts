/**
 * Mock agent runner that emits a scripted sequence of events.
 *
 * The scripted sequence is:
 *   1. LifecycleEvent(started)
 *   2. StatusEvent("Analyzing codebase...")
 *   3. ToolCallEvent sequence (Read tool — reading a file)
 *   4. StatusEvent("Planning implementation...")
 *   5. ToolCallEvent sequence (Edit tool — modifying code)
 *   6. OptionDecisionEvent — agent proposes design choices, WAITS for resolution
 *   7. After resolve: ArtifactEvent (code file produced)
 *   8. CompletionEvent(success)
 */

import { v4 as uuidv4 } from 'uuid'
import { EventFactory } from './events.js'
import type {
  AdapterEvent,
  AgentBrief,
  AgentEvent,
  AgentHandle,
  KillResponse,
  ResolveRequest,
  SerializedAgentState,
} from './models.js'

export class MockRunner {
  static readonly PLUGIN_NAME = 'claude-mock'

  readonly brief: AgentBrief
  readonly agentId: string
  readonly sessionId: string

  private _factory: EventFactory
  private _handle: AgentHandle
  private _eventBuffer: AdapterEvent[] = []
  private _pendingDecisionId: string | null = null
  private _killed = false
  private _completed = false
  private _running = false

  // For decision blocking: resolve callback
  private _decisionResolve: ((req: ResolveRequest) => void) | null = null
  private _decisionReject: ((reason?: unknown) => void) | null = null
  private _runPromise: Promise<void> | null = null

  constructor(brief: AgentBrief) {
    this.brief = brief
    this.agentId = brief.agentId
    this.sessionId = uuidv4()
    this._factory = new EventFactory(uuidv4())
    this._handle = {
      id: this.agentId,
      pluginName: MockRunner.PLUGIN_NAME,
      status: 'running',
      sessionId: this.sessionId,
    }
  }

  get handle(): AgentHandle {
    return this._handle
  }

  get isRunning(): boolean {
    return this._running && !this._killed && !this._completed
  }

  get lastSequence(): number {
    return this._factory.lastSequence
  }

  start(): void {
    this._running = true
    this._runPromise = this._runScript()
  }

  private _emit(event: AgentEvent): void {
    const adapterEvent = this._factory.wrap(event)
    this._eventBuffer.push(adapterEvent)
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._killed) {
        resolve()
        return
      }
      const timer = setTimeout(resolve, ms)
      // Store a cleanup reference in case we get killed
      const checkKilled = setInterval(() => {
        if (this._killed) {
          clearTimeout(timer)
          clearInterval(checkKilled)
          resolve()
        }
      }, 10)
      // Auto-cleanup the interval when the timer fires naturally
      const origResolve = resolve
      // Note: the timer was already set, so we just clean up the interval on resolve
      void Promise.resolve().then(() => {
        // This won't affect anything, interval is cleaned by the check above
      })
    })
  }

  private async _runScript(): Promise<void> {
    try {
      // Step 1: LifecycleEvent(started)
      this._emit({
        type: 'lifecycle',
        agentId: this.agentId,
        action: 'started',
      })
      await this._sleep(50)
      if (this._killed) return

      // Step 2: StatusEvent
      this._emit({
        type: 'status',
        agentId: this.agentId,
        message: 'Analyzing codebase...',
      })
      await this._sleep(50)
      if (this._killed) return

      // Step 3: ToolCallEvent sequence (Read tool)
      const readToolCallId = uuidv4()
      this._emit({
        type: 'tool_call',
        agentId: this.agentId,
        toolCallId: readToolCallId,
        toolName: 'Read',
        phase: 'requested',
        input: { file_path: '/workspace/src/main.ts' },
        approved: true,
      })
      await this._sleep(30)

      this._emit({
        type: 'tool_call',
        agentId: this.agentId,
        toolCallId: readToolCallId,
        toolName: 'Read',
        phase: 'running',
        input: { file_path: '/workspace/src/main.ts' },
        approved: true,
      })
      await this._sleep(60)

      this._emit({
        type: 'tool_call',
        agentId: this.agentId,
        toolCallId: readToolCallId,
        toolName: 'Read',
        phase: 'completed',
        input: { file_path: '/workspace/src/main.ts' },
        output: { content: 'export function main() { /* ... */ }' },
        approved: true,
        durationMs: 90,
      })
      await this._sleep(30)
      if (this._killed) return

      // Step 4: StatusEvent
      this._emit({
        type: 'status',
        agentId: this.agentId,
        message: 'Planning implementation...',
      })
      await this._sleep(50)
      if (this._killed) return

      // Step 5: ToolCallEvent sequence (Edit tool)
      const editToolCallId = uuidv4()
      this._emit({
        type: 'tool_call',
        agentId: this.agentId,
        toolCallId: editToolCallId,
        toolName: 'Edit',
        phase: 'requested',
        input: {
          file_path: '/workspace/src/main.ts',
          old_string: 'export function main() { /* ... */ }',
          new_string: 'export function main() { return runPipeline(); }',
        },
        approved: true,
      })
      await this._sleep(30)

      this._emit({
        type: 'tool_call',
        agentId: this.agentId,
        toolCallId: editToolCallId,
        toolName: 'Edit',
        phase: 'completed',
        input: {
          file_path: '/workspace/src/main.ts',
          old_string: 'export function main() { /* ... */ }',
          new_string: 'export function main() { return runPipeline(); }',
        },
        output: { success: true },
        approved: true,
        durationMs: 45,
      })
      await this._sleep(30)
      if (this._killed) return

      // Step 6: OptionDecisionEvent — agent proposes design choices
      const decisionId = uuidv4()
      this._pendingDecisionId = decisionId
      this._handle = {
        ...this._handle,
        status: 'waiting_on_human',
      }

      this._emit({
        type: 'decision',
        subtype: 'option',
        agentId: this.agentId,
        decisionId,
        title: 'Architecture pattern for pipeline module',
        summary: 'The pipeline module can be structured as either a chain-of-responsibility or an event-driven architecture. Each has different tradeoffs for testability and extensibility.',
        severity: 'medium',
        confidence: 0.75,
        blastRadius: 'medium',
        options: [
          {
            id: 'opt-chain',
            label: 'Chain of Responsibility',
            description: 'Sequential pipeline stages with explicit handoff between steps.',
            tradeoffs: 'Simpler to debug and test, but harder to add parallel stages later.',
          },
          {
            id: 'opt-events',
            label: 'Event-Driven Architecture',
            description: 'Decoupled stages communicating through an event bus.',
            tradeoffs: 'More flexible and extensible, but harder to trace execution flow.',
          },
          {
            id: 'opt-hybrid',
            label: 'Hybrid Approach',
            description: 'Core pipeline is sequential, but supports event hooks for cross-cutting concerns.',
            tradeoffs: 'Balanced approach, moderate complexity.',
          },
        ],
        recommendedOptionId: 'opt-hybrid',
        requiresRationale: true,
      })

      // Wait for resolution
      await new Promise<ResolveRequest>((resolve, reject) => {
        this._decisionResolve = resolve
        this._decisionReject = reject
      })

      this._pendingDecisionId = null
      this._decisionResolve = null
      this._decisionReject = null

      if (this._killed) return

      // Step 7: After resolve — ArtifactEvent
      this._handle = {
        ...this._handle,
        status: 'running',
      }

      const artifactId = uuidv4()
      const nowIso = new Date().toISOString()
      this._emit({
        type: 'artifact',
        agentId: this.agentId,
        artifactId,
        name: 'pipeline.ts',
        kind: 'code',
        workstream: this.brief.workstream,
        status: 'draft',
        qualityScore: 0.85,
        provenance: {
          createdBy: this.agentId,
          createdAt: nowIso,
        },
        uri: '/workspace/src/pipeline.ts',
        mimeType: 'text/typescript',
        sizeBytes: 2048,
      })
      await this._sleep(30)
      if (this._killed) return

      // Step 8: CompletionEvent
      this._emit({
        type: 'completion',
        agentId: this.agentId,
        summary: 'Implemented pipeline module using the chosen architecture pattern. Created pipeline.ts with core pipeline logic.',
        artifactsProduced: [artifactId],
        decisionsNeeded: [],
        outcome: 'success',
      })

      this._handle = {
        ...this._handle,
        status: 'completed',
      }
      this._completed = true
    } catch (err) {
      // Killed or cancelled
      if (!this._killed) {
        this._emit({
          type: 'error',
          agentId: this.agentId,
          severity: 'high',
          message: err instanceof Error ? err.message : String(err),
          recoverable: false,
          category: 'internal',
        })
      }
    }
  }

  resolveDecision(request: ResolveRequest): boolean {
    if (
      this._decisionResolve !== null &&
      request.decisionId === this._pendingDecisionId
    ) {
      this._decisionResolve(request)
      return true
    }
    return false
  }

  async kill(grace: boolean = true): Promise<KillResponse> {
    this._killed = true
    if (this._decisionReject) {
      this._decisionReject(new Error('killed'))
      this._decisionResolve = null
      this._decisionReject = null
    }

    // Wait briefly for run script to exit
    if (this._runPromise) {
      await Promise.race([
        this._runPromise.catch(() => {}),
        new Promise(r => setTimeout(r, 100)),
      ])
    }

    this._emit({
      type: 'lifecycle',
      agentId: this.agentId,
      action: 'killed',
      reason: `kill requested${grace ? ' (graceful)' : ' (force)'}`,
    })

    this._handle = {
      ...this._handle,
      status: 'completed',
    }
    this._running = false

    return {
      state: null,
      artifactsExtracted: 0,
      cleanShutdown: grace,
    }
  }

  async pause(): Promise<SerializedAgentState> {
    this._killed = true
    if (this._decisionReject) {
      this._decisionReject(new Error('paused'))
      this._decisionResolve = null
      this._decisionReject = null
    }

    if (this._runPromise) {
      await Promise.race([
        this._runPromise.catch(() => {}),
        new Promise(r => setTimeout(r, 100)),
      ])
    }

    this._emit({
      type: 'lifecycle',
      agentId: this.agentId,
      action: 'paused',
    })

    this._handle = {
      ...this._handle,
      status: 'paused',
    }
    this._running = false

    const nowIso = new Date().toISOString()
    return {
      agentId: this.agentId,
      pluginName: MockRunner.PLUGIN_NAME,
      sessionId: this.sessionId,
      checkpoint: {
        sdk: 'claude-mock',
        scriptPosition: this._factory.lastSequence,
      },
      briefSnapshot: this.brief,
      pendingDecisionIds: this._pendingDecisionId ? [this._pendingDecisionId] : [],
      lastSequence: this._factory.lastSequence,
      serializedAt: nowIso,
      serializedBy: 'pause',
      estimatedSizeBytes: 256,
    }
  }

  drainEvents(): AdapterEvent[] {
    const events = [...this._eventBuffer]
    this._eventBuffer = []
    return events
  }
}
