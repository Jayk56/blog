/**
 * Mock scenario datasets for the Project Tab prototype.
 *
 * Five personas from the blog post, each demonstrating different
 * interaction modes and control positions on the orchestrator/ecosystem
 * spectrum.
 */

import type {
  Project,
  DecisionItem,
  CoherenceIssue,
  Artifact,
  TrustProfile,
  TimelineEvent,
  DecisionLogEntry,
  ControlConfig,
  Metrics,
  ProjectState,
} from '../types/index.js';

// ─── Scenario type ─────────────────────────────────────────────────

export interface Scenario {
  id: string;
  label: string;
  description: string;
  state: ProjectState;
}

// ─── Helper: default control config ────────────────────────────────

function makeControlConfig(
  mode: Project['controlMode'],
  overrides?: Partial<ControlConfig>,
): ControlConfig {
  return {
    mode,
    topology: [
      { dimension: 'phase', label: 'Execution', currentPosition: 50, recommendedPosition: 55 },
      { dimension: 'risk', label: 'Medium', currentPosition: 40, recommendedPosition: 45 },
      { dimension: 'domain_expertise', label: 'Shared', currentPosition: 50, recommendedPosition: 50 },
      { dimension: 'team_maturity', label: 'Established', currentPosition: 60, recommendedPosition: 65 },
    ],
    checkpoints: [
      { id: 'cp-phase', name: 'Phase Transition', trigger: 'phase_transition', description: 'Pause at every phase change for human review', enabled: true, customCondition: null },
      { id: 'cp-risk', name: 'High-Risk Touch', trigger: 'high_risk_touch', description: 'Pause when agents touch high-risk artifacts', enabled: true, customCondition: null },
      { id: 'cp-merge', name: 'Before Merge', trigger: 'before_merge', description: 'Pause before merging agent-produced work', enabled: mode === 'orchestrator', customCondition: null },
      { id: 'cp-daily', name: 'Daily Summary', trigger: 'daily_summary', description: 'Generate daily summary for human review', enabled: true, customCondition: null },
    ],
    bias: { value: 50 },
    riskAwareGating: true,
    pendingRecommendations: [],
    ...overrides,
  };
}

// ─── Helper: default metrics ───────────────────────────────────────

function makeMetrics(overrides?: Partial<Metrics>): Metrics {
  return {
    coherenceScore: 82,
    coherenceTrend: 'stable',
    reworkRisk: 15,
    pendingDecisionCount: 3,
    openCoherenceIssueCount: 2,
    humanInterventionRate: 30,
    highSeverityMissRate: 2,
    averageTrustScore: 0.78,
    totalDecisionCount: 24,
    totalArtifactCount: 18,
    reviewPatterns: [],
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO 1: Maya — Solo Creator (Ecosystem-leaning)
// ════════════════════════════════════════════════════════════════════

const mayaProject: Project = {
  id: 'maya-content-studio',
  name: 'Client C — Q1 Content Series',
  description: 'Four blog posts for Client C, including one on a controversial market trend.',
  persona: 'Maya',
  phase: 'execution',
  controlMode: 'ecosystem',
  riskProfile: { level: 'medium', domainExpertise: 'human_expert', teamMaturity: 'established' },
  agents: [
    { id: 'maya-research', name: 'Research Agent', role: 'Literature research and data gathering', trustScore: 0.85, active: true },
    { id: 'maya-writer', name: 'Writing Agent', role: 'Drafting and content production', trustScore: 0.72, active: true },
    { id: 'maya-review', name: 'Review Agent', role: 'Fact-checking and quality review', trustScore: 0.90, active: true },
    { id: 'maya-seo', name: 'SEO Agent', role: 'SEO optimization and metadata', trustScore: 0.88, active: true },
  ],
  workstreams: [
    { id: 'ws-post1', name: 'Post 1: Market Trends', description: 'Industry analysis post', agentIds: ['maya-research', 'maya-writer'], dependsOn: [], status: 'complete' },
    { id: 'ws-post2', name: 'Post 2: Customer Story', description: 'Case study post', agentIds: ['maya-research', 'maya-writer'], dependsOn: [], status: 'active' },
    { id: 'ws-post3', name: 'Post 3: Tech Overview', description: 'Technical explainer', agentIds: ['maya-research', 'maya-writer', 'maya-seo'], dependsOn: [], status: 'active' },
    { id: 'ws-post4', name: 'Post 4: Market Sizing (Controversial)', description: 'Sensitive topic requiring careful framing', agentIds: ['maya-research', 'maya-writer', 'maya-review'], dependsOn: [], status: 'blocked' },
  ],
  goals: ['Deliver four high-quality blog posts by Friday', 'Maintain consistent brand voice across all posts', 'Achieve SEO keyword targets for each post'],
  constraints: ['Use conservative market numbers when sources conflict', 'Client brand voice guide must be followed for tone', 'All claims must have cited sources'],
  currentTick: 8,
  emergencyBrakeEngaged: false,
  createdAt: '2026-02-03T09:00:00Z',
};

const mayaDecisions: DecisionItem[] = [
  {
    id: 'maya-d1',
    title: 'Conflicting market size data for Post 4',
    summary: 'Two reputable sources disagree on the addressable market size. Source A (Gartner) estimates $4.2B, Source B (IDC) estimates $6.8B. The discrepancy appears to stem from different TAM definitions. The research agent recommends using the Gartner figure as it uses a more conservative methodology.',
    type: 'content',
    severity: 'high',
    confidence: 0.65,
    blastRadius: { artifactCount: 2, workstreamCount: 1, agentCount: 2, magnitude: 'medium' },
    options: [
      { id: 'maya-d1-o1', label: 'Use Gartner ($4.2B)', description: 'Conservative estimate with tighter TAM definition', consequence: 'Post will be more defensible but may understate the opportunity', recommended: true, actionKind: 'approve' },
      { id: 'maya-d1-o2', label: 'Use IDC ($6.8B)', description: 'Broader TAM including adjacent markets', consequence: 'Larger number looks better but harder to defend', recommended: false, actionKind: 'approve' },
      { id: 'maya-d1-o3', label: 'Cite both with context', description: 'Present the range and explain the methodology differences', consequence: 'More nuanced but longer section, may dilute the main argument', recommended: false, actionKind: 'approve' },
    ],
    affectedArtifactIds: ['maya-a4', 'maya-a5'],
    relatedWorkstreamIds: ['ws-post4'],
    sourceAgentId: 'maya-research',
    attentionScore: 85,
    requiresRationale: true,
    createdAtTick: 7,
    dueByTick: 10,
    resolved: false,
    resolution: null,
  },
  {
    id: 'maya-d2',
    title: 'Post 2 metaphor doesn\'t match brand voice',
    summary: 'The writing agent used an extended sports metaphor in Post 2. The review agent flagged it as inconsistent with the client\'s professional/analytical brand voice. The writing agent argues it improves readability.',
    type: 'content',
    severity: 'medium',
    confidence: 0.80,
    blastRadius: { artifactCount: 1, workstreamCount: 1, agentCount: 1, magnitude: 'small' },
    options: [
      { id: 'maya-d2-o1', label: 'Remove the metaphor', description: 'Replace with analytical framing', consequence: 'Tone matches brand guide, section may be drier', recommended: true, actionKind: 'approve' },
      { id: 'maya-d2-o2', label: 'Keep it', description: 'Accept the creative departure', consequence: 'Readability improves but risks client pushback on tone', recommended: false, actionKind: 'approve' },
    ],
    affectedArtifactIds: ['maya-a2'],
    relatedWorkstreamIds: ['ws-post2'],
    sourceAgentId: 'maya-review',
    attentionScore: 55,
    requiresRationale: false,
    createdAtTick: 6,
    dueByTick: 9,
    resolved: false,
    resolution: null,
  },
  {
    id: 'maya-d3',
    title: 'Post 3: Include auto-generated data visualization?',
    summary: 'The research agent independently pulled public market data and generated a chart showing technology adoption trends. This wasn\'t requested but adds value. Do you want to include it?',
    type: 'content',
    severity: 'low',
    confidence: 0.90,
    blastRadius: { artifactCount: 1, workstreamCount: 1, agentCount: 1, magnitude: 'small' },
    options: [
      { id: 'maya-d3-o1', label: 'Include it', description: 'Add the visualization to the post', consequence: 'Post gets richer content; extra review needed for data accuracy', recommended: true, actionKind: 'approve' },
      { id: 'maya-d3-o2', label: 'Skip it', description: 'Keep the post as planned', consequence: 'No extra review needed, post ships as-is', recommended: false, actionKind: 'reject' },
    ],
    affectedArtifactIds: ['maya-a3'],
    relatedWorkstreamIds: ['ws-post3'],
    sourceAgentId: 'maya-research',
    attentionScore: 30,
    requiresRationale: false,
    createdAtTick: 8,
    dueByTick: null,
    resolved: false,
    resolution: null,
  },
];

const mayaCoherenceIssues: CoherenceIssue[] = [
  {
    id: 'maya-ci1',
    title: 'Inconsistent terminology: "market segment" vs "vertical"',
    description: 'Post 1 uses "market segment" throughout while Post 3 uses "vertical" for the same concept. Client style guide doesn\'t specify a preference.',
    category: 'style_divergence',
    severity: 'low',
    status: 'detected',
    workstreamIds: ['ws-post1', 'ws-post3'],
    agentIds: ['maya-writer'],
    artifactIds: ['maya-a1', 'maya-a3'],
    suggestedResolution: 'Standardize on "market segment" across all posts for consistency.',
    detectedAtTick: 7,
    resolvedAtTick: null,
  },
];

const mayaArtifacts: Artifact[] = [
  { id: 'maya-a1', name: 'post-1-market-trends.md', kind: 'document', description: 'Published post on industry market trends', workstreamId: 'ws-post1', provenance: { sourceArtifactIds: [], producerAgentId: 'maya-writer', validatorAgentIds: ['maya-review'], humanReviewerId: 'maya', relatedDecisionIds: [], producedAtTick: 3, lastModifiedAtTick: 5 }, qualityScore: 0.92, status: 'approved' },
  { id: 'maya-a2', name: 'post-2-customer-story.md', kind: 'document', description: 'Case study draft with brand voice issue', workstreamId: 'ws-post2', provenance: { sourceArtifactIds: [], producerAgentId: 'maya-writer', validatorAgentIds: ['maya-review'], humanReviewerId: null, relatedDecisionIds: ['maya-d2'], producedAtTick: 5, lastModifiedAtTick: 6 }, qualityScore: 0.75, status: 'in_review' },
  { id: 'maya-a3', name: 'post-3-tech-overview.md', kind: 'document', description: 'Technical explainer draft', workstreamId: 'ws-post3', provenance: { sourceArtifactIds: [], producerAgentId: 'maya-writer', validatorAgentIds: [], humanReviewerId: null, relatedDecisionIds: ['maya-d3'], producedAtTick: 6, lastModifiedAtTick: 8 }, qualityScore: 0.80, status: 'draft' },
  { id: 'maya-a4', name: 'post-4-research.md', kind: 'research', description: 'Research compilation for controversial market sizing post', workstreamId: 'ws-post4', provenance: { sourceArtifactIds: [], producerAgentId: 'maya-research', validatorAgentIds: [], humanReviewerId: null, relatedDecisionIds: ['maya-d1'], producedAtTick: 7, lastModifiedAtTick: 7 }, qualityScore: 0.70, status: 'in_review' },
  { id: 'maya-a5', name: 'post-4-outline.md', kind: 'document', description: 'Outline for the market sizing post, blocked on data decision', workstreamId: 'ws-post4', provenance: { sourceArtifactIds: ['maya-a4'], producerAgentId: 'maya-writer', validatorAgentIds: [], humanReviewerId: null, relatedDecisionIds: ['maya-d1'], producedAtTick: 7, lastModifiedAtTick: 7 }, qualityScore: 0.60, status: 'draft' },
];

const mayaTrustProfiles: TrustProfile[] = [
  { agentId: 'maya-research', currentScore: 0.85, trend: 'stable', trajectory: [{ tick: 1, score: 0.80, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 4, score: 0.83, successCount: 3, overrideCount: 0, reworkCount: 1, totalTasks: 4 }, { tick: 8, score: 0.85, successCount: 6, overrideCount: 0, reworkCount: 1, totalTasks: 7 }], scoreByDomain: { research: 0.90, document: 0.75 } },
  { agentId: 'maya-writer', currentScore: 0.72, trend: 'stable', trajectory: [{ tick: 1, score: 0.70, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 4, score: 0.74, successCount: 2, overrideCount: 1, reworkCount: 0, totalTasks: 3 }, { tick: 8, score: 0.72, successCount: 3, overrideCount: 1, reworkCount: 1, totalTasks: 5 }], scoreByDomain: { document: 0.72 } },
  { agentId: 'maya-review', currentScore: 0.90, trend: 'increasing', trajectory: [{ tick: 1, score: 0.85, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 4, score: 0.88, successCount: 3, overrideCount: 0, reworkCount: 0, totalTasks: 3 }, { tick: 8, score: 0.90, successCount: 5, overrideCount: 0, reworkCount: 0, totalTasks: 5 }], scoreByDomain: { document: 0.90 } },
  { agentId: 'maya-seo', currentScore: 0.88, trend: 'stable', trajectory: [{ tick: 3, score: 0.85, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 6, score: 0.88, successCount: 2, overrideCount: 0, reworkCount: 0, totalTasks: 2 }], scoreByDomain: { configuration: 0.88 } },
];

const mayaTimeline: TimelineEvent[] = [
  { id: 'maya-e1', tick: 1, source: 'system', agentId: null, category: 'phase_changed', severity: 'info', title: 'Project started — Kickoff phase', description: 'Project initialized with four blog posts for Client C.', relatedArtifactIds: [], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'maya-e2', tick: 2, source: 'system', agentId: null, category: 'phase_changed', severity: 'info', title: 'Moved to Execution phase', description: 'Brief approved, agents beginning parallel research on all four topics.', relatedArtifactIds: [], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'maya-e3', tick: 3, source: 'agent', agentId: 'maya-writer', category: 'artifact_produced', severity: 'info', title: 'Post 1 first draft complete', description: 'Writing agent produced a 1,200-word draft on market trends.', relatedArtifactIds: ['maya-a1'], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'maya-e4', tick: 5, source: 'human', agentId: null, category: 'decision_resolved', severity: 'info', title: 'Post 1 approved for publication', description: 'Maya reviewed and approved the final draft of Post 1.', relatedArtifactIds: ['maya-a1'], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'maya-e5', tick: 6, source: 'agent', agentId: 'maya-review', category: 'decision_created', severity: 'medium', title: 'Brand voice issue flagged in Post 2', description: 'Review agent detected a sports metaphor that doesn\'t match the client\'s analytical brand voice.', relatedArtifactIds: ['maya-a2'], relatedDecisionIds: ['maya-d2'], relatedCoherenceIssueIds: [] },
  { id: 'maya-e6', tick: 7, source: 'agent', agentId: 'maya-research', category: 'decision_created', severity: 'high', title: 'Conflicting data sources for Post 4', description: 'Research agent found Gartner and IDC disagree on market size. Human decision needed before outline can proceed.', relatedArtifactIds: ['maya-a4'], relatedDecisionIds: ['maya-d1'], relatedCoherenceIssueIds: [] },
  { id: 'maya-e7', tick: 7, source: 'system', agentId: null, category: 'coherence_detected', severity: 'low', title: 'Terminology inconsistency detected', description: 'Posts 1 and 3 use different terms for the same concept.', relatedArtifactIds: ['maya-a1', 'maya-a3'], relatedDecisionIds: [], relatedCoherenceIssueIds: ['maya-ci1'] },
  { id: 'maya-e8', tick: 8, source: 'agent', agentId: 'maya-research', category: 'decision_created', severity: 'low', title: 'Auto-generated visualization available', description: 'Research agent independently created a data visualization for Post 3.', relatedArtifactIds: ['maya-a3'], relatedDecisionIds: ['maya-d3'], relatedCoherenceIssueIds: [] },
];

const mayaDecisionLog: DecisionLogEntry[] = [
  { id: 'maya-dl1', tick: 5, source: 'human', agentId: null, title: 'Approved Post 1 for publication', summary: 'All quality checks passed, brand voice consistent.', actionKind: 'approve', rationale: 'Strong draft, minimal edits needed.', reversible: true, reversed: false, flaggedForReview: false },
];

const mayaState: ProjectState = {
  project: mayaProject,
  decisions: mayaDecisions,
  coherenceIssues: mayaCoherenceIssues,
  artifacts: mayaArtifacts,
  trustProfiles: mayaTrustProfiles,
  timeline: mayaTimeline,
  decisionLog: mayaDecisionLog,
  controlConfig: makeControlConfig('ecosystem', {
    topology: [
      { dimension: 'phase', label: 'Execution', currentPosition: 55, recommendedPosition: 60 },
      { dimension: 'risk', label: 'Medium', currentPosition: 60, recommendedPosition: 65 },
      { dimension: 'domain_expertise', label: 'Human Expert', currentPosition: 40, recommendedPosition: 45 },
      { dimension: 'team_maturity', label: 'Established', currentPosition: 65, recommendedPosition: 70 },
    ],
  }),
  metrics: makeMetrics({
    coherenceScore: 88,
    coherenceTrend: 'stable',
    reworkRisk: 12,
    pendingDecisionCount: 3,
    openCoherenceIssueCount: 1,
    humanInterventionRate: 20,
    highSeverityMissRate: 0,
    averageTrustScore: 0.84,
    totalDecisionCount: 8,
    totalArtifactCount: 5,
    reviewPatterns: [
      { artifactKind: 'document', reviewRate: 80, reworkRate: 15, missRate: 5, suggestedReviewRate: 60, suggestion: 'Your document rework rate is low. You could review fewer drafts.' },
      { artifactKind: 'research', reviewRate: 100, reworkRate: 10, missRate: 0, suggestedReviewRate: 80, suggestion: 'Research outputs are consistently high quality.' },
    ],
  }),
  briefing: `## Monday Morning Briefing

**Post 1** (Market Trends) shipped successfully on Friday. No issues flagged post-publication.

**Post 2** (Customer Story) has a first draft in review. The review agent flagged a brand voice issue — a sports metaphor that may not match Client C's analytical tone. Your call on whether to keep or replace it.

**Post 3** (Tech Overview) is progressing well. The research agent independently created a data visualization showing technology adoption trends. It looks good — take a look and decide if you want to include it.

**Post 4** (Market Sizing) is **blocked**. The research agent found conflicting data from Gartner and IDC on the addressable market size. This is the highest-priority decision in your queue — the outline can't proceed until you pick a direction.

**System note:** A minor terminology inconsistency was detected between Posts 1 and 3 — "market segment" vs. "vertical" for the same concept.`,
  activeScenarioId: 'maya',
  autoSimulate: false,
  viewingTick: null,
  briefingSource: 'template',
};


// ════════════════════════════════════════════════════════════════════
// SCENARIO 2: David — Small Team Lead (Orchestrator-leaning)
// ════════════════════════════════════════════════════════════════════

const davidProject: Project = {
  id: 'david-saas-notifications',
  name: 'Real-Time Notification System',
  description: 'WebSocket-based notification system for the SaaS platform. Four developers with coding agents.',
  persona: 'David',
  phase: 'integration',
  controlMode: 'orchestrator',
  riskProfile: { level: 'high', domainExpertise: 'shared', teamMaturity: 'established' },
  agents: [
    { id: 'david-backend', name: 'Backend Agent', role: 'Server-side implementation', trustScore: 0.82, active: true },
    { id: 'david-frontend', name: 'Frontend Agent', role: 'UI component development', trustScore: 0.78, active: true },
    { id: 'david-db', name: 'Database Agent', role: 'Schema design and migrations', trustScore: 0.88, active: true },
    { id: 'david-test', name: 'Testing Agent', role: 'Test suite generation', trustScore: 0.85, active: true },
    { id: 'david-review', name: 'Code Review Agent', role: 'Automated code review and coherence scanning', trustScore: 0.91, active: true },
  ],
  workstreams: [
    { id: 'ws-db', name: 'Database Layer', description: 'Notification schema and migrations', agentIds: ['david-db'], dependsOn: [], status: 'complete' },
    { id: 'ws-backend', name: 'Backend Services', description: 'WebSocket server, preference API, dispatch service', agentIds: ['david-backend'], dependsOn: ['ws-db'], status: 'complete' },
    { id: 'ws-frontend', name: 'Frontend Components', description: 'Notification center and preference panel', agentIds: ['david-frontend'], dependsOn: [], status: 'active' },
    { id: 'ws-integration', name: 'Integration', description: 'Wire frontend to backend, end-to-end testing', agentIds: ['david-backend', 'david-frontend', 'david-test'], dependsOn: ['ws-backend', 'ws-frontend'], status: 'active' },
  ],
  goals: ['Ship notification system by end of sprint', 'Reuse existing WebSocket infrastructure from chat', 'Achieve 90%+ test coverage'],
  constraints: ['Use existing ws library from chat feature — no new WebSocket dependencies', 'Follow existing API response format for consistency', 'All new endpoints require auth middleware', 'Prefer date-fns for date operations (ADR-2026-004)'],
  currentTick: 14,
  emergencyBrakeEngaged: false,
  createdAt: '2026-01-27T09:00:00Z',
};

const davidDecisions: DecisionItem[] = [
  {
    id: 'david-d1',
    title: 'Notification preference API response format inconsistency',
    summary: 'The notification preferences API returns data in a nested format ({ preferences: { email: true, push: false } }) while the existing user preferences API uses a flat format ({ email_notifications: true, push_notifications: false }). The frontend agent generated types based on the new nested format. The code review agent flagged the inconsistency.',
    type: 'architectural',
    severity: 'high',
    confidence: 0.75,
    blastRadius: { artifactCount: 4, workstreamCount: 3, agentCount: 3, magnitude: 'large' },
    options: [
      { id: 'david-d1-o1', label: 'Retrofit to flat format', description: 'Change new API to match existing user preferences format', consequence: 'Consistent API surface, 2-3 hours rework on backend + frontend types', recommended: true, actionKind: 'approve' },
      { id: 'david-d1-o2', label: 'Accept nested format', description: 'Keep the new API as-is', consequence: 'Ships faster, creates tech debt — frontend needs two different parsers', recommended: false, actionKind: 'approve' },
      { id: 'david-d1-o3', label: 'Migrate both to nested', description: 'Update old user preferences API to use nested format too', consequence: 'Best long-term, but scope creep — affects settings page', recommended: false, actionKind: 'approve' },
    ],
    affectedArtifactIds: ['david-a3', 'david-a4', 'david-a5', 'david-a6'],
    relatedWorkstreamIds: ['ws-backend', 'ws-frontend', 'ws-integration'],
    sourceAgentId: 'david-review',
    attentionScore: 90,
    requiresRationale: true,
    createdAtTick: 13,
    dueByTick: 16,
    resolved: false,
    resolution: null,
  },
  {
    id: 'david-d2',
    title: 'WebSocket reconnection strategy',
    summary: 'The backend agent implemented a simple reconnect with fixed 5-second intervals. The testing agent found this causes connection storms when the server restarts and 200+ clients reconnect simultaneously. Recommends exponential backoff with jitter.',
    type: 'architectural',
    severity: 'high',
    confidence: 0.92,
    blastRadius: { artifactCount: 2, workstreamCount: 2, agentCount: 2, magnitude: 'medium' },
    options: [
      { id: 'david-d2-o1', label: 'Exponential backoff with jitter', description: 'Start at 1s, max 30s, add random jitter', consequence: 'Prevents connection storms, industry standard approach', recommended: true, actionKind: 'approve' },
      { id: 'david-d2-o2', label: 'Keep fixed interval', description: 'Accept the connection storm risk', consequence: 'Simpler code but production risk under load', recommended: false, actionKind: 'reject' },
    ],
    affectedArtifactIds: ['david-a3', 'david-a5'],
    relatedWorkstreamIds: ['ws-backend', 'ws-frontend'],
    sourceAgentId: 'david-test',
    attentionScore: 82,
    requiresRationale: false,
    createdAtTick: 12,
    dueByTick: 15,
    resolved: false,
    resolution: null,
  },
  {
    id: 'david-d3',
    title: 'Auto-generated API documentation',
    summary: 'The backend agent generated OpenAPI documentation for all new endpoints, matching the style of existing API docs. Review to confirm accuracy.',
    type: 'quality',
    severity: 'low',
    confidence: 0.95,
    blastRadius: { artifactCount: 1, workstreamCount: 1, agentCount: 1, magnitude: 'small' },
    options: [
      { id: 'david-d3-o1', label: 'Approve docs', description: 'Accept the generated documentation', consequence: 'API docs are immediately available for the team', recommended: true, actionKind: 'approve' },
      { id: 'david-d3-o2', label: 'Request revisions', description: 'Flag specific sections for improvement', consequence: 'Better docs but delays availability', recommended: false, actionKind: 'reject' },
    ],
    affectedArtifactIds: ['david-a7'],
    relatedWorkstreamIds: ['ws-backend'],
    sourceAgentId: 'david-backend',
    attentionScore: 25,
    requiresRationale: false,
    createdAtTick: 14,
    dueByTick: null,
    resolved: false,
    resolution: null,
  },
  {
    id: 'david-d4',
    title: 'Agent requests: Run database migration script',
    summary: 'The database agent is requesting permission to execute a SQL migration script that creates the notification tables and indexes required by the WebSocket handler.',
    subtype: 'tool_approval',
    type: 'risk',
    severity: 'high',
    confidence: 0.88,
    blastRadius: { artifactCount: 1, workstreamCount: 2, agentCount: 2, magnitude: 'large' },
    toolArgs: { command: 'psql -f migrations/migrate_notifications.sql', description: 'Execute notification table migration' },
    reasoning: 'All schema validation checks passed. The notifications table and indexes need to be created before the backend WebSocket handler can store delivery receipts.',
    options: [
      { id: 'david-d4-o1', label: 'Approve Migration', description: 'Allow the agent to execute the migration script', consequence: 'Notification tables and indexes will be created, unblocking the WebSocket handler', recommended: true, actionKind: 'approve' },
      { id: 'david-d4-o2', label: 'Hold for Manual Review', description: 'Block execution and review the migration script manually', consequence: 'WebSocket handler remains blocked until migration is manually reviewed and executed', recommended: false, actionKind: 'reject' },
    ],
    affectedArtifactIds: ['david-a1'],
    relatedWorkstreamIds: ['ws-db', 'ws-integration'],
    sourceAgentId: 'david-db',
    attentionScore: 80,
    requiresRationale: false,
    createdAtTick: 14,
    dueByTick: 16,
    resolved: false,
    resolution: null,
  },
  {
    id: 'david-d5',
    title: 'Agent requests: Write WebSocket config file',
    summary: 'The backend agent wants to create a centralized WebSocket configuration file to consolidate scattered inline config objects.',
    subtype: 'tool_approval',
    type: 'architectural',
    severity: 'medium',
    confidence: 0.92,
    blastRadius: { artifactCount: 3, workstreamCount: 1, agentCount: 1, magnitude: 'medium' },
    toolArgs: { file_path: 'src/config/websocket.ts', content: 'export const WS_CONFIG = { reconnectBackoff: { initialMs: 1000, maxMs: 30000, jitterFactor: 0.3 }, heartbeatIntervalMs: 15000, maxReconnectAttempts: 10 }' },
    reasoning: 'Creating a centralized WebSocket configuration file to replace the three separate inline config objects found across notification-handler.ts, ws-client.ts, and reconnect.ts.',
    options: [
      { id: 'david-d5-o1', label: 'Approve Write', description: 'Allow the agent to create the config file', consequence: 'Config is centralized, three files will need updating to import from the new location', recommended: true, actionKind: 'approve' },
      { id: 'david-d5-o2', label: 'Reject', description: 'Deny the file creation', consequence: 'Inline configs remain scattered across three files', recommended: false, actionKind: 'reject' },
    ],
    affectedArtifactIds: ['david-a2', 'david-a3', 'david-a5'],
    relatedWorkstreamIds: ['ws-backend'],
    sourceAgentId: 'david-backend',
    attentionScore: 58,
    requiresRationale: false,
    createdAtTick: 14,
    dueByTick: null,
    resolved: false,
    resolution: null,
  },
];

const davidCoherenceIssues: CoherenceIssue[] = [
  {
    id: 'david-ci1',
    title: 'API response format mismatch between preference endpoints',
    description: 'The new notification preferences API uses nested objects while existing user preferences use a flat structure. Frontend code needs different parsers for each.',
    category: 'api_contract_drift',
    severity: 'high',
    status: 'confirmed',
    workstreamIds: ['ws-backend', 'ws-frontend'],
    agentIds: ['david-backend', 'david-frontend'],
    artifactIds: ['david-a3', 'david-a5'],
    suggestedResolution: 'Retrofit the new endpoint to match the existing flat response format.',
    detectedAtTick: 13,
    resolvedAtTick: null,
  },
  {
    id: 'david-ci2',
    title: 'Duplicate date formatting utilities',
    description: 'The frontend agent imported moment.js for date formatting in the notification center, despite an existing date-fns setup used everywhere else.',
    category: 'dependency_conflict',
    severity: 'medium',
    status: 'resolved',
    workstreamIds: ['ws-frontend'],
    agentIds: ['david-frontend'],
    artifactIds: ['david-a5'],
    suggestedResolution: 'Replace moment.js usage with date-fns to match the project constraint (ADR-2026-004).',
    detectedAtTick: 10,
    resolvedAtTick: 11,
  },
];

const davidArtifacts: Artifact[] = [
  { id: 'david-a1', name: 'migrations/add_notifications.sql', kind: 'code', description: 'Database migration for notification tables', workstreamId: 'ws-db', provenance: { sourceArtifactIds: [], producerAgentId: 'david-db', validatorAgentIds: ['david-review'], humanReviewerId: 'david', relatedDecisionIds: [], producedAtTick: 3, lastModifiedAtTick: 4 }, qualityScore: 0.95, status: 'approved' },
  { id: 'david-a2', name: 'src/lib/ws/notification-handler.ts', kind: 'code', description: 'WebSocket handler for notification push', workstreamId: 'ws-backend', provenance: { sourceArtifactIds: ['david-a1'], producerAgentId: 'david-backend', validatorAgentIds: ['david-review'], humanReviewerId: 'david', relatedDecisionIds: [], producedAtTick: 6, lastModifiedAtTick: 8 }, qualityScore: 0.88, status: 'approved' },
  { id: 'david-a3', name: 'src/api/notification-preferences.ts', kind: 'code', description: 'Notification preference CRUD API', workstreamId: 'ws-backend', provenance: { sourceArtifactIds: ['david-a1'], producerAgentId: 'david-backend', validatorAgentIds: ['david-review'], humanReviewerId: null, relatedDecisionIds: ['david-d1'], producedAtTick: 7, lastModifiedAtTick: 9 }, qualityScore: 0.78, status: 'in_review' },
  { id: 'david-a4', name: 'src/services/notification-dispatch.ts', kind: 'code', description: 'Service for dispatching notifications to channels', workstreamId: 'ws-backend', provenance: { sourceArtifactIds: ['david-a2'], producerAgentId: 'david-backend', validatorAgentIds: ['david-review', 'david-test'], humanReviewerId: 'david', relatedDecisionIds: [], producedAtTick: 8, lastModifiedAtTick: 10 }, qualityScore: 0.90, status: 'approved' },
  { id: 'david-a5', name: 'src/components/NotificationCenter.tsx', kind: 'code', description: 'Frontend notification center component', workstreamId: 'ws-frontend', provenance: { sourceArtifactIds: [], producerAgentId: 'david-frontend', validatorAgentIds: ['david-review'], humanReviewerId: null, relatedDecisionIds: ['david-d1'], producedAtTick: 10, lastModifiedAtTick: 12 }, qualityScore: 0.75, status: 'in_review' },
  { id: 'david-a6', name: 'src/components/PreferencePanel.tsx', kind: 'code', description: 'Notification preference settings panel', workstreamId: 'ws-frontend', provenance: { sourceArtifactIds: ['david-a3'], producerAgentId: 'david-frontend', validatorAgentIds: [], humanReviewerId: null, relatedDecisionIds: ['david-d1'], producedAtTick: 11, lastModifiedAtTick: 12 }, qualityScore: 0.72, status: 'draft' },
  { id: 'david-a7', name: 'docs/api/notifications.yaml', kind: 'document', description: 'Auto-generated OpenAPI documentation', workstreamId: 'ws-backend', provenance: { sourceArtifactIds: ['david-a2', 'david-a3', 'david-a4'], producerAgentId: 'david-backend', validatorAgentIds: [], humanReviewerId: null, relatedDecisionIds: ['david-d3'], producedAtTick: 14, lastModifiedAtTick: 14 }, qualityScore: 0.80, status: 'draft' },
];

const davidTrustProfiles: TrustProfile[] = [
  { agentId: 'david-backend', currentScore: 0.82, trend: 'stable', trajectory: [{ tick: 2, score: 0.75, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 6, score: 0.80, successCount: 3, overrideCount: 0, reworkCount: 1, totalTasks: 4 }, { tick: 10, score: 0.82, successCount: 6, overrideCount: 1, reworkCount: 1, totalTasks: 8 }, { tick: 14, score: 0.82, successCount: 8, overrideCount: 1, reworkCount: 1, totalTasks: 10 }], scoreByDomain: { code: 0.85, document: 0.75 } },
  { agentId: 'david-frontend', currentScore: 0.78, trend: 'increasing', trajectory: [{ tick: 8, score: 0.70, successCount: 1, overrideCount: 1, reworkCount: 0, totalTasks: 2 }, { tick: 11, score: 0.73, successCount: 2, overrideCount: 1, reworkCount: 1, totalTasks: 4 }, { tick: 14, score: 0.78, successCount: 4, overrideCount: 1, reworkCount: 1, totalTasks: 6 }], scoreByDomain: { code: 0.78 } },
  { agentId: 'david-db', currentScore: 0.88, trend: 'stable', trajectory: [{ tick: 2, score: 0.85, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 5, score: 0.88, successCount: 2, overrideCount: 0, reworkCount: 0, totalTasks: 2 }], scoreByDomain: { code: 0.88 } },
  { agentId: 'david-test', currentScore: 0.85, trend: 'stable', trajectory: [{ tick: 5, score: 0.82, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 10, score: 0.85, successCount: 3, overrideCount: 0, reworkCount: 0, totalTasks: 3 }, { tick: 14, score: 0.85, successCount: 5, overrideCount: 0, reworkCount: 0, totalTasks: 5 }], scoreByDomain: { test: 0.88, code: 0.80 } },
  { agentId: 'david-review', currentScore: 0.91, trend: 'stable', trajectory: [{ tick: 3, score: 0.88, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 8, score: 0.90, successCount: 4, overrideCount: 0, reworkCount: 0, totalTasks: 4 }, { tick: 14, score: 0.91, successCount: 8, overrideCount: 0, reworkCount: 0, totalTasks: 8 }], scoreByDomain: { code: 0.91 } },
];

const davidTimeline: TimelineEvent[] = [
  { id: 'david-e1', tick: 1, source: 'human', agentId: null, category: 'phase_changed', severity: 'info', title: 'Project decomposed into 8 subtasks', description: 'David created the task breakdown for the notification system feature.', relatedArtifactIds: [], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'david-e2', tick: 4, source: 'agent', agentId: 'david-db', category: 'artifact_produced', severity: 'info', title: 'Database migration complete', description: 'Created notification_preferences and notifications tables with appropriate indexes.', relatedArtifactIds: ['david-a1'], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'david-e3', tick: 8, source: 'agent', agentId: 'david-backend', category: 'artifact_produced', severity: 'info', title: 'Backend services complete', description: 'WebSocket handler, preference API, and dispatch service implemented.', relatedArtifactIds: ['david-a2', 'david-a3', 'david-a4'], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'david-e4', tick: 10, source: 'system', agentId: null, category: 'coherence_detected', severity: 'medium', title: 'Duplicate date library detected', description: 'Frontend agent imported moment.js despite existing date-fns setup.', relatedArtifactIds: ['david-a5'], relatedDecisionIds: [], relatedCoherenceIssueIds: ['david-ci2'] },
  { id: 'david-e5', tick: 11, source: 'human', agentId: null, category: 'coherence_resolved', severity: 'info', title: 'Date library conflict resolved', description: 'David enforced ADR-2026-004: replaced moment.js with date-fns.', relatedArtifactIds: ['david-a5'], relatedDecisionIds: [], relatedCoherenceIssueIds: ['david-ci2'] },
  { id: 'david-e6', tick: 12, source: 'agent', agentId: 'david-test', category: 'decision_created', severity: 'high', title: 'WebSocket reconnection vulnerability', description: 'Testing revealed connection storms with fixed-interval reconnection.', relatedArtifactIds: ['david-a2'], relatedDecisionIds: ['david-d2'], relatedCoherenceIssueIds: [] },
  { id: 'david-e7', tick: 13, source: 'agent', agentId: 'david-review', category: 'coherence_detected', severity: 'high', title: 'API response format mismatch', description: 'New notification preferences API uses nested format; existing user prefs use flat format.', relatedArtifactIds: ['david-a3', 'david-a5'], relatedDecisionIds: ['david-d1'], relatedCoherenceIssueIds: ['david-ci1'] },
  { id: 'david-e8', tick: 13, source: 'system', agentId: null, category: 'phase_changed', severity: 'info', title: 'Entered Integration phase', description: 'Backend and frontend workstreams merging. Coherence review in progress.', relatedArtifactIds: [], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'david-e9', tick: 14, source: 'agent', agentId: 'david-db', category: 'decision_created', severity: 'high', title: 'Database agent requests migration execution', description: 'Database agent is requesting approval to run the notification table migration script.', relatedArtifactIds: ['david-a1'], relatedDecisionIds: ['david-d4'], relatedCoherenceIssueIds: [] },
  { id: 'david-e10', tick: 14, source: 'agent', agentId: 'david-backend', category: 'decision_created', severity: 'medium', title: 'Backend agent requests config file creation', description: 'Backend agent wants to create a centralized WebSocket configuration file.', relatedArtifactIds: ['david-a2'], relatedDecisionIds: ['david-d5'], relatedCoherenceIssueIds: [] },
];

const davidDecisionLog: DecisionLogEntry[] = [
  { id: 'david-dl1', tick: 4, source: 'human', agentId: null, title: 'Approved database migration', summary: 'Schema follows existing conventions, indexes are correct.', actionKind: 'approve', rationale: 'Clean migration, matches our naming patterns.', reversible: true, reversed: false, flaggedForReview: false },
  { id: 'david-dl2', tick: 8, source: 'human', agentId: null, title: 'Approved backend WebSocket handler', summary: 'Reuses existing ws library from chat feature as required.', actionKind: 'approve', rationale: 'Good reuse of existing infrastructure.', reversible: true, reversed: false, flaggedForReview: false },
  { id: 'david-dl3', tick: 11, source: 'human', agentId: null, title: 'Enforced date-fns constraint', summary: 'Directed frontend agent to replace moment.js with date-fns.', actionKind: 'override', rationale: 'ADR-2026-004 requires date-fns for all date operations.', reversible: true, reversed: false, flaggedForReview: false },
];

const davidState: ProjectState = {
  project: davidProject,
  decisions: davidDecisions,
  coherenceIssues: davidCoherenceIssues,
  artifacts: davidArtifacts,
  trustProfiles: davidTrustProfiles,
  timeline: davidTimeline,
  decisionLog: davidDecisionLog,
  controlConfig: makeControlConfig('orchestrator', {
    topology: [
      { dimension: 'phase', label: 'Integration', currentPosition: 25, recommendedPosition: 20 },
      { dimension: 'risk', label: 'High', currentPosition: 30, recommendedPosition: 25 },
      { dimension: 'domain_expertise', label: 'Shared', currentPosition: 45, recommendedPosition: 50 },
      { dimension: 'team_maturity', label: 'Established', currentPosition: 55, recommendedPosition: 60 },
    ],
    checkpoints: [
      { id: 'cp-phase', name: 'Phase Transition', trigger: 'phase_transition', description: 'Pause at every phase change', enabled: true, customCondition: null },
      { id: 'cp-risk', name: 'High-Risk Touch', trigger: 'high_risk_touch', description: 'Pause when agents touch auth or payments', enabled: true, customCondition: null },
      { id: 'cp-merge', name: 'Before Merge', trigger: 'before_merge', description: 'Review all PRs before merge', enabled: true, customCondition: null },
      { id: 'cp-daily', name: 'Daily Summary', trigger: 'daily_summary', description: 'Daily coherence summary', enabled: true, customCondition: null },
    ],
    pendingRecommendations: [
      { id: 'david-rec1', recommendedMode: 'adaptive', currentMode: 'orchestrator', rationale: 'Your rework rate is only 8% and test coverage is 91%. Consider loosening review gates on low-risk tasks to improve throughput.', signals: [{ source: 'rework_rate', observation: '8% rework rate across 10 tasks', weight: 0.6 }, { source: 'test_coverage', observation: '91% test pass rate on first run', weight: 0.4 }], status: 'pending', createdAtTick: 14 },
    ],
  }),
  metrics: makeMetrics({
    coherenceScore: 74,
    coherenceTrend: 'declining',
    reworkRisk: 22,
    pendingDecisionCount: 5,
    openCoherenceIssueCount: 1,
    humanInterventionRate: 45,
    highSeverityMissRate: 0,
    averageTrustScore: 0.85,
    totalDecisionCount: 14,
    totalArtifactCount: 7,
    reviewPatterns: [
      { artifactKind: 'code', reviewRate: 100, reworkRate: 8, missRate: 0, suggestedReviewRate: 75, suggestion: 'You review every code output. With an 8% rework rate, you could safely skip reviews on low-risk files.' },
      { artifactKind: 'document', reviewRate: 50, reworkRate: 0, missRate: 0, suggestedReviewRate: 30, suggestion: 'Documentation outputs have zero rework. Consider reducing review frequency.' },
    ],
  }),
  briefing: `## Sprint Integration Update

The notification system is entering the **integration phase**. Backend services are complete and approved. Frontend components are in review.

**Critical:** The code review agent found an **API response format inconsistency** between the new notification preferences endpoint and the existing user preferences API. The new endpoint uses nested objects while the old one uses flat keys. This is your highest-priority decision — it affects backend, frontend, and integration workstreams.

**Important:** The testing agent discovered that the WebSocket reconnection strategy (fixed 5-second intervals) will cause connection storms at scale. Recommends exponential backoff with jitter. Standard fix, high confidence recommendation.

**Resolved this sprint:** The duplicate date library issue (moment.js vs date-fns) was caught by the coherence scanner and resolved by enforcing the existing ADR.

**System recommendation:** Your rework rate is low (8%) and test pass rates are high (91%). The system suggests considering adaptive mode to improve throughput on low-risk tasks.`,
  activeScenarioId: 'david',
  autoSimulate: false,
  viewingTick: null,
  briefingSource: 'template',
};


// ════════════════════════════════════════════════════════════════════
// SCENARIO 3: Priya — Product Manager (Portfolio view)
// ════════════════════════════════════════════════════════════════════

const priyaProject: Project = {
  id: 'priya-team-b-auth',
  name: 'Team B — Authentication Overhaul',
  description: 'Modernizing the authentication flow after agents discovered a security flaw in the planned approach.',
  persona: 'Priya',
  phase: 'execution',
  controlMode: 'adaptive',
  riskProfile: { level: 'critical', domainExpertise: 'agent_expert', teamMaturity: 'established' },
  agents: [
    { id: 'priya-arch', name: 'Architecture Agent', role: 'System design and technical analysis', trustScore: 0.87, active: true },
    { id: 'priya-security', name: 'Security Agent', role: 'Security analysis and vulnerability assessment', trustScore: 0.93, active: true },
    { id: 'priya-impl', name: 'Implementation Agent', role: 'Code implementation', trustScore: 0.80, active: true },
    { id: 'priya-writer', name: 'Writing Agent', role: 'Stakeholder communication and documentation', trustScore: 0.85, active: true },
  ],
  workstreams: [
    { id: 'ws-security-audit', name: 'Security Audit', description: 'Assess current auth vulnerabilities', agentIds: ['priya-security'], dependsOn: [], status: 'complete' },
    { id: 'ws-auth-redesign', name: 'Auth Redesign', description: 'New authentication architecture', agentIds: ['priya-arch', 'priya-impl'], dependsOn: ['ws-security-audit'], status: 'active' },
    { id: 'ws-stakeholder-update', name: 'Stakeholder Communication', description: 'Update stakeholders on the auth change', agentIds: ['priya-writer'], dependsOn: ['ws-security-audit'], status: 'active' },
  ],
  goals: ['Modernize authentication to address discovered security flaw', 'Minimize disruption to other teams', 'Update stakeholder brief for Friday'],
  constraints: ['Zero-downtime migration required', 'Must maintain backward compatibility with existing sessions', 'All auth changes require security agent review'],
  currentTick: 11,
  emergencyBrakeEngaged: false,
  createdAt: '2026-01-20T09:00:00Z',
};

const priyaDecisions: DecisionItem[] = [
  {
    id: 'priya-d1',
    title: 'Cross-team dependency: Team A blocked by Team C migration delay',
    summary: 'Team A\'s new API endpoint depends on Team C\'s database migration, which was pushed to next sprint. Team A will be blocked in 3 days. Options: push Team C to expedite, have Team A mock the migration, or resequence Team A\'s work.',
    type: 'coordination',
    severity: 'high',
    confidence: 0.70,
    blastRadius: { artifactCount: 3, workstreamCount: 2, agentCount: 3, magnitude: 'large' },
    options: [
      { id: 'priya-d1-o1', label: 'Expedite Team C migration', description: 'Ask Team C to prioritize the migration', consequence: 'Unblocks Team A on schedule but disrupts Team C\'s sprint plan', recommended: false, actionKind: 'approve' },
      { id: 'priya-d1-o2', label: 'Team A mocks the migration', description: 'Have Team A build against a mock database', consequence: 'Team A continues but integration risk increases', recommended: true, actionKind: 'approve' },
      { id: 'priya-d1-o3', label: 'Resequence Team A work', description: 'Pull forward other Team A tasks', consequence: 'No disruption but feature delayed by 1 sprint', recommended: false, actionKind: 'approve' },
    ],
    affectedArtifactIds: ['priya-a1', 'priya-a2'],
    relatedWorkstreamIds: ['ws-auth-redesign'],
    sourceAgentId: 'priya-arch',
    attentionScore: 88,
    requiresRationale: true,
    createdAtTick: 10,
    dueByTick: 13,
    resolved: false,
    resolution: null,
  },
  {
    id: 'priya-d2',
    title: 'Include security flaw details in stakeholder brief?',
    summary: 'The stakeholder update draft includes technical details of the security flaw. The security agent recommends removing specifics until the fix is deployed (responsible disclosure). The writing agent argues stakeholders need to understand the severity to support the timeline change.',
    type: 'risk',
    severity: 'high',
    confidence: 0.60,
    blastRadius: { artifactCount: 1, workstreamCount: 1, agentCount: 2, magnitude: 'small' },
    options: [
      { id: 'priya-d2-o1', label: 'Remove technical details', description: 'Share that a flaw was found and is being fixed, without specifics', consequence: 'Reduces disclosure risk but stakeholders may push back on vague timeline justification', recommended: true, actionKind: 'approve' },
      { id: 'priya-d2-o2', label: 'Keep full details', description: 'Stakeholders see the complete security analysis', consequence: 'Full transparency but increases exposure before the fix ships', recommended: false, actionKind: 'approve' },
      { id: 'priya-d2-o3', label: 'Brief executives privately', description: 'Send detailed brief only to VP Engineering, public brief stays vague', consequence: 'Balanced approach, more work to manage two communications', recommended: false, actionKind: 'approve' },
    ],
    affectedArtifactIds: ['priya-a3'],
    relatedWorkstreamIds: ['ws-stakeholder-update'],
    sourceAgentId: 'priya-security',
    attentionScore: 78,
    requiresRationale: true,
    createdAtTick: 11,
    dueByTick: 12,
    resolved: false,
    resolution: null,
  },
];

const priyaCoherenceIssues: CoherenceIssue[] = [
  {
    id: 'priya-ci1',
    title: 'Auth token format divergence between Team A and Team B',
    description: 'Team A is using JWT with short-lived access tokens while Team B\'s new auth redesign uses opaque tokens with server-side sessions. If both ship, the frontend will need to handle two token types.',
    category: 'architectural_drift',
    severity: 'high',
    status: 'detected',
    workstreamIds: ['ws-auth-redesign'],
    agentIds: ['priya-arch', 'priya-security'],
    artifactIds: ['priya-a1', 'priya-a2'],
    suggestedResolution: 'Align on a single token strategy. The security agent recommends opaque tokens for the auth redesign, with a migration path for Team A.',
    detectedAtTick: 9,
    resolvedAtTick: null,
  },
];

const priyaArtifacts: Artifact[] = [
  { id: 'priya-a1', name: 'auth-redesign-spec.md', kind: 'design', description: 'Architecture specification for the new authentication flow', workstreamId: 'ws-auth-redesign', provenance: { sourceArtifactIds: [], producerAgentId: 'priya-arch', validatorAgentIds: ['priya-security'], humanReviewerId: null, relatedDecisionIds: [], producedAtTick: 6, lastModifiedAtTick: 9 }, qualityScore: 0.85, status: 'in_review' },
  { id: 'priya-a2', name: 'security-audit-report.md', kind: 'research', description: 'Security analysis of current auth system', workstreamId: 'ws-security-audit', provenance: { sourceArtifactIds: [], producerAgentId: 'priya-security', validatorAgentIds: [], humanReviewerId: 'priya-team-lead', relatedDecisionIds: [], producedAtTick: 4, lastModifiedAtTick: 5 }, qualityScore: 0.95, status: 'approved' },
  { id: 'priya-a3', name: 'stakeholder-brief-draft.md', kind: 'document', description: 'Draft stakeholder update about the auth overhaul', workstreamId: 'ws-stakeholder-update', provenance: { sourceArtifactIds: ['priya-a2'], producerAgentId: 'priya-writer', validatorAgentIds: ['priya-security'], humanReviewerId: null, relatedDecisionIds: ['priya-d2'], producedAtTick: 10, lastModifiedAtTick: 11 }, qualityScore: 0.70, status: 'in_review' },
];

const priyaTrustProfiles: TrustProfile[] = [
  { agentId: 'priya-arch', currentScore: 0.87, trend: 'stable', trajectory: [{ tick: 2, score: 0.85, successCount: 2, overrideCount: 0, reworkCount: 0, totalTasks: 2 }, { tick: 8, score: 0.87, successCount: 4, overrideCount: 0, reworkCount: 0, totalTasks: 4 }], scoreByDomain: { design: 0.90, code: 0.82 } },
  { agentId: 'priya-security', currentScore: 0.93, trend: 'increasing', trajectory: [{ tick: 2, score: 0.88, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 5, score: 0.90, successCount: 2, overrideCount: 0, reworkCount: 0, totalTasks: 2 }, { tick: 11, score: 0.93, successCount: 4, overrideCount: 0, reworkCount: 0, totalTasks: 4 }], scoreByDomain: { research: 0.95, code: 0.88 } },
  { agentId: 'priya-impl', currentScore: 0.80, trend: 'stable', trajectory: [{ tick: 7, score: 0.78, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 11, score: 0.80, successCount: 2, overrideCount: 0, reworkCount: 0, totalTasks: 2 }], scoreByDomain: { code: 0.80 } },
  { agentId: 'priya-writer', currentScore: 0.85, trend: 'stable', trajectory: [{ tick: 9, score: 0.83, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 11, score: 0.85, successCount: 2, overrideCount: 0, reworkCount: 1, totalTasks: 3 }], scoreByDomain: { document: 0.85 } },
];

const priyaTimeline: TimelineEvent[] = [
  { id: 'priya-e1', tick: 3, source: 'agent', agentId: 'priya-security', category: 'artifact_produced', severity: 'high', title: 'Security flaw discovered in planned auth approach', description: 'Security agent found a vulnerability in the session management design that was already in the sprint plan.', relatedArtifactIds: ['priya-a2'], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'priya-e2', tick: 5, source: 'human', agentId: null, category: 'decision_resolved', severity: 'high', title: 'Approved auth redesign', description: 'Team B lead made the call to redesign auth based on security analysis. Decision logged with full context.', relatedArtifactIds: ['priya-a2'], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'priya-e3', tick: 9, source: 'system', agentId: null, category: 'coherence_detected', severity: 'high', title: 'Token format divergence between teams', description: 'Team A and Team B using different token strategies that will conflict at the frontend.', relatedArtifactIds: ['priya-a1'], relatedDecisionIds: [], relatedCoherenceIssueIds: ['priya-ci1'] },
  { id: 'priya-e4', tick: 10, source: 'agent', agentId: 'priya-arch', category: 'decision_created', severity: 'high', title: 'Cross-team dependency flagged', description: 'Team A will be blocked by Team C\'s delayed migration in 3 days.', relatedArtifactIds: [], relatedDecisionIds: ['priya-d1'], relatedCoherenceIssueIds: [] },
  { id: 'priya-e5', tick: 11, source: 'agent', agentId: 'priya-security', category: 'decision_created', severity: 'high', title: 'Stakeholder brief disclosure concern', description: 'Security agent recommends removing technical flaw details from stakeholder brief until fix is deployed.', relatedArtifactIds: ['priya-a3'], relatedDecisionIds: ['priya-d2'], relatedCoherenceIssueIds: [] },
];

const priyaDecisionLog: DecisionLogEntry[] = [
  { id: 'priya-dl1', tick: 5, source: 'human', agentId: null, title: 'Approved auth redesign based on security analysis', summary: 'Team B lead redesigned auth flow after security agent found vulnerability. Decision was the right call.', actionKind: 'approve', rationale: 'Security flaw is genuine and significant. Redesign is justified despite timeline impact.', reversible: false, reversed: false, flaggedForReview: false },
];

const priyaState: ProjectState = {
  project: priyaProject,
  decisions: priyaDecisions,
  coherenceIssues: priyaCoherenceIssues,
  artifacts: priyaArtifacts,
  trustProfiles: priyaTrustProfiles,
  timeline: priyaTimeline,
  decisionLog: priyaDecisionLog,
  controlConfig: makeControlConfig('adaptive', {
    topology: [
      { dimension: 'phase', label: 'Execution', currentPosition: 40, recommendedPosition: 30 },
      { dimension: 'risk', label: 'Critical', currentPosition: 15, recommendedPosition: 10 },
      { dimension: 'domain_expertise', label: 'Agent Expert', currentPosition: 70, recommendedPosition: 65 },
      { dimension: 'team_maturity', label: 'Established', currentPosition: 55, recommendedPosition: 50 },
    ],
    riskAwareGating: true,
  }),
  metrics: makeMetrics({
    coherenceScore: 68,
    coherenceTrend: 'declining',
    reworkRisk: 30,
    pendingDecisionCount: 2,
    openCoherenceIssueCount: 1,
    humanInterventionRate: 35,
    highSeverityMissRate: 0,
    averageTrustScore: 0.86,
    totalDecisionCount: 10,
    totalArtifactCount: 3,
    reviewPatterns: [
      { artifactKind: 'code', reviewRate: 100, reworkRate: 5, missRate: 0, suggestedReviewRate: 100, suggestion: 'Critical risk level — maintain full review coverage.' },
      { artifactKind: 'design', reviewRate: 100, reworkRate: 10, missRate: 0, suggestedReviewRate: 100, suggestion: 'Architecture changes in a critical security context warrant full review.' },
    ],
  }),
  briefing: `## Portfolio Update — Team B Auth Overhaul

Team B's authentication redesign is in **execution phase** after the security agent discovered a flaw in the original approach. The security audit is complete (approved by the team lead) and the new architecture spec is in review.

**Two decisions need your attention:**

1. **Cross-team dependency** — Team A's new API endpoint depends on Team C's database migration, which slipped to next sprint. Team A will be blocked in 3 days. You need to decide between expediting Team C, having Team A mock the data, or resequencing work.

2. **Stakeholder brief disclosure** — The draft stakeholder update includes technical details of the security flaw. Security agent recommends removing specifics until the fix ships. Due by tomorrow.

**Coherence alert:** Team A and Team B are diverging on auth token strategy (JWT vs. opaque tokens). This needs cross-team alignment before both implementations ship.`,
  activeScenarioId: 'priya',
  autoSimulate: false,
  viewingTick: null,
  briefingSource: 'template',
};


// ════════════════════════════════════════════════════════════════════
// SCENARIO 4: Rosa — Research Director (Lighter, Map-focused)
// ════════════════════════════════════════════════════════════════════

const rosaProject: Project = {
  id: 'rosa-crispr-review',
  name: 'CRISPR Delivery Mechanisms — Literature Review',
  description: 'Analyzing 50 papers on CRISPR delivery to identify themes, contradictions, gaps, and next research direction.',
  persona: 'Rosa',
  phase: 'exploration',
  controlMode: 'ecosystem',
  riskProfile: { level: 'medium', domainExpertise: 'human_expert', teamMaturity: 'high_trust' },
  agents: [
    { id: 'rosa-lit', name: 'Literature Agent', role: 'Paper analysis and extraction', trustScore: 0.82, active: true },
    { id: 'rosa-synth', name: 'Synthesis Agent', role: 'Cross-paper analysis and pattern detection', trustScore: 0.78, active: true },
    { id: 'rosa-viz', name: 'Visualization Agent', role: 'Knowledge graph construction', trustScore: 0.85, active: true },
  ],
  workstreams: [
    { id: 'ws-viral', name: 'Pathway A: Viral Delivery', description: 'Papers on viral vector approaches', agentIds: ['rosa-lit'], dependsOn: [], status: 'complete' },
    { id: 'ws-lipid', name: 'Pathway B: Lipid Nanoparticle', description: 'Papers on LNP approaches', agentIds: ['rosa-lit'], dependsOn: [], status: 'complete' },
    { id: 'ws-electro', name: 'Pathway C: Electroporation', description: 'Papers on electroporation methods', agentIds: ['rosa-lit'], dependsOn: [], status: 'complete' },
    { id: 'ws-cross', name: 'Cross-Pathway Synthesis', description: 'Finding connections across all three pathways', agentIds: ['rosa-synth', 'rosa-viz'], dependsOn: ['ws-viral', 'ws-lipid', 'ws-electro'], status: 'active' },
  ],
  goals: ['Produce a comprehensive literature review for the quarterly research meeting', 'Identify gaps and contradictions across delivery mechanisms', 'Recommend next research direction'],
  constraints: ['Flag any papers with questionable methodology for human review', 'All claims in the final review must cite specific papers', 'Checkpoint: show categorization and initial findings before synthesis'],
  currentTick: 6,
  emergencyBrakeEngaged: false,
  createdAt: '2026-02-01T09:00:00Z',
};

const rosaDecisions: DecisionItem[] = [
  {
    id: 'rosa-d1',
    title: 'Cross-pathway discovery: viral/LNP combination approach',
    summary: 'The synthesis agent identified a cluster of 4 papers at the intersection of Pathway A (viral) and Pathway B (LNP) that describe hybrid delivery vehicles. Neither pathway team flagged this connection independently. The pattern suggests a potential interaction effect worth investigating.',
    type: 'exploratory',
    severity: 'medium',
    confidence: 0.72,
    blastRadius: { artifactCount: 2, workstreamCount: 2, agentCount: 2, magnitude: 'medium' },
    options: [
      { id: 'rosa-d1-o1', label: 'Create exploration task', description: 'Assign an agent to investigate the viral/LNP intersection', consequence: 'May uncover new research direction. Adds 1-2 days to review timeline.', recommended: true, actionKind: 'approve' },
      { id: 'rosa-d1-o2', label: 'Note for future work', description: 'Add to recommendations section without deep investigation', consequence: 'Saves time, but may miss an important insight', recommended: false, actionKind: 'defer' },
    ],
    affectedArtifactIds: ['rosa-a3', 'rosa-a4'],
    relatedWorkstreamIds: ['ws-viral', 'ws-lipid'],
    sourceAgentId: 'rosa-synth',
    attentionScore: 65,
    requiresRationale: false,
    createdAtTick: 5,
    dueByTick: null,
    resolved: false,
    resolution: null,
  },
  {
    id: 'rosa-d2',
    title: 'Methodology concern: Chen et al. 2025 electroporation study',
    summary: 'The literature agent flagged Chen et al. (2025) for an unusually small sample size (n=8) and lack of controls. However, Rosa should also check — this group is known in the field for using a controversial cell line.',
    type: 'quality',
    severity: 'medium',
    confidence: 0.55,
    blastRadius: { artifactCount: 1, workstreamCount: 1, agentCount: 1, magnitude: 'small' },
    options: [
      { id: 'rosa-d2-o1', label: 'Exclude from synthesis', description: 'Remove this paper from the main findings', consequence: 'Cleaner review but may miss legitimate finding', recommended: false, actionKind: 'approve' },
      { id: 'rosa-d2-o2', label: 'Include with caveat', description: 'Keep the paper but note methodological concerns', consequence: 'Complete picture with appropriate caveats', recommended: true, actionKind: 'approve' },
      { id: 'rosa-d2-o3', label: 'Investigate further', description: 'Have the lit agent look at the group\'s other publications for pattern', consequence: 'More thorough assessment, adds time', recommended: false, actionKind: 'defer' },
    ],
    affectedArtifactIds: ['rosa-a2'],
    relatedWorkstreamIds: ['ws-electro'],
    sourceAgentId: 'rosa-lit',
    attentionScore: 50,
    requiresRationale: true,
    createdAtTick: 4,
    dueByTick: 8,
    resolved: false,
    resolution: null,
  },
];

const rosaCoherenceIssues: CoherenceIssue[] = [];

const rosaArtifacts: Artifact[] = [
  { id: 'rosa-a1', name: 'pathway-a-viral-findings.md', kind: 'research', description: 'Extracted findings from 18 viral delivery papers', workstreamId: 'ws-viral', provenance: { sourceArtifactIds: [], producerAgentId: 'rosa-lit', validatorAgentIds: [], humanReviewerId: 'rosa', relatedDecisionIds: [], producedAtTick: 3, lastModifiedAtTick: 3 }, qualityScore: 0.85, status: 'approved' },
  { id: 'rosa-a2', name: 'pathway-c-electro-findings.md', kind: 'research', description: 'Extracted findings from 12 electroporation papers', workstreamId: 'ws-electro', provenance: { sourceArtifactIds: [], producerAgentId: 'rosa-lit', validatorAgentIds: [], humanReviewerId: null, relatedDecisionIds: ['rosa-d2'], producedAtTick: 3, lastModifiedAtTick: 4 }, qualityScore: 0.75, status: 'in_review' },
  { id: 'rosa-a3', name: 'pathway-b-lnp-findings.md', kind: 'research', description: 'Extracted findings from 20 LNP papers', workstreamId: 'ws-lipid', provenance: { sourceArtifactIds: [], producerAgentId: 'rosa-lit', validatorAgentIds: [], humanReviewerId: 'rosa', relatedDecisionIds: [], producedAtTick: 3, lastModifiedAtTick: 3 }, qualityScore: 0.88, status: 'approved' },
  { id: 'rosa-a4', name: 'cross-pathway-analysis.md', kind: 'research', description: 'Cross-cutting patterns across all three delivery pathways', workstreamId: 'ws-cross', provenance: { sourceArtifactIds: ['rosa-a1', 'rosa-a2', 'rosa-a3'], producerAgentId: 'rosa-synth', validatorAgentIds: [], humanReviewerId: null, relatedDecisionIds: ['rosa-d1'], producedAtTick: 5, lastModifiedAtTick: 6 }, qualityScore: 0.72, status: 'draft' },
  { id: 'rosa-a5', name: 'knowledge-graph.json', kind: 'data', description: 'Knowledge graph data: concepts, findings, and relationships', workstreamId: 'ws-cross', provenance: { sourceArtifactIds: ['rosa-a1', 'rosa-a2', 'rosa-a3'], producerAgentId: 'rosa-viz', validatorAgentIds: [], humanReviewerId: null, relatedDecisionIds: [], producedAtTick: 5, lastModifiedAtTick: 6 }, qualityScore: 0.80, status: 'draft' },
];

const rosaTrustProfiles: TrustProfile[] = [
  { agentId: 'rosa-lit', currentScore: 0.82, trend: 'stable', trajectory: [{ tick: 2, score: 0.80, successCount: 2, overrideCount: 0, reworkCount: 0, totalTasks: 2 }, { tick: 4, score: 0.82, successCount: 4, overrideCount: 0, reworkCount: 1, totalTasks: 5 }], scoreByDomain: { research: 0.82 } },
  { agentId: 'rosa-synth', currentScore: 0.78, trend: 'increasing', trajectory: [{ tick: 4, score: 0.75, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 6, score: 0.78, successCount: 2, overrideCount: 0, reworkCount: 0, totalTasks: 2 }], scoreByDomain: { research: 0.78 } },
  { agentId: 'rosa-viz', currentScore: 0.85, trend: 'stable', trajectory: [{ tick: 5, score: 0.85, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }], scoreByDomain: { data: 0.85 } },
];

const rosaTimeline: TimelineEvent[] = [
  { id: 'rosa-e1', tick: 1, source: 'system', agentId: null, category: 'phase_changed', severity: 'info', title: 'Research project initiated', description: '50 papers loaded across three delivery pathways.', relatedArtifactIds: [], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'rosa-e2', tick: 3, source: 'agent', agentId: 'rosa-lit', category: 'artifact_produced', severity: 'info', title: 'All three pathway analyses complete', description: 'Literature agent processed 50 papers and extracted findings for all three pathways.', relatedArtifactIds: ['rosa-a1', 'rosa-a2', 'rosa-a3'], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'rosa-e3', tick: 4, source: 'agent', agentId: 'rosa-lit', category: 'decision_created', severity: 'medium', title: 'Methodology concern flagged', description: 'Chen et al. (2025) flagged for small sample size and lack of controls.', relatedArtifactIds: ['rosa-a2'], relatedDecisionIds: ['rosa-d2'], relatedCoherenceIssueIds: [] },
  { id: 'rosa-e4', tick: 5, source: 'agent', agentId: 'rosa-synth', category: 'decision_created', severity: 'medium', title: 'Cross-pathway discovery: viral/LNP hybrid', description: 'Synthesis agent found a cluster of papers at the intersection of Pathways A and B.', relatedArtifactIds: ['rosa-a4'], relatedDecisionIds: ['rosa-d1'], relatedCoherenceIssueIds: [] },
  { id: 'rosa-e5', tick: 6, source: 'agent', agentId: 'rosa-viz', category: 'artifact_produced', severity: 'info', title: 'Knowledge graph generated', description: 'Visual knowledge graph built from all pathway findings.', relatedArtifactIds: ['rosa-a5'], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
];

const rosaState: ProjectState = {
  project: rosaProject,
  decisions: rosaDecisions,
  coherenceIssues: rosaCoherenceIssues,
  artifacts: rosaArtifacts,
  trustProfiles: rosaTrustProfiles,
  timeline: rosaTimeline,
  decisionLog: [],
  controlConfig: makeControlConfig('ecosystem', {
    topology: [
      { dimension: 'phase', label: 'Exploration', currentPosition: 80, recommendedPosition: 85 },
      { dimension: 'risk', label: 'Medium', currentPosition: 55, recommendedPosition: 60 },
      { dimension: 'domain_expertise', label: 'Human Expert', currentPosition: 35, recommendedPosition: 40 },
      { dimension: 'team_maturity', label: 'High Trust', currentPosition: 75, recommendedPosition: 80 },
    ],
  }),
  metrics: makeMetrics({
    coherenceScore: 95,
    coherenceTrend: 'stable',
    reworkRisk: 8,
    pendingDecisionCount: 2,
    openCoherenceIssueCount: 0,
    humanInterventionRate: 15,
    highSeverityMissRate: 0,
    averageTrustScore: 0.82,
    totalDecisionCount: 4,
    totalArtifactCount: 5,
    reviewPatterns: [
      { artifactKind: 'research', reviewRate: 66, reworkRate: 10, missRate: 5, suggestedReviewRate: 50, suggestion: 'Research outputs are reasonably accurate. Consider spot-checking rather than full review for well-established agents.' },
    ],
  }),
  briefing: `## Research Update — CRISPR Literature Review

All three pathway analyses are **complete**. The literature agent processed 50 papers and extracted findings across viral delivery (18 papers), lipid nanoparticle (20 papers), and electroporation (12 papers).

**Discovery:** The synthesis agent found a potentially significant pattern — a cluster of 4 recent papers at the intersection of Pathways A (viral) and B (LNP) describing hybrid delivery vehicles. Neither pathway team flagged this independently. Worth investigating?

**Review needed:** The literature agent flagged Chen et al. (2025) for methodological concerns (small sample size, no controls). You may also want to check their cell line choice — this group has been controversial.

The knowledge graph is now generated and available in the Map workspace for exploration.`,
  activeScenarioId: 'rosa',
  autoSimulate: false,
  viewingTick: null,
  briefingSource: 'template',
};


// ════════════════════════════════════════════════════════════════════
// SCENARIO 5: Sam — Independent Consultant (Lighter, Brief Editor-focused)
// ════════════════════════════════════════════════════════════════════

const samProject: Project = {
  id: 'sam-client-d-pipeline',
  name: 'Client D — Data Pipeline Modernization',
  description: 'Modernizing a streaming data pipeline for Client D. Using patterns learned from previous client engagements.',
  persona: 'Sam',
  phase: 'execution',
  controlMode: 'adaptive',
  riskProfile: { level: 'high', domainExpertise: 'shared', teamMaturity: 'first_project' },
  agents: [
    { id: 'sam-arch', name: 'Architecture Agent', role: 'System design for data pipelines', trustScore: 0.75, active: true },
    { id: 'sam-impl', name: 'Implementation Agent', role: 'Pipeline code implementation', trustScore: 0.70, active: true },
    { id: 'sam-doc', name: 'Documentation Agent', role: 'Technical documentation and handoff materials', trustScore: 0.80, active: true },
  ],
  workstreams: [
    { id: 'ws-assessment', name: 'Current State Assessment', description: 'Audit existing pipeline architecture', agentIds: ['sam-arch'], dependsOn: [], status: 'complete' },
    { id: 'ws-design', name: 'Pipeline Redesign', description: 'Design new streaming architecture', agentIds: ['sam-arch', 'sam-impl'], dependsOn: ['ws-assessment'], status: 'active' },
    { id: 'ws-handoff', name: 'Handoff Package', description: 'Client knowledge transfer documentation', agentIds: ['sam-doc'], dependsOn: [], status: 'active' },
  ],
  goals: ['Modernize streaming pipeline to handle 10x current throughput', 'Implement backpressure handling (from shared pattern library)', 'Produce client handoff package'],
  constraints: ['Client D data must never be accessible to agents working on other clients', 'All architecture decisions must be documented in ADRs', 'Use client\'s existing Kafka infrastructure — no new message brokers', 'Handoff package must include: all decisions with rationale, current state, open questions, next steps'],
  currentTick: 5,
  emergencyBrakeEngaged: false,
  createdAt: '2026-02-03T09:00:00Z',
};

const samDecisions: DecisionItem[] = [
  {
    id: 'sam-d1',
    title: 'Apply backpressure retry pattern from shared library?',
    summary: 'The implementation agent recognized that Client D\'s pipeline needs the same backpressure-aware retry pattern that was extracted from Client B\'s project. The pattern is in the shared library (approved, abstracted, no client-specific details). Should we apply it?',
    type: 'architectural',
    severity: 'medium',
    confidence: 0.88,
    blastRadius: { artifactCount: 2, workstreamCount: 1, agentCount: 1, magnitude: 'medium' },
    options: [
      { id: 'sam-d1-o1', label: 'Apply the pattern', description: 'Use the shared backpressure retry pattern', consequence: 'Proven approach, saves design time, already validated', recommended: true, actionKind: 'approve' },
      { id: 'sam-d1-o2', label: 'Design custom solution', description: 'Build a pipeline-specific backpressure mechanism', consequence: 'More tailored but unproven, adds design time', recommended: false, actionKind: 'reject' },
    ],
    affectedArtifactIds: ['sam-a2'],
    relatedWorkstreamIds: ['ws-design'],
    sourceAgentId: 'sam-impl',
    attentionScore: 60,
    requiresRationale: false,
    createdAtTick: 4,
    dueByTick: 7,
    resolved: false,
    resolution: null,
  },
  {
    id: 'sam-d2',
    title: 'Add routing rule: escalate all Kafka config changes',
    summary: 'The architecture agent suggests adding a routing rule: any changes to Kafka configuration should be escalated to human review, given this is a first-project trust level with the client\'s infrastructure.',
    type: 'risk',
    severity: 'medium',
    confidence: 0.85,
    blastRadius: { artifactCount: 0, workstreamCount: 2, agentCount: 2, magnitude: 'small' },
    options: [
      { id: 'sam-d2-o1', label: 'Add the routing rule', description: 'Require human review for all Kafka config changes', consequence: 'Adds a review gate but protects client infrastructure', recommended: true, actionKind: 'approve' },
      { id: 'sam-d2-o2', label: 'Trust the agent', description: 'Allow agent to make Kafka config changes autonomously', consequence: 'Faster execution but risk to client infrastructure', recommended: false, actionKind: 'reject' },
    ],
    affectedArtifactIds: [],
    relatedWorkstreamIds: ['ws-design', 'ws-assessment'],
    sourceAgentId: 'sam-arch',
    attentionScore: 55,
    requiresRationale: false,
    createdAtTick: 3,
    dueByTick: 6,
    resolved: false,
    resolution: null,
  },
];

const samCoherenceIssues: CoherenceIssue[] = [];

const samArtifacts: Artifact[] = [
  { id: 'sam-a1', name: 'current-state-assessment.md', kind: 'document', description: 'Audit of Client D\'s existing pipeline architecture', workstreamId: 'ws-assessment', provenance: { sourceArtifactIds: [], producerAgentId: 'sam-arch', validatorAgentIds: [], humanReviewerId: 'sam', relatedDecisionIds: [], producedAtTick: 2, lastModifiedAtTick: 3 }, qualityScore: 0.85, status: 'approved' },
  { id: 'sam-a2', name: 'pipeline-redesign-spec.md', kind: 'design', description: 'Architecture specification for the modernized pipeline', workstreamId: 'ws-design', provenance: { sourceArtifactIds: ['sam-a1'], producerAgentId: 'sam-arch', validatorAgentIds: [], humanReviewerId: null, relatedDecisionIds: ['sam-d1'], producedAtTick: 4, lastModifiedAtTick: 5 }, qualityScore: 0.75, status: 'in_review' },
  { id: 'sam-a3', name: 'handoff-decisions-log.md', kind: 'decision_record', description: 'Running log of all project decisions for client handoff', workstreamId: 'ws-handoff', provenance: { sourceArtifactIds: [], producerAgentId: 'sam-doc', validatorAgentIds: [], humanReviewerId: null, relatedDecisionIds: [], producedAtTick: 3, lastModifiedAtTick: 5 }, qualityScore: 0.80, status: 'draft' },
];

const samTrustProfiles: TrustProfile[] = [
  { agentId: 'sam-arch', currentScore: 0.75, trend: 'increasing', trajectory: [{ tick: 2, score: 0.70, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 5, score: 0.75, successCount: 2, overrideCount: 0, reworkCount: 0, totalTasks: 2 }], scoreByDomain: { design: 0.78, document: 0.70 } },
  { agentId: 'sam-impl', currentScore: 0.70, trend: 'stable', trajectory: [{ tick: 4, score: 0.70, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }], scoreByDomain: { code: 0.70 } },
  { agentId: 'sam-doc', currentScore: 0.80, trend: 'stable', trajectory: [{ tick: 3, score: 0.78, successCount: 1, overrideCount: 0, reworkCount: 0, totalTasks: 1 }, { tick: 5, score: 0.80, successCount: 2, overrideCount: 0, reworkCount: 0, totalTasks: 2 }], scoreByDomain: { document: 0.82, decision_record: 0.78 } },
];

const samTimeline: TimelineEvent[] = [
  { id: 'sam-e1', tick: 1, source: 'system', agentId: null, category: 'phase_changed', severity: 'info', title: 'Client D project started', description: 'Project initialized with client isolation enforced at system level.', relatedArtifactIds: [], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'sam-e2', tick: 3, source: 'agent', agentId: 'sam-arch', category: 'artifact_produced', severity: 'info', title: 'Current state assessment complete', description: 'Architecture agent audited the existing pipeline.', relatedArtifactIds: ['sam-a1'], relatedDecisionIds: [], relatedCoherenceIssueIds: [] },
  { id: 'sam-e3', tick: 3, source: 'agent', agentId: 'sam-arch', category: 'decision_created', severity: 'medium', title: 'Kafka config routing rule suggested', description: 'Agent recommends adding a review gate for Kafka configuration changes.', relatedArtifactIds: [], relatedDecisionIds: ['sam-d2'], relatedCoherenceIssueIds: [] },
  { id: 'sam-e4', tick: 4, source: 'agent', agentId: 'sam-impl', category: 'decision_created', severity: 'medium', title: 'Shared pattern match: backpressure retry', description: 'Implementation agent recognized a pattern from the shared library.', relatedArtifactIds: ['sam-a2'], relatedDecisionIds: ['sam-d1'], relatedCoherenceIssueIds: [] },
];

const samState: ProjectState = {
  project: samProject,
  decisions: samDecisions,
  coherenceIssues: samCoherenceIssues,
  artifacts: samArtifacts,
  trustProfiles: samTrustProfiles,
  timeline: samTimeline,
  decisionLog: [],
  controlConfig: makeControlConfig('adaptive', {
    topology: [
      { dimension: 'phase', label: 'Execution', currentPosition: 45, recommendedPosition: 40 },
      { dimension: 'risk', label: 'High', currentPosition: 30, recommendedPosition: 25 },
      { dimension: 'domain_expertise', label: 'Shared', currentPosition: 50, recommendedPosition: 45 },
      { dimension: 'team_maturity', label: 'First Project', currentPosition: 25, recommendedPosition: 20 },
    ],
  }),
  metrics: makeMetrics({
    coherenceScore: 92,
    coherenceTrend: 'stable',
    reworkRisk: 10,
    pendingDecisionCount: 2,
    openCoherenceIssueCount: 0,
    humanInterventionRate: 40,
    highSeverityMissRate: 0,
    averageTrustScore: 0.75,
    totalDecisionCount: 4,
    totalArtifactCount: 3,
    reviewPatterns: [
      { artifactKind: 'design', reviewRate: 100, reworkRate: 0, missRate: 0, suggestedReviewRate: 100, suggestion: 'First project with these agents — maintain full review until trust is established.' },
      { artifactKind: 'document', reviewRate: 100, reworkRate: 0, missRate: 0, suggestedReviewRate: 80, suggestion: 'Documentation quality is good. You could start reducing review frequency.' },
    ],
  }),
  briefing: `## Client D — Pipeline Modernization

Assessment phase is **complete**. The architecture agent has audited the existing pipeline and identified key bottlenecks. The redesign spec is in progress.

**Two decisions awaiting:**

1. The implementation agent recognized that Client D's pipeline needs the same **backpressure retry pattern** that was successfully used in a previous engagement. The pattern is in your shared library (abstracted, no client data). Approve to save design time?

2. The architecture agent suggests adding a **routing rule** requiring human review for all Kafka configuration changes. This is a first-project trust level — the extra review gate protects client infrastructure.

**Note:** Client isolation is active. No data or context from other client projects is accessible to agents working on this engagement.`,
  activeScenarioId: 'sam',
  autoSimulate: false,
  viewingTick: null,
  briefingSource: 'template',
};


// ─── Export all scenarios ──────────────────────────────────────────

export const scenarios: Scenario[] = [
  { id: 'maya', label: 'Maya — Content Studio', description: 'Solo creator managing four blog posts with ecosystem-mode agents.', state: mayaState },
  { id: 'david', label: 'David — SaaS Team', description: 'Team lead building a notification system with orchestrator-mode review.', state: davidState },
  { id: 'priya', label: 'Priya — Portfolio PM', description: 'Product manager coordinating three teams through an auth security overhaul.', state: priyaState },
  { id: 'rosa', label: 'Rosa — Research Lab', description: 'Research director analyzing CRISPR papers with knowledge graph exploration.', state: rosaState },
  { id: 'sam', label: 'Sam — Consultant', description: 'Independent consultant with client isolation and shared pattern library.', state: samState },
];

export function getScenarioById(id: string): Scenario | undefined {
  return scenarios.find(s => s.id === id);
}

export function getDefaultScenario(): Scenario {
  return scenarios[0];
}
