/**
 * Narrative briefing generator.
 *
 * Produces multi-paragraph narrative summaries from project state.
 * Template-based for the prototype — what changed, what needs attention,
 * what agents did autonomously.
 *
 * "When I open the project, show me what needs my judgment first."
 */

import type { ProjectState, Severity, TimelineEvent } from '../types/index.js';

// ── Helpers ───────────────────────────────────────────────────────

function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural ?? singular + 's'}`;
}

function severityLabel(severity: Severity): string {
  return severity === 'critical' ? 'critical' : severity;
}

/**
 * Get events from the most recent tick (or last N ticks for richer briefings).
 */
function recentEvents(timeline: TimelineEvent[], currentTick: number, window = 3): TimelineEvent[] {
  const cutoff = currentTick - window;
  return timeline.filter((e) => e.tick > cutoff);
}

// ── Briefing Builder ──────────────────────────────────────────────

/**
 * Build a multi-paragraph narrative briefing from project state.
 *
 * Structure:
 * 1. Opening summary — project status at a glance
 * 2. What happened — recent events and agent activity
 * 3. What needs attention — pending decisions and coherence issues
 * 4. Control status — current mode and any recommendations
 */
export function buildBriefing(state: ProjectState): string {
  if (!state.project) {
    return 'No project loaded. Select a scenario to begin.';
  }

  const paragraphs: string[] = [];

  // 1. Opening summary
  paragraphs.push(buildOpeningSummary(state));

  // 2. What happened recently
  const recentActivity = buildRecentActivity(state);
  if (recentActivity) paragraphs.push(recentActivity);

  // 3. What needs attention
  const attentionNeeded = buildAttentionSection(state);
  if (attentionNeeded) paragraphs.push(attentionNeeded);

  // 4. Agent activity summary
  const agentSummary = buildAgentSummary(state);
  if (agentSummary) paragraphs.push(agentSummary);

  // 5. Control status
  const controlStatus = buildControlStatus(state);
  if (controlStatus) paragraphs.push(controlStatus);

  return paragraphs.join('\n\n');
}

/**
 * Generate a one-line summary for the VitalStrip.
 */
export function buildOneLiner(state: ProjectState): string {
  if (!state.project) return 'No project loaded';

  const pendingCount = state.decisions.filter((d) => !d.resolved).length;
  const activeStatuses = new Set(['detected', 'confirmed', 'in_progress']);
  const issueCount = state.coherenceIssues.filter((i) => activeStatuses.has(i.status)).length;

  if (state.project.emergencyBrakeEngaged) {
    return 'EMERGENCY BRAKE ENGAGED — all agent work paused';
  }

  const parts: string[] = [];

  if (pendingCount > 0) {
    const critical = state.decisions.filter(
      (d) => !d.resolved && d.severity === 'critical',
    ).length;
    if (critical > 0) {
      parts.push(`${pluralize(critical, 'critical decision')} awaiting`);
    } else {
      parts.push(`${pluralize(pendingCount, 'decision')} in queue`);
    }
  }

  if (issueCount > 0) {
    parts.push(`${pluralize(issueCount, 'coherence issue')}`);
  }

  if (parts.length === 0) {
    return `${state.project.name} — all clear at tick ${state.project.currentTick}`;
  }

  return parts.join(' · ');
}

// ── Section Builders ──────────────────────────────────────────────

function buildOpeningSummary(state: ProjectState): string {
  const p = state.project!;
  const tick = p.currentTick;
  const phase = p.phase;
  const mode = p.controlMode;

  const lines: string[] = [
    `**${p.name}** is in the **${phase}** phase (tick ${tick}), ` +
      `operating in **${mode}** mode.`,
  ];

  // Add coherence health
  const score = state.metrics.coherenceScore;
  if (score >= 80) {
    lines.push(`Coherence is healthy at ${score}/100.`);
  } else if (score >= 50) {
    lines.push(`Coherence is at ${score}/100 — some issues need attention.`);
  } else {
    lines.push(`Coherence is low at ${score}/100 — multiple unresolved issues are dragging it down.`);
  }

  // Add rework risk if notable
  const risk = state.metrics.reworkRisk;
  if (risk > 40) {
    lines.push(`Rework risk is elevated at ${risk}%.`);
  }

  return lines.join(' ');
}

function buildRecentActivity(state: ProjectState): string | null {
  const events = recentEvents(state.timeline, state.project!.currentTick);
  if (events.length === 0) return null;

  const decisionsMade = events.filter(
    (e) => e.category === 'decision_resolved',
  );
  const artifactsProduced = events.filter(
    (e) => e.category === 'artifact_produced' || e.category === 'artifact_updated',
  );
  const issuesDetected = events.filter(
    (e) => e.category === 'coherence_detected',
  );

  const parts: string[] = ['**Since your last visit:**'];

  if (decisionsMade.length > 0) {
    parts.push(
      `${pluralize(decisionsMade.length, 'decision was', 'decisions were')} resolved.`,
    );
  }

  if (artifactsProduced.length > 0) {
    parts.push(
      `Agents produced or updated ${pluralize(artifactsProduced.length, 'artifact')}.`,
    );
  }

  if (issuesDetected.length > 0) {
    parts.push(
      `${pluralize(issuesDetected.length, 'new coherence issue was', 'new coherence issues were')} detected.`,
    );
  }

  if (parts.length === 1) return null; // only the header, nothing to report
  return parts.join(' ');
}

function buildAttentionSection(state: ProjectState): string | null {
  const pendingDecisions = state.decisions
    .filter((d) => !d.resolved)
    .sort((a, b) => b.attentionScore - a.attentionScore);

  const activeStatuses = new Set(['detected', 'confirmed', 'in_progress']);
  const openIssues = state.coherenceIssues.filter((i) => activeStatuses.has(i.status));

  if (pendingDecisions.length === 0 && openIssues.length === 0) return null;

  const parts: string[] = ['**Needs your attention:**'];

  if (pendingDecisions.length > 0) {
    const topDecision = pendingDecisions[0];
    parts.push(
      `The decision queue has ${pluralize(pendingDecisions.length, 'item')}. ` +
        `Highest priority: "${topDecision.title}" (${severityLabel(topDecision.severity)}, ` +
        `confidence ${Math.round(topDecision.confidence * 100)}%).`,
    );

    // Flag overdue items
    const overdue = pendingDecisions.filter(
      (d) => d.dueByTick !== null && d.dueByTick <= state.project!.currentTick,
    );
    if (overdue.length > 0) {
      parts.push(`${pluralize(overdue.length, 'decision is', 'decisions are')} overdue.`);
    }
  }

  if (openIssues.length > 0) {
    const critical = openIssues.filter((i) => i.severity === 'critical');
    if (critical.length > 0) {
      parts.push(
        `There ${critical.length === 1 ? 'is' : 'are'} ` +
          `${pluralize(critical.length, 'critical coherence issue')}: ` +
          `${critical.map((i) => `"${i.title}"`).join(', ')}.`,
      );
    } else {
      parts.push(`${pluralize(openIssues.length, 'coherence issue')} open.`);
    }
  }

  return parts.join(' ');
}

function buildAgentSummary(state: ProjectState): string | null {
  const events = recentEvents(state.timeline, state.project!.currentTick);
  const agentEvents = events.filter((e) => e.source === 'agent');

  if (agentEvents.length === 0) return null;

  // Group by agent
  const byAgent = new Map<string, TimelineEvent[]>();
  for (const e of agentEvents) {
    if (!e.agentId) continue;
    const list = byAgent.get(e.agentId) ?? [];
    list.push(e);
    byAgent.set(e.agentId, list);
  }

  if (byAgent.size === 0) return null;

  const p = state.project!;
  const agentMap = new Map(p.agents.map((a) => [a.id, a]));

  const parts: string[] = ['**Agent activity:**'];

  for (const [agentId, events] of byAgent) {
    const agent = agentMap.get(agentId);
    const name = agent?.name ?? agentId;
    const descriptions = events.slice(0, 3).map((e) => e.title);
    parts.push(`${name}: ${descriptions.join('; ')}.`);
  }

  return parts.join(' ');
}

function buildControlStatus(state: ProjectState): string | null {
  const pending = state.controlConfig.pendingRecommendations.filter(
    (r) => r.status === 'pending',
  );

  if (pending.length === 0) return null;

  const rec = pending[0];
  return (
    `**System recommendation:** Consider shifting from **${rec.currentMode}** to ` +
    `**${rec.recommendedMode}** mode. ${rec.rationale}`
  );
}
