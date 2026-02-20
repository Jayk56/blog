/**
 * Convert an AgentBrief into a prompt string for the Claude CLI.
 */

import type { AgentBrief } from './models.js'

export function briefToPrompt(
  brief: AgentBrief,
  options?: { continuation?: boolean }
): string {
  const sections: string[] = []

  if (options?.continuation) {
    sections.push(
      'Your previous assignment is complete. Here is your next assignment:\n'
    )
  }

  sections.push(`You are a ${brief.role} working on the "${brief.workstream}" workstream.`)
  sections.push(brief.description)

  // Project
  const pb = brief.projectBrief
  sections.push(`\n## Project\n${pb.title}: ${pb.description}`)

  // Goals
  if (pb.goals?.length) {
    const goals = pb.goals.map(g => `- ${g}`).join('\n')
    sections.push(`\n## Goals\n${goals}`)
  }

  // Constraints
  const constraints = [...(brief.constraints ?? []), ...(pb.constraints ?? [])]
  if (constraints.length) {
    const cons = constraints.map(c => `- ${c}`).join('\n')
    sections.push(`\n## Constraints\n${cons}`)
  }

  // Knowledge snapshot summary
  const ks = brief.knowledgeSnapshot
  if (ks && ks.estimatedTokens > 0) {
    const parts: string[] = []
    if (ks.workstreams?.length) parts.push(`${ks.workstreams.length} active workstream(s)`)
    if (ks.pendingDecisions?.length) parts.push(`${ks.pendingDecisions.length} pending decision(s)`)
    if (ks.artifactIndex?.length) parts.push(`${ks.artifactIndex.length} artifact(s)`)
    if (parts.length) sections.push(`\n## Context\n${parts.join(', ')}.`)
  }

  let result = sections.join('\n')
  // Rough cap at ~2000 tokens (~8000 chars)
  if (result.length > 8000) {
    result = result.slice(0, 7997) + '...'
  }
  return result
}
