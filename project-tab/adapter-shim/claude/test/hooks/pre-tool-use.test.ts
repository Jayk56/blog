/**
 * Tests for the pre-tool-use hook script's evaluateToolUse function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Set test mode env so the hook script doesn't execute main logic on import
process.env.__HOOK_TEST_MODE = '1'

const { evaluateToolUse } = await import('../../src/hooks/pre-tool-use.mjs')

const makeInput = (overrides: Partial<{
  tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id: string
}> = {}) => ({
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
  tool_use_id: 'tu-1',
  ...overrides,
})

const makeBootstrap = (overrides: Partial<{
  backendUrl: string
  agentId: string
  backendToken: string
}> = {}) => ({
  backendUrl: 'http://localhost:3001',
  agentId: 'agent-test-1',
  backendToken: 'token-123',
  ...overrides,
})

describe('evaluateToolUse', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('maps approve response to permissionDecision: allow', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ decisionId: 'd-1', action: 'approve', rationale: 'Looks safe', timedOut: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    const result = await evaluateToolUse(makeInput(), makeBootstrap())

    expect(result.permissionDecision).toBe('allow')
    expect(result.permissionDecisionReason).toBe('Looks safe')

    // Verify request was correct
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3001/api/tool-gate/request-approval')
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body as string)
    expect(body.agentId).toBe('agent-test-1')
    expect(body.toolName).toBe('Bash')
    expect(body.toolInput).toEqual({ command: 'npm test' })
  })

  it('maps reject response to permissionDecision: deny', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ decisionId: 'd-2', action: 'reject', rationale: 'Too risky', timedOut: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    const result = await evaluateToolUse(makeInput(), makeBootstrap())

    expect(result.permissionDecision).toBe('deny')
    expect(result.permissionDecisionReason).toBe('Too risky')
  })

  it('maps modify response to permissionDecision: allow', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ decisionId: 'd-3', action: 'modify', rationale: 'Modified args', timedOut: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    const result = await evaluateToolUse(makeInput(), makeBootstrap())

    expect(result.permissionDecision).toBe('allow')
    expect(result.permissionDecisionReason).toBe('Modified args')
  })

  it('returns deny when backend returns non-200', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: 'Agent not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    ))

    const result = await evaluateToolUse(makeInput(), makeBootstrap())

    expect(result.permissionDecision).toBe('deny')
    expect(result.permissionDecisionReason).toContain('404')
  })

  it('returns deny on fetch failure (network error)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await evaluateToolUse(makeInput(), makeBootstrap()).catch((err: Error) => ({
      permissionDecision: 'deny',
      permissionDecisionReason: `Hook error: ${err.message}`,
    }))

    expect(result.permissionDecision).toBe('deny')
    expect(result.permissionDecisionReason).toContain('ECONNREFUSED')
  })

  it('includes Authorization header when backendToken is set', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ decisionId: 'd-4', action: 'approve', timedOut: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    await evaluateToolUse(makeInput(), makeBootstrap({ backendToken: 'secret-token' }))

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const headers = opts.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer secret-token')
  })

  it('omits Authorization header when backendToken is empty', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ decisionId: 'd-5', action: 'approve', timedOut: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    await evaluateToolUse(makeInput(), makeBootstrap({ backendToken: '' }))

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const headers = opts.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })

  it('uses "Timed out" reason when timedOut is true and no rationale', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ decisionId: 'd-6', action: 'reject', timedOut: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    const result = await evaluateToolUse(makeInput(), makeBootstrap())

    expect(result.permissionDecision).toBe('deny')
    expect(result.permissionDecisionReason).toBe('Timed out')
  })
})
