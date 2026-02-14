/**
 * Real runner that spawns the Claude CLI and maps its stream-json output.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
  private _enableDecisionGating: boolean
  private _settingsBackup: string | null = null
  private _settingsPath: string | null = null
  private _sandboxDir: string | null = null

  constructor(
    brief: AgentBrief,
    options?: { workspace?: string; resumeSessionId?: string; enableDecisionGating?: boolean }
  ) {
    this.brief = brief
    this.agentId = brief.agentId
    this.sessionId = options?.resumeSessionId ?? uuidv4()
    this._workspace = options?.workspace
    this._resumeSessionId = options?.resumeSessionId
    this._enableDecisionGating = options?.enableDecisionGating ?? true
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
    if (this._enableDecisionGating) {
      this._writeHookSettings()
    }
    this._spawnAndRead()
  }

  /**
   * Build the hook matcher pattern from the brief's escalation protocol.
   * Tools in neverEscalate are excluded from gating.
   */
  _buildHookMatcher(): string {
    const neverEscalate = new Set(this.brief.escalationProtocol?.neverEscalate ?? [])
    const allTools = this.brief.allowedTools ?? ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']
    const toolsToGate = allTools.filter(t => !neverEscalate.has(t))
    return toolsToGate.join('|') || '.*'
  }

  /**
   * Create an isolated sandbox directory for the agent and write
   * .claude/settings.local.json with PreToolUse hooks into it.
   *
   * The sandbox is a subdirectory of the workspace at `.claude-agents/<agentId>/`.
   * This prevents the agent's hook settings from affecting other Claude Code
   * sessions running in the same workspace (e.g. the human operator's session).
   *
   * The spawned `claude` process uses the sandbox as cwd, but can still access
   * the full project via the `--project-dir` flag pointing to the real workspace.
   */
  private _writeHookSettings(): void {
    const workspace = this._workspace ?? process.cwd()

    // Create isolated sandbox directory
    const sandboxDir = path.join(workspace, '.claude-agents', this.agentId)
    fs.mkdirSync(sandboxDir, { recursive: true })
    this._sandboxDir = sandboxDir

    const claudeDir = path.join(sandboxDir, '.claude')
    const settingsFile = path.join(claudeDir, 'settings.local.json')
    this._settingsPath = settingsFile

    const hookScriptPath = path.resolve(__dirname, 'hooks', 'pre-tool-use.mjs')
    const matcher = this._buildHookMatcher()

    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher,
            hooks: [
              {
                type: 'command',
                command: `node ${hookScriptPath}`,
              },
            ],
          },
        ],
      },
    }

    try {
      fs.mkdirSync(claudeDir, { recursive: true })
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
    } catch (err) {
      // Non-fatal: log but don't prevent spawn
      // eslint-disable-next-line no-console
      console.error(`[ClaudeRunner] Failed to write hook settings: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Remove the sandbox directory and its hook settings. */
  private _cleanupHookSettings(): void {
    if (!this._settingsPath) return

    try {
      if (fs.existsSync(this._settingsPath)) {
        fs.unlinkSync(this._settingsPath)
      }
      // Clean up the .claude dir inside sandbox if empty
      const claudeDir = path.dirname(this._settingsPath)
      if (fs.existsSync(claudeDir)) {
        const remaining = fs.readdirSync(claudeDir)
        if (remaining.length === 0) fs.rmdirSync(claudeDir)
      }
    } catch {
      // Best-effort cleanup
    }
    this._settingsPath = null
    this._settingsBackup = null
  }

  private _emit(event: AgentEvent): void {
    const adapterEvent = this._factory.wrap(event)
    this._eventBuffer.push(adapterEvent)
  }

  private _spawnAndRead(): void {
    let prompt = briefToPrompt(this.brief)

    // When running in a sandbox, prepend the real workspace path so the agent
    // uses absolute paths to access project files.
    if (this._sandboxDir && this._workspace) {
      prompt = `IMPORTANT: The project root is at ${this._workspace}. Use absolute paths for all file operations.\n\n${prompt}`
    }

    // Pre-approve all tools so the CLI doesn't block in headless mode.
    // The PreToolUse hook handles gating for Write/Edit/Bash; Read/Glob/Grep
    // are in neverEscalate and should run freely.
    const allowedTools = (this.brief.allowedTools ?? ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'])
      .map(t => `--allowedTools=${t}`)

    let args: string[]
    if (this._resumeSessionId) {
      args = ['--resume', this._resumeSessionId, '-p', prompt, '--output-format', 'stream-json', '--verbose', ...allowedTools]
    } else {
      args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--max-turns', '50', ...allowedTools]
    }

    // When decision gating is enabled, the agent runs in an isolated sandbox
    // directory (so its .claude/settings.local.json doesn't affect other Claude
    // Code sessions in the real workspace). The agent accesses project files via
    // absolute paths (the prompt includes the workspace root).
    const spawnCwd = this._sandboxDir ?? this._workspace

    // Pass AGENT_BOOTSTRAP so the PreToolUse hook can call back to the server
    const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3001'
    const agentBootstrap = JSON.stringify({
      backendUrl,
      agentId: this.agentId,
      backendToken: '',
    })

    try {
      this._process = spawn('claude', args, {
        cwd: spawnCwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AGENT_BOOTSTRAP: agentBootstrap },
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
        // eslint-disable-next-line no-console
        console.error(`[ClaudeRunner:stdout] ${line.slice(0, 200)}`)
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
        const text = chunk.toString('utf-8')
        stderrText += text
        // eslint-disable-next-line no-console
        console.error(`[ClaudeRunner:stderr] ${text.slice(0, 300)}`)
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

    this._cleanupHookSettings()

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

    this._cleanupHookSettings()

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
