/**
 * Tests for ClaudeRunner.
 *
 * Since ClaudeRunner spawns a real process, we test it by:
 *   1. Unit tests for structure, handle, plugin name, etc.
 *   2. Using vi.mock to intercept child_process.spawn with a fake process
 *      that writes NDJSON to stdout and exits cleanly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'
import { makeTestBrief } from './helpers.js'
import type {
  LifecycleEvent,
  CompletionEvent,
  ErrorEvent,
  StatusEvent,
  ToolCallEvent,
  ArtifactEvent,
} from '../src/models.js'

// ── Mock child_process ────────────────────────────────────────────────

class FakeProcess extends EventEmitter {
  stdout: Readable
  stderr: Readable
  stdin: Writable
  exitCode: number | null = null
  private _killed = false

  constructor(private _lines: string[], private _exitCode = 0, private _delay = 5) {
    super()
    this.stdout = new Readable({ read() {} })
    this.stderr = new Readable({ read() {} })
    this.stdin = new Writable({ write(_c, _e, cb) { cb() } })
  }

  start(): void {
    // Emit lines one by one
    let i = 0
    const emitNext = () => {
      if (i < this._lines.length) {
        this.stdout.push(this._lines[i] + '\n')
        i++
        setTimeout(emitNext, this._delay)
      } else {
        // End stdout and close process
        this.stdout.push(null)
        this.exitCode = this._exitCode
        this.emit('close', this._exitCode)
      }
    }
    setTimeout(emitNext, this._delay)
  }

  kill(signal?: string): boolean {
    if (!this._killed) {
      this._killed = true
      this.exitCode = signal === 'SIGKILL' ? 137 : 0
      this.stdout.push(null)
      // Emit close after a small delay to simulate real process behavior
      setTimeout(() => {
        this.emit('close', this.exitCode)
      }, 5)
    }
    return true
  }
}

class StubbornProcess extends FakeProcess {
  signals: string[] = []

  constructor() {
    super([], 0, 5)
  }

  start(): void {
    // Intentionally keep the process alive until SIGKILL.
  }

  kill(signal?: string): boolean {
    this.signals.push(signal ?? 'SIGTERM')
    if (signal === 'SIGKILL') {
      this.exitCode = 137
    }
    return true
  }
}

let fakeProcess: FakeProcess | null = null
let spawnArgs: { cmd: string; args: string[]; opts: Record<string, unknown> } | null = null

vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[], opts: Record<string, unknown>) => {
    spawnArgs = { cmd, args, opts }
    if (!fakeProcess) {
      throw new Error('No fake process configured')
    }
    // Auto-start the fake process
    setTimeout(() => fakeProcess!.start(), 1)
    return fakeProcess
  },
}))

// Must import AFTER mock setup
const { ClaudeRunner } = await import('../src/claude-runner.js')

describe('ClaudeRunner', () => {
  beforeEach(() => {
    fakeProcess = null
    spawnArgs = null
  })

  afterEach(() => {
    fakeProcess = null
    spawnArgs = null
  })

  function setupFakeProcess(lines: string[], exitCode = 0, delay = 5): void {
    fakeProcess = new FakeProcess(lines, exitCode, delay)
  }

  // ── Basic structure ─────────────────────────────────────────────────

  it('has claude-cli plugin name', () => {
    expect(ClaudeRunner.PLUGIN_NAME).toBe('claude-cli')
  })

  it('initializes with correct agentId and status', () => {
    setupFakeProcess([])
    const brief = makeTestBrief('agent-r1')
    const runner = new ClaudeRunner(brief)
    expect(runner.agentId).toBe('agent-r1')
    expect(runner.handle.id).toBe('agent-r1')
    expect(runner.handle.pluginName).toBe('claude-cli')
    expect(runner.handle.status).toBe('running')
  })

  it('generates a session ID when none provided', () => {
    setupFakeProcess([])
    const runner = new ClaudeRunner(makeTestBrief())
    expect(runner.sessionId).toBeDefined()
    expect(runner.sessionId.length).toBeGreaterThan(0)
  })

  it('uses provided resumeSessionId', () => {
    setupFakeProcess([])
    const runner = new ClaudeRunner(makeTestBrief(), { resumeSessionId: 'sess-resume-1' })
    expect(runner.sessionId).toBe('sess-resume-1')
  })

  // ── Spawning and args ──────────────────────────────────────────────

  it('spawns claude CLI with correct args for new session', async () => {
    setupFakeProcess([
      '{"type":"result","subtype":"success","result":"done"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief(), { workspace: '/tmp/test-ws' })
    runner.start()
    await new Promise(r => setTimeout(r, 100))

    expect(spawnArgs).not.toBeNull()
    expect(spawnArgs!.cmd).toBe('claude')
    expect(spawnArgs!.args).toContain('-p')
    expect(spawnArgs!.args).toContain('--output-format')
    expect(spawnArgs!.args).toContain('stream-json')
    expect(spawnArgs!.args).toContain('--max-turns')
    expect(spawnArgs!.args).toContain('50')
    expect(spawnArgs!.opts.cwd).toBe('/tmp/test-ws')
  })

  it('spawns claude CLI with --resume for resumed session', async () => {
    setupFakeProcess([
      '{"type":"result","subtype":"success","result":"resumed"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief(), { resumeSessionId: 'sess-r' })
    runner.start()
    await new Promise(r => setTimeout(r, 100))

    expect(spawnArgs!.args).toContain('--resume')
    expect(spawnArgs!.args).toContain('sess-r')
    expect(spawnArgs!.args).not.toContain('--max-turns')
  })

  // ── Event mapping ──────────────────────────────────────────────────

  it('emits lifecycle started event', async () => {
    setupFakeProcess([
      '{"type":"result","subtype":"success","result":"ok"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 150))

    const events = runner.drainEvents()
    const lifecycle = events.filter(e => e.event.type === 'lifecycle')
    expect(lifecycle.length).toBeGreaterThanOrEqual(1)
    expect((lifecycle[0].event as LifecycleEvent).action).toBe('started')
  })

  it('maps assistant text to status event', async () => {
    setupFakeProcess([
      '{"type":"assistant","content":[{"type":"text","text":"Hello from Claude"}]}',
      '{"type":"result","subtype":"success","result":"done"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 150))

    const events = runner.drainEvents()
    const statuses = events.filter(e => e.event.type === 'status')
    expect(statuses.length).toBeGreaterThanOrEqual(1)
    expect((statuses[0].event as StatusEvent).message).toBe('Hello from Claude')
  })

  it('maps tool_use and tool_result to tool_call events', async () => {
    setupFakeProcess([
      '{"type":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"Read","input":{"file_path":"/a.ts"}}]}',
      '{"type":"result","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"file content"}]}',
      '{"type":"result","subtype":"success","result":"done"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 200))

    const events = runner.drainEvents()
    const toolCalls = events.filter(e => e.event.type === 'tool_call') as Array<{ event: ToolCallEvent }>
    expect(toolCalls.length).toBe(2) // requested + completed
    expect(toolCalls[0].event.phase).toBe('requested')
    expect(toolCalls[1].event.phase).toBe('completed')
  })

  it('emits artifact for Write tool_result', async () => {
    setupFakeProcess([
      '{"type":"assistant","content":[{"type":"tool_use","id":"tu_w","name":"Write","input":{"file_path":"/src/new.ts"}}]}',
      '{"type":"result","content":[{"type":"tool_result","tool_use_id":"tu_w","content":"ok"}]}',
      '{"type":"result","subtype":"success","result":"done"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 200))

    const events = runner.drainEvents()
    const artifacts = events.filter(e => e.event.type === 'artifact') as Array<{ event: ArtifactEvent }>
    expect(artifacts.length).toBe(1)
    expect(artifacts[0].event.name).toBe('new.ts')
    expect(artifacts[0].event.kind).toBe('code')
  })

  it('maps success result to completion event', async () => {
    setupFakeProcess([
      '{"type":"result","subtype":"success","result":"All tasks completed"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 150))

    const events = runner.drainEvents()
    const completions = events.filter(e => e.event.type === 'completion')
    expect(completions.length).toBeGreaterThanOrEqual(1)
    const c = completions[0].event as CompletionEvent
    expect(c.outcome).toBe('success')
    expect(c.summary).toBe('All tasks completed')
  })

  it('maps max_turns result to max_turns completion', async () => {
    setupFakeProcess([
      '{"type":"result","subtype":"max_turns"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 150))

    const events = runner.drainEvents()
    const completions = events.filter(e => e.event.type === 'completion')
    expect(completions.length).toBeGreaterThanOrEqual(1)
    expect((completions[0].event as CompletionEvent).outcome).toBe('max_turns')
  })

  it('extracts session ID from system init event', async () => {
    setupFakeProcess([
      '{"type":"system","subtype":"init","session_id":"sess-from-cli"}',
      '{"type":"result","subtype":"success","result":"done"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 150))

    expect(runner.sessionId).toBe('sess-from-cli')
    expect(runner.handle.sessionId).toBe('sess-from-cli')
  })

  // ── Process exit handling ──────────────────────────────────────────

  it('handles clean exit (code 0) without prior completion', async () => {
    // No result event but process exits cleanly
    setupFakeProcess([
      '{"type":"assistant","content":[{"type":"text","text":"Working..."}]}',
    ])
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 200))

    const events = runner.drainEvents()
    const completions = events.filter(e => e.event.type === 'completion')
    expect(completions).toHaveLength(1)
    expect((completions[0].event as CompletionEvent).outcome).toBe('success')
    expect(runner.handle.status).toBe('completed')
  })

  it('handles non-zero exit code', async () => {
    setupFakeProcess([], 1)
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 200))

    const events = runner.drainEvents()
    const errors = events.filter(e => e.event.type === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect((errors[0].event as ErrorEvent).message).toContain('exited with code 1')

    const crashes = events.filter(e =>
      e.event.type === 'lifecycle' && (e.event as LifecycleEvent).action === 'crashed'
    )
    expect(crashes).toHaveLength(1)
    expect(runner.handle.status).toBe('error')
  })

  it('skips malformed JSON lines without crashing', async () => {
    setupFakeProcess([
      'not json at all',
      '{"type":"result","subtype":"success","result":"ok"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 150))

    const events = runner.drainEvents()
    // Should still get the completion event from the valid line
    const completions = events.filter(e => e.event.type === 'completion')
    expect(completions.length).toBeGreaterThanOrEqual(1)
  })

  // ── Kill / Pause ──────────────────────────────────────────────────

  it('kill returns clean shutdown response', async () => {
    setupFakeProcess([
      // Slow stream -- won't finish before kill
      '{"type":"assistant","content":[{"type":"text","text":"Starting long task..."}]}',
    ], 0, 200)
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 50))

    const response = await runner.kill(true)
    expect(response.cleanShutdown).toBe(true)
    expect(response.state).toBeNull()
    expect(runner.isRunning).toBe(false)

    const events = runner.drainEvents()
    const killed = events.filter(e =>
      e.event.type === 'lifecycle' && (e.event as LifecycleEvent).action === 'killed'
    )
    expect(killed).toHaveLength(1)
  })

  it('force kill sets cleanShutdown false', async () => {
    setupFakeProcess([], 0, 200)
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 50))

    const response = await runner.kill(false)
    expect(response.cleanShutdown).toBe(false)
  })

  it('graceful kill escalated to SIGKILL sets cleanShutdown false', async () => {
    vi.useFakeTimers()
    try {
      const stubborn = new StubbornProcess()
      fakeProcess = stubborn
      const runner = new ClaudeRunner(makeTestBrief())
      runner.start()
      await vi.advanceTimersByTimeAsync(5)

      const killPromise = runner.kill(true)
      await vi.advanceTimersByTimeAsync(5000)
      const response = await killPromise

      expect(response.cleanShutdown).toBe(false)
      expect(stubborn.signals).toContain('SIGTERM')
      expect(stubborn.signals).toContain('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('pause returns serialized state with session ID', async () => {
    setupFakeProcess([
      '{"type":"system","subtype":"init","session_id":"sess-pause-test"}',
    ], 0, 200)
    const runner = new ClaudeRunner(makeTestBrief('agent-p1'))
    runner.start()
    await new Promise(r => setTimeout(r, 50))

    const state = await runner.pause()
    expect(state.agentId).toBe('agent-p1')
    expect(state.pluginName).toBe('claude-cli')
    expect(state.checkpoint.sdk).toBe('claude')
    expect(state.checkpoint.sessionId).toBeDefined()
    expect(state.serializedBy).toBe('pause')
    expect(state.briefSnapshot).toBeDefined()
    expect(runner.isRunning).toBe(false)
    expect(runner.handle.status).toBe('paused')
  })

  // ── resolveDecision ───────────────────────────────────────────────

  it('resolveDecision returns false (no-op in v1)', () => {
    setupFakeProcess([])
    const runner = new ClaudeRunner(makeTestBrief())
    const resolved = runner.resolveDecision({
      decisionId: 'some-id',
      resolution: {
        type: 'option',
        chosenOptionId: 'a',
        rationale: 'test',
        actionKind: 'create',
      },
    })
    expect(resolved).toBe(false)
  })

  // ── drainEvents ───────────────────────────────────────────────────

  it('drainEvents clears the buffer', async () => {
    setupFakeProcess([
      '{"type":"result","subtype":"success","result":"ok"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 150))

    const events1 = runner.drainEvents()
    expect(events1.length).toBeGreaterThan(0)

    const events2 = runner.drainEvents()
    expect(events2).toHaveLength(0)
  })

  // ── Envelope properties ───────────────────────────────────────────

  it('events have monotonically increasing sequence numbers', async () => {
    setupFakeProcess([
      '{"type":"assistant","content":[{"type":"text","text":"Step 1"}]}',
      '{"type":"assistant","content":[{"type":"text","text":"Step 2"}]}',
      '{"type":"result","subtype":"success","result":"done"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 200))

    const events = runner.drainEvents()
    const sequences = events.map(e => e.sourceSequence)
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1])
    }
  })

  it('all events share the same runId', async () => {
    setupFakeProcess([
      '{"type":"assistant","content":[{"type":"text","text":"Working"}]}',
      '{"type":"result","subtype":"success","result":"ok"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief())
    runner.start()
    await new Promise(r => setTimeout(r, 150))

    const events = runner.drainEvents()
    const runIds = new Set(events.map(e => e.runId))
    expect(runIds.size).toBe(1)
  })

  it('all events have correct agentId', async () => {
    setupFakeProcess([
      '{"type":"result","subtype":"success","result":"done"}',
    ])
    const runner = new ClaudeRunner(makeTestBrief('agent-id-check'))
    runner.start()
    await new Promise(r => setTimeout(r, 150))

    const events = runner.drainEvents()
    for (const event of events) {
      expect((event.event as any).agentId).toBe('agent-id-check')
    }
  })

  // ── Full session replay ───────────────────────────────────────────

  it('processes a full session with multiple tools and produces expected events', async () => {
    setupFakeProcess([
      '{"type":"system","subtype":"init","session_id":"sess-full"}',
      '{"type":"assistant","content":[{"type":"text","text":"Analyzing..."}]}',
      '{"type":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"Read","input":{"file_path":"/src/main.ts"}}]}',
      '{"type":"result","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"code here"}]}',
      '{"type":"assistant","content":[{"type":"tool_use","id":"tu_2","name":"Write","input":{"file_path":"/src/helper.ts","content":"new code"}}]}',
      '{"type":"result","content":[{"type":"tool_result","tool_use_id":"tu_2","content":"written"}]}',
      '{"type":"result","subtype":"success","result":"Implementation complete"}',
    ])

    const runner = new ClaudeRunner(makeTestBrief('agent-full'))
    runner.start()
    await new Promise(r => setTimeout(r, 300))

    const events = runner.drainEvents()
    const types = events.map(e => e.event.type)

    // lifecycle started
    expect(types).toContain('lifecycle')
    // status messages
    expect(types.filter(t => t === 'status').length).toBeGreaterThanOrEqual(1)
    // tool calls
    expect(types.filter(t => t === 'tool_call').length).toBeGreaterThanOrEqual(4) // 2 requested + 2 completed
    // artifact from Write
    expect(types).toContain('artifact')
    // completion
    expect(types).toContain('completion')

    // Session ID updated
    expect(runner.sessionId).toBe('sess-full')
    expect(runner.handle.status).toBe('completed')
  })
})
