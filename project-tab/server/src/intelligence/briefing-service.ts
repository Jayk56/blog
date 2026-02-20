import type { ProjectConfig } from '../types/project-config'
import type { KnowledgeSnapshot } from '../types/brief'
import type { AgentHandle } from '../types/plugin'
import type { ControlMode } from '../types/events'
import type { LlmReviewService } from './llm-review-service'

export interface BriefingRequest {
  projectConfig: ProjectConfig
  snapshot: KnowledgeSnapshot
  activeAgents: AgentHandle[]
  trustScores: Array<{ agentId: string; score: number }>
  controlMode: ControlMode
}

export interface BriefingResponse {
  briefing: string
  generatedAt: string
}

export class BriefingService {
  constructor(private readonly llm: LlmReviewService) {}

  async generate(request: BriefingRequest): Promise<BriefingResponse> {
    const prompt = buildBriefingPrompt(request)
    const briefing = await this.llm.requestTextCompletion(prompt, undefined, true)
    return {
      briefing,
      generatedAt: new Date().toISOString(),
    }
  }
}

function buildBriefingPrompt(req: BriefingRequest): string {
  const { projectConfig, snapshot, activeAgents, trustScores, controlMode } = req

  const lines: string[] = [
    'You are a project briefing assistant. Generate a concise, multi-paragraph narrative briefing for a human project lead who manages AI agent teams.',
    '',
    'Write in a direct, professional tone. Use **bold** for key terms. Structure the briefing as:',
    '1. Opening summary — project status at a glance (name, phase, tick, control mode, coherence health)',
    '2. What happened — recent events, artifacts produced, decisions resolved',
    '3. What needs attention — pending decisions, coherence issues, overdue items',
    '4. Agent activity — what each agent is doing, trust levels',
    '5. Control status — current mode, any recommendations',
    '',
    'Keep it under 500 words. Be specific about numbers and names.',
    '',
    '---',
    '',
    `## Project: ${projectConfig.title}`,
    `**Description:** ${projectConfig.description}`,
    `**Goals:** ${projectConfig.goals.join('; ')}`,
    `**Constraints:** ${projectConfig.constraints.join('; ') || 'None'}`,
    `**Control Mode:** ${controlMode}`,
    `**Current Tick:** ${snapshot.version}`,
    '',
  ]

  // Workstreams
  if (snapshot.workstreams.length > 0) {
    lines.push('## Workstreams')
    for (const ws of snapshot.workstreams) {
      lines.push(`- **${ws.name}** (${ws.id}): status=${ws.status}, agents=${ws.activeAgentIds.length}, artifacts=${ws.artifactCount}, pending decisions=${ws.pendingDecisionCount}`)
      if (ws.recentActivity) lines.push(`  Recent: ${ws.recentActivity}`)
    }
    lines.push('')
  }

  // Active agents
  if (activeAgents.length > 0) {
    lines.push('## Active Agents')
    const trustMap = new Map(trustScores.map(t => [t.agentId, t.score]))
    for (const agent of activeAgents) {
      const trust = trustMap.get(agent.id) ?? 50
      lines.push(`- **${agent.id}** (${agent.pluginName}): status=${agent.status}, trust=${trust}/100`)
    }
    lines.push('')
  }

  // Pending decisions
  if (snapshot.pendingDecisions.length > 0) {
    lines.push('## Pending Decisions')
    for (const d of snapshot.pendingDecisions) {
      lines.push(`- **${d.title}** (${d.severity}): agent=${d.agentId}, subtype=${d.subtype}`)
    }
    lines.push('')
  }

  // Coherence issues
  if (snapshot.recentCoherenceIssues.length > 0) {
    lines.push('## Recent Coherence Issues')
    for (const issue of snapshot.recentCoherenceIssues) {
      lines.push(`- **${issue.title}** (${issue.severity}, ${issue.category}): workstreams=${issue.affectedWorkstreams.join(', ')}`)
    }
    lines.push('')
  }

  // Artifacts
  if (snapshot.artifactIndex.length > 0) {
    lines.push(`## Artifacts (${snapshot.artifactIndex.length} total)`)
    const byStatus = new Map<string, number>()
    for (const a of snapshot.artifactIndex) {
      byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1)
    }
    for (const [status, count] of byStatus) {
      lines.push(`- ${status}: ${count}`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('Generate the narrative briefing now.')

  return lines.join('\n')
}
