/**
 * Tests for ClaudeEventMapper and inferArtifactKind.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ClaudeEventMapper, inferArtifactKind } from '../src/event-mapper.js'
import type {
  StatusEvent,
  ToolCallEvent,
  ArtifactEvent,
  CompletionEvent,
} from '../src/models.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── inferArtifactKind ──────────────────────────────────────────────────

describe('inferArtifactKind', () => {
  it('identifies test files by .test. suffix', () => {
    expect(inferArtifactKind('/src/foo.test.ts')).toBe('test')
  })

  it('identifies test files by .spec. suffix', () => {
    expect(inferArtifactKind('/src/foo.spec.js')).toBe('test')
  })

  it('identifies test files by test_ prefix', () => {
    expect(inferArtifactKind('/tests/test_helpers.py')).toBe('test')
  })

  it('identifies code files', () => {
    expect(inferArtifactKind('/src/main.ts')).toBe('code')
    expect(inferArtifactKind('/src/app.js')).toBe('code')
    expect(inferArtifactKind('/src/lib.py')).toBe('code')
    expect(inferArtifactKind('/src/main.rs')).toBe('code')
    expect(inferArtifactKind('/src/app.go')).toBe('code')
    expect(inferArtifactKind('/src/Main.java')).toBe('code')
    expect(inferArtifactKind('/src/App.tsx')).toBe('code')
    expect(inferArtifactKind('/src/App.jsx')).toBe('code')
  })

  it('identifies document files', () => {
    expect(inferArtifactKind('/docs/README.md')).toBe('document')
    expect(inferArtifactKind('/docs/notes.txt')).toBe('document')
    expect(inferArtifactKind('/docs/guide.rst')).toBe('document')
  })

  it('identifies config files', () => {
    expect(inferArtifactKind('/package.json')).toBe('config')
    expect(inferArtifactKind('/config.yaml')).toBe('config')
    expect(inferArtifactKind('/config.yml')).toBe('config')
    expect(inferArtifactKind('/pyproject.toml')).toBe('config')
    expect(inferArtifactKind('/setup.ini')).toBe('config')
    expect(inferArtifactKind('/app.cfg')).toBe('config')
  })

  it('returns other for unknown extensions', () => {
    expect(inferArtifactKind('/file.xyz')).toBe('other')
    expect(inferArtifactKind('/Makefile')).toBe('other')
  })

  it('test detection takes priority over code extension', () => {
    // A .test.ts file should be "test", not "code"
    expect(inferArtifactKind('/src/handler.test.ts')).toBe('test')
  })
})

// ── ClaudeEventMapper ──────────────────────────────────────────────────

describe('ClaudeEventMapper', () => {
  let mapper: ClaudeEventMapper

  beforeEach(() => {
    mapper = new ClaudeEventMapper('agent-001', 'backend')
  })

  it('extracts session ID from system init event', () => {
    const events = mapper.mapEvent({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-xyz',
    })
    expect(events).toHaveLength(0) // No emitted events, just side effect
    expect(mapper.sessionId).toBe('sess-xyz')
  })

  it('handles sessionId variant in system init', () => {
    mapper.mapEvent({
      type: 'system',
      subtype: 'init',
      sessionId: 'sess-alt',
    })
    expect(mapper.sessionId).toBe('sess-alt')
  })

  it('maps assistant text block to status event', () => {
    const events = mapper.mapEvent({
      type: 'assistant',
      content: [{ type: 'text', text: 'Analyzing the code...' }],
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('status')
    expect((events[0] as StatusEvent).message).toBe('Analyzing the code...')
    expect((events[0] as StatusEvent).agentId).toBe('agent-001')
  })

  it('truncates long status messages to 500 chars', () => {
    const longText = 'A'.repeat(600)
    const events = mapper.mapEvent({
      type: 'assistant',
      content: [{ type: 'text', text: longText }],
    })
    expect(events).toHaveLength(1)
    const msg = (events[0] as StatusEvent).message
    expect(msg.length).toBe(500)
    expect(msg).toMatch(/\.\.\.$/m)
  })

  it('maps assistant tool_use block to tool_call requested', () => {
    const events = mapper.mapEvent({
      type: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'tu_01',
        name: 'Read',
        input: { file_path: '/src/main.ts' },
      }],
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('tool_call')
    const tc = events[0] as ToolCallEvent
    expect(tc.toolName).toBe('Read')
    expect(tc.phase).toBe('requested')
    expect(tc.input).toEqual({ file_path: '/src/main.ts' })
    expect(tc.approved).toBe(true)
  })

  it('maps multiple content blocks in a single assistant message', () => {
    const events = mapper.mapEvent({
      type: 'assistant',
      content: [
        { type: 'text', text: 'About to edit' },
        { type: 'tool_use', id: 'tu_10', name: 'Edit', input: { file_path: '/a.ts' } },
      ],
    })
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('status')
    expect(events[1].type).toBe('tool_call')
  })

  it('maps tool_result in result message to completed tool_call', () => {
    // First, register the tool use
    mapper.mapEvent({
      type: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_05', name: 'Read', input: {} }],
    })

    const events = mapper.mapEvent({
      type: 'result',
      content: [{
        type: 'tool_result',
        tool_use_id: 'tu_05',
        content: 'file contents here',
      }],
    })

    const toolResults = events.filter(e => e.type === 'tool_call')
    expect(toolResults).toHaveLength(1)
    const tc = toolResults[0] as ToolCallEvent
    expect(tc.phase).toBe('completed')
    expect(tc.output).toBe('file contents here')
    expect(tc.durationMs).toBeDefined()
  })

  it('maps errored tool_result to failed phase', () => {
    mapper.mapEvent({
      type: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_err', name: 'Bash', input: {} }],
    })

    const events = mapper.mapEvent({
      type: 'result',
      content: [{
        type: 'tool_result',
        tool_use_id: 'tu_err',
        is_error: true,
        content: 'Command failed',
      }],
    })

    const tc = events.find(e => e.type === 'tool_call') as ToolCallEvent
    expect(tc.phase).toBe('failed')
  })

  it('emits artifact event for Write tool_result', () => {
    mapper.mapEvent({
      type: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_w', name: 'Write', input: { file_path: '/src/helper.ts', content: 'code' } }],
    })

    const events = mapper.mapEvent({
      type: 'result',
      content: [{
        type: 'tool_result',
        tool_use_id: 'tu_w',
        content: 'Written',
      }],
    })

    const artifacts = events.filter(e => e.type === 'artifact')
    expect(artifacts).toHaveLength(1)
    const art = artifacts[0] as ArtifactEvent
    expect(art.name).toBe('helper.ts')
    expect(art.kind).toBe('code')
    expect(art.workstream).toBe('backend')
    expect(art.uri).toBe('/src/helper.ts')
    expect(art.provenance.createdBy).toBe('agent-001')
  })

  it('emits artifact event for Edit tool_result', () => {
    mapper.mapEvent({
      type: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_e', name: 'Edit', input: { file_path: '/src/main.test.ts' } }],
    })

    const events = mapper.mapEvent({
      type: 'result',
      content: [{
        type: 'tool_result',
        tool_use_id: 'tu_e',
        content: 'Edited',
      }],
    })

    const artifacts = events.filter(e => e.type === 'artifact')
    expect(artifacts).toHaveLength(1)
    const art = artifacts[0] as ArtifactEvent
    expect(art.kind).toBe('test')
  })

  it('does NOT emit artifact for Read tool_result', () => {
    mapper.mapEvent({
      type: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_r', name: 'Read', input: { file_path: '/src/main.ts' } }],
    })

    const events = mapper.mapEvent({
      type: 'result',
      content: [{
        type: 'tool_result',
        tool_use_id: 'tu_r',
        content: 'file content',
      }],
    })

    const artifacts = events.filter(e => e.type === 'artifact')
    expect(artifacts).toHaveLength(0)
  })

  it('does NOT emit artifact for errored Write', () => {
    mapper.mapEvent({
      type: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_we', name: 'Write', input: { file_path: '/x.ts' } }],
    })

    const events = mapper.mapEvent({
      type: 'result',
      content: [{
        type: 'tool_result',
        tool_use_id: 'tu_we',
        is_error: true,
        content: 'Permission denied',
      }],
    })

    const artifacts = events.filter(e => e.type === 'artifact')
    expect(artifacts).toHaveLength(0)
  })

  it('maps result with subtype success to completion event', () => {
    const events = mapper.mapEvent({
      type: 'result',
      subtype: 'success',
      result: 'All done!',
    })

    const completions = events.filter(e => e.type === 'completion')
    expect(completions).toHaveLength(1)
    const c = completions[0] as CompletionEvent
    expect(c.outcome).toBe('success')
    expect(c.summary).toBe('All done!')
  })

  it('maps result with just result field to success completion', () => {
    const events = mapper.mapEvent({
      type: 'result',
      result: 'Task completed successfully.',
    })

    const completions = events.filter(e => e.type === 'completion')
    expect(completions).toHaveLength(1)
    expect((completions[0] as CompletionEvent).outcome).toBe('success')
  })

  it('maps result with subtype error to abandoned completion', () => {
    const events = mapper.mapEvent({
      type: 'result',
      subtype: 'error',
      error: 'Something went wrong',
    })

    const completions = events.filter(e => e.type === 'completion')
    expect(completions).toHaveLength(1)
    const c = completions[0] as CompletionEvent
    expect(c.outcome).toBe('abandoned')
    expect(c.summary).toBe('Something went wrong')
  })

  it('maps result with subtype max_turns to max_turns completion', () => {
    const events = mapper.mapEvent({
      type: 'result',
      subtype: 'max_turns',
    })

    const completions = events.filter(e => e.type === 'completion')
    expect(completions).toHaveLength(1)
    expect((completions[0] as CompletionEvent).outcome).toBe('max_turns')
  })

  it('returns empty array for unknown event type', () => {
    const events = mapper.mapEvent({ type: 'unknown_type', data: 'foo' })
    expect(events).toHaveLength(0)
  })

  it('returns empty array for event with no type', () => {
    const events = mapper.mapEvent({ data: 'no type here' })
    expect(events).toHaveLength(0)
  })

  it('handles assistant message without content array (simple text)', () => {
    const events = mapper.mapEvent({
      type: 'assistant',
      message: 'Simple text message',
    })
    expect(events).toHaveLength(1)
    expect((events[0] as StatusEvent).message).toBe('Simple text message')
  })

  it('handles tool_result with toolUseId (camelCase variant)', () => {
    mapper.mapEvent({
      type: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_cc', name: 'Read', input: {} }],
    })

    const events = mapper.mapEvent({
      type: 'result',
      content: [{
        type: 'tool_result',
        toolUseId: 'tu_cc',
        content: 'result',
      }],
    })

    const tc = events.find(e => e.type === 'tool_call') as ToolCallEvent
    expect(tc.phase).toBe('completed')
  })

  it('handles orphaned tool_result (no matching tool_use)', () => {
    const events = mapper.mapEvent({
      type: 'result',
      content: [{
        type: 'tool_result',
        tool_use_id: 'orphan_id',
        content: 'orphan result',
      }],
    })

    // Should still emit a tool_call but with unknown tool
    const tc = events.find(e => e.type === 'tool_call') as ToolCallEvent
    expect(tc.toolName).toBe('unknown')
    expect(tc.phase).toBe('completed')
  })

  // ── Fixture replay test ──────────────────────────────────────────────

  it('processes full NDJSON fixture to expected event sequence', () => {
    const fixturePath = join(__dirname, 'fixtures', 'claude_session.ndjson')
    const lines = readFileSync(fixturePath, 'utf-8').trim().split('\n')

    const allEvents = lines.flatMap(line => {
      const data = JSON.parse(line)
      return mapper.mapEvent(data)
    })

    // Session ID extracted
    expect(mapper.sessionId).toBe('sess-abc-123')

    // Expected event types in order
    const types = allEvents.map(e => e.type)

    // Should have status messages
    expect(types.filter(t => t === 'status').length).toBeGreaterThanOrEqual(2)

    // Should have tool calls
    const toolCalls = allEvents.filter(e => e.type === 'tool_call') as ToolCallEvent[]
    expect(toolCalls.length).toBeGreaterThanOrEqual(4) // 4 tool_use + 4 tool_result

    // Write tool should produce artifact
    const artifacts = allEvents.filter(e => e.type === 'artifact') as ArtifactEvent[]
    expect(artifacts.length).toBeGreaterThanOrEqual(1)
    expect(artifacts[0].name).toBe('helper.ts')
    expect(artifacts[0].kind).toBe('code')

    // Edit tool should also produce artifact
    expect(artifacts.length).toBeGreaterThanOrEqual(2)
    // main.ts edited
    const mainArtifact = artifacts.find(a => a.name === 'main.ts')
    expect(mainArtifact).toBeDefined()

    // Should end with completion
    const completions = allEvents.filter(e => e.type === 'completion') as CompletionEvent[]
    expect(completions).toHaveLength(1)
    expect(completions[0].outcome).toBe('success')
    expect(completions[0].summary).toContain('helper function')
  })
})
