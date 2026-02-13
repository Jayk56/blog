/**
 * Real runner that spawns the Claude CLI and maps its stream-json output.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import readline from 'node:readline'
import { v4 as uuidv4 } from 'uuid'
import { briefToPrompt } from './brief-to-prompt.js'
import { ClaudeEventMapper } from './event-mapper.js'
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

export class ClaudeRunner {
  static readonly PLUGIN_NAME = 'claude-cli'

  readonly brief: AgentBrief
  readonly agentId: string
  sessionId: string

  private _factory: EventFactory
  private _mapper: ClaudeEventMapper
  private _handle: AgentHandle
  private _eventBuffer: AdapterEvent[] = []
  private _process: ChildProcess | null = null
  private _killed = false
  private _completed = false
  private _running = false
  private _workspace: string | undefined
  private _resumeSessionId: string | undefined

  constructor(
    brief: AgentBrief,
    options?: { workspace?: string; resumeSessionId?: string }
  ) {
    this.brief = brief
    this.agentId = brief.agentId
    this.sessionId = options?.resumeSessionId ?? uuidv4()
    this._workspace = options?.workspace
    this._resumeSessionId = options?.resumeSessionId
    this._factory = new EventFactory(uuidv4())
    this._mapper = new ClaudeEventMapper(this.agentId, brief.workstream)
    this._handle = {
      id: this.agentId,
      pluginName: ClaudeRunner.PLUGIN_NAME,
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
    this._spawnAndRead()
  }

  private _emit(event: AgentEvent): void {
    const adapterEvent = this._factory.wrap(event)
    this._eventBuffer.push(adapterEvent)
  }

  private _spawnAndRead(): void {
    const prompt = briefToPrompt(this.brief)

    let args: string[]
    if (this._resumeSessionId) {
      args = ['--resume', this._resumeSessionId, '-p', prompt, '--output-format', 'stream-json']
    } else {
      args = ['-p', prompt, '--output-format', 'stream-json', '--max-turns', '50']
    }

    try {
      this._process = spawn('claude', args, {
        cwd: this._workspace,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      this._emit({
        type: 'error',
        agentId: this.agentId,
        severity: 'critical',
        message: `Failed to spawn claude CLI: ${err instanceof Error ? err.message : String(err)}`,
        recoverable: false,
        category: 'internal',
      })
      this._emit({
        type: 'completion',
        agentId: this.agentId,
        summary: 'Failed to start: claude CLI not found',
        artifactsProduced: [],
        decisionsNeeded: [],
        outcome: 'abandoned',
      })
      this._completed = true
      this._handle = { ...this._handle, status: 'error' }
      return
    }

    // Emit lifecycle started
    this._emit({
      type: 'lifecycle',
      agentId: this.agentId,
      action: 'started',
    })

    // Handle spawn errors (e.g. ENOENT)
    this._process.on('error', (err) => {
      this._emit({
        type: 'error',
        agentId: this.agentId,
        severity: 'critical',
        message: `claude CLI error: ${err.message}`,
        recoverable: false,
        category: 'internal',
      })
      this._emit({
        type: 'completion',
        agentId: this.agentId,
        summary: 'Failed to start: claude CLI not found',
        artifactsProduced: [],
        decisionsNeeded: [],
        outcome: 'abandoned',
      })
      this._completed = true
      this._handle = { ...this._handle, status: 'error' }
    })

    // Read stdout line by line
    if (this._process.stdout) {
      const rl = readline.createInterface({ input: this._process.stdout })
      rl.on('line', (line: string) => {
        try {
          const data = JSON.parse(line.trim())
          const agentEvents = this._mapper.mapEvent(data)
          for (const evt of agentEvents) {
            this._emit(evt)
          }

          // Update session_id if mapper extracted one
          if (this._mapper.sessionId && this.sessionId !== this._mapper.sessionId) {
            this.sessionId = this._mapper.sessionId
            this._handle = { ...this._handle, sessionId: this.sessionId }
          }
        } catch {
          // Skip malformed JSON lines
        }
      })
    }

    // Collect stderr
    let stderrText = ''
    if (this._process.stderr) {
      this._process.stderr.on('data', (chunk: Buffer) => {
        stderrText += chunk.toString('utf-8')
      })
    }

    // Handle process exit
    this._process.on('close', (code) => {
      if (this._killed) return // Already handled by kill/pause

      if (code === 0) {
        // Check if mapper already emitted a CompletionEvent
        const hasCompletion = this._eventBuffer.some(e => e.event.type === 'completion')
        if (!hasCompletion) {
          this._emit({
            type: 'completion',
            agentId: this.agentId,
            summary: 'Claude session completed successfully',
            artifactsProduced: [],
            decisionsNeeded: [],
            outcome: 'success',
          })
        }
        this._handle = { ...this._handle, status: 'completed' }
      } else {
        const errorMsg = stderrText ? stderrText.slice(0, 500) : ''
        this._emit({
          type: 'error',
          agentId: this.agentId,
          severity: 'high',
          message: `Claude exited with code ${code}${errorMsg ? ': ' + errorMsg : ''}`,
          recoverable: false,
          category: 'internal',
        })
        this._emit({
          type: 'lifecycle',
          agentId: this.agentId,
          action: 'crashed',
          reason: `Exit code ${code}`,
        })
        this._handle = { ...this._handle, status: 'error' }
      }
      this._completed = true
    })
  }

  resolveDecision(_request: ResolveRequest): boolean {
    // No-op in v1 (full-auto mode)
    return false
  }

  async kill(grace = true): Promise<KillResponse> {
    this._killed = true
    let forced = !grace
    if (this._process && this._process.exitCode === null) {
      if (grace) {
        this._process.kill('SIGTERM')
        // Wait up to 5s for graceful exit
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (this._process && this._process.exitCode === null) {
              forced = true
              this._process.kill('SIGKILL')
            }
            resolve()
          }, 5000)
          this._process!.on('close', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      } else {
        this._process.kill('SIGKILL')
        await new Promise<void>((resolve) => {
          this._process!.on('close', () => resolve())
        })
      }
    }

    this._emit({
      type: 'lifecycle',
      agentId: this.agentId,
      action: 'killed',
      reason: `kill requested${forced ? ' (force)' : ' (graceful)'}`,
    })
    this._handle = { ...this._handle, status: 'completed' }
    this._completed = true
    this._running = false

    return {
      state: null,
      artifactsExtracted: 0,
      cleanShutdown: !forced,
    }
  }

  async pause(): Promise<SerializedAgentState> {
    this._killed = true
    if (this._process && this._process.exitCode === null) {
      this._process.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this._process && this._process.exitCode === null) {
            this._process.kill('SIGKILL')
          }
          resolve()
        }, 5000)
        this._process!.on('close', () => {
          clearTimeout(timeout)
          resolve()
        })
      })
    }

    this._emit({
      type: 'lifecycle',
      agentId: this.agentId,
      action: 'paused',
    })
    this._handle = { ...this._handle, status: 'paused' }
    this._running = false

    const nowIso = new Date().toISOString()
    return {
      agentId: this.agentId,
      pluginName: ClaudeRunner.PLUGIN_NAME,
      sessionId: this.sessionId,
      checkpoint: {
        sdk: 'claude',
        sessionId: this.sessionId,
      },
      briefSnapshot: this.brief,
      pendingDecisionIds: [],
      lastSequence: this._factory.lastSequence,
      serializedAt: nowIso,
      serializedBy: 'pause',
      estimatedSizeBytes: 512,
    }
  }

  drainEvents(): AdapterEvent[] {
    const events = [...this._eventBuffer]
    this._eventBuffer = []
    return events
  }
}
