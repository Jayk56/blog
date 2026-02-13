/**
 * Tests for briefToPrompt conversion.
 */

import { describe, it, expect } from 'vitest'
import { briefToPrompt } from '../src/brief-to-prompt.js'
import { makeTestBrief } from './helpers.js'

describe('briefToPrompt', () => {
  it('includes role and workstream', () => {
    const brief = makeTestBrief()
    const prompt = briefToPrompt(brief)
    expect(prompt).toContain('test-agent')
    expect(prompt).toContain('"testing"')
  })

  it('includes description', () => {
    const brief = makeTestBrief()
    const prompt = briefToPrompt(brief)
    expect(prompt).toContain('A test agent for integration testing')
  })

  it('includes project title and description', () => {
    const brief = makeTestBrief()
    const prompt = briefToPrompt(brief)
    expect(prompt).toContain('## Project')
    expect(prompt).toContain('Test Project')
    expect(prompt).toContain('A test project')
  })

  it('includes goals', () => {
    const brief = makeTestBrief()
    const prompt = briefToPrompt(brief)
    expect(prompt).toContain('## Goals')
    expect(prompt).toContain('- Test goal')
  })

  it('includes agent-level constraints', () => {
    const brief = makeTestBrief()
    brief.constraints = ['No side effects', 'Keep it simple']
    const prompt = briefToPrompt(brief)
    expect(prompt).toContain('## Constraints')
    expect(prompt).toContain('- No side effects')
    expect(prompt).toContain('- Keep it simple')
  })

  it('includes project-level constraints', () => {
    const brief = makeTestBrief()
    brief.projectBrief.constraints = ['Budget limit']
    const prompt = briefToPrompt(brief)
    expect(prompt).toContain('## Constraints')
    expect(prompt).toContain('- Budget limit')
  })

  it('merges agent and project constraints', () => {
    const brief = makeTestBrief()
    brief.constraints = ['Agent constraint']
    brief.projectBrief.constraints = ['Project constraint']
    const prompt = briefToPrompt(brief)
    expect(prompt).toContain('- Agent constraint')
    expect(prompt).toContain('- Project constraint')
  })

  it('omits constraints section when empty', () => {
    const brief = makeTestBrief()
    brief.constraints = []
    brief.projectBrief.constraints = undefined
    const prompt = briefToPrompt(brief)
    expect(prompt).not.toContain('## Constraints')
  })

  it('omits goals section when empty', () => {
    const brief = makeTestBrief()
    brief.projectBrief.goals = []
    const prompt = briefToPrompt(brief)
    expect(prompt).not.toContain('## Goals')
  })

  it('includes knowledge snapshot context when tokens > 0', () => {
    const brief = makeTestBrief()
    brief.knowledgeSnapshot.estimatedTokens = 500
    brief.knowledgeSnapshot.workstreams = [{ name: 'ws1' }, { name: 'ws2' }]
    brief.knowledgeSnapshot.pendingDecisions = [{ id: 'd1' }]
    brief.knowledgeSnapshot.artifactIndex = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]
    const prompt = briefToPrompt(brief)
    expect(prompt).toContain('## Context')
    expect(prompt).toContain('2 active workstream(s)')
    expect(prompt).toContain('1 pending decision(s)')
    expect(prompt).toContain('3 artifact(s)')
  })

  it('omits context section when estimatedTokens is 0', () => {
    const brief = makeTestBrief()
    brief.knowledgeSnapshot.estimatedTokens = 0
    const prompt = briefToPrompt(brief)
    expect(prompt).not.toContain('## Context')
  })

  it('truncates to ~8000 chars', () => {
    const brief = makeTestBrief()
    brief.description = 'A'.repeat(10000)
    const prompt = briefToPrompt(brief)
    expect(prompt.length).toBeLessThanOrEqual(8000)
    expect(prompt).toMatch(/\.\.\.$/m)
  })

  it('returns a non-empty string for minimal brief', () => {
    const brief = makeTestBrief()
    const prompt = briefToPrompt(brief)
    expect(prompt.length).toBeGreaterThan(0)
    expect(typeof prompt).toBe('string')
  })
})
