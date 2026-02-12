import { z, type ZodError } from 'zod'

import type { AdapterEvent } from '../types'

export const severitySchema = z.enum(['warning', 'low', 'medium', 'high', 'critical'])
export const blastRadiusSchema = z.enum(['trivial', 'small', 'medium', 'large', 'unknown'])
export const controlModeSchema = z.enum(['orchestrator', 'adaptive', 'ecosystem'])
export const artifactKindSchema = z.enum(['code', 'document', 'design', 'config', 'test', 'other'])
export const coherenceCategorySchema = z.enum(['contradiction', 'duplication', 'gap', 'dependency_violation'])
export const actionKindSchema = z.enum(['create', 'update', 'delete', 'review', 'deploy'])

export const decisionOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  tradeoffs: z.string().optional()
})

export const provenanceSchema = z.object({
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  modifiedBy: z.string().optional(),
  modifiedAt: z.string().datetime().optional(),
  sourceArtifactIds: z.array(z.string()).optional(),
  sourcePath: z.string().optional()
})

export const statusEventSchema = z.object({
  type: z.literal('status'),
  agentId: z.string(),
  message: z.string(),
  tick: z.number().int().optional()
})

export const optionDecisionEventSchema = z.object({
  type: z.literal('decision'),
  subtype: z.literal('option'),
  agentId: z.string(),
  decisionId: z.string(),
  title: z.string(),
  summary: z.string(),
  severity: severitySchema,
  confidence: z.number().min(0).max(1),
  blastRadius: blastRadiusSchema,
  options: z.array(decisionOptionSchema),
  recommendedOptionId: z.string().optional(),
  affectedArtifactIds: z.array(z.string()),
  requiresRationale: z.boolean(),
  dueByTick: z.number().int().nullable().optional()
})

export const toolApprovalEventSchema = z.object({
  type: z.literal('decision'),
  subtype: z.literal('tool_approval'),
  agentId: z.string(),
  decisionId: z.string(),
  toolName: z.string(),
  toolArgs: z.record(z.string(), z.unknown()),
  severity: severitySchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  blastRadius: blastRadiusSchema.optional(),
  affectedArtifactIds: z.array(z.string()).optional(),
  dueByTick: z.number().int().nullable().optional()
})

export const artifactEventSchema = z.object({
  type: z.literal('artifact'),
  agentId: z.string(),
  artifactId: z.string(),
  name: z.string(),
  kind: artifactKindSchema,
  workstream: z.string(),
  status: z.enum(['draft', 'in_review', 'approved', 'rejected']),
  qualityScore: z.number(),
  provenance: provenanceSchema,
  uri: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().optional(),
  contentHash: z.string().optional()
})

export const coherenceEventSchema = z.object({
  type: z.literal('coherence'),
  agentId: z.string(),
  issueId: z.string(),
  title: z.string(),
  description: z.string(),
  category: coherenceCategorySchema,
  severity: severitySchema,
  affectedWorkstreams: z.array(z.string()),
  affectedArtifactIds: z.array(z.string())
})

export const toolCallEventSchema = z.object({
  type: z.literal('tool_call'),
  agentId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  phase: z.enum(['requested', 'running', 'completed', 'failed']),
  input: z.record(z.string(), z.unknown()),
  output: z.unknown().optional(),
  approved: z.boolean(),
  durationMs: z.number().int().optional()
})

export const completionEventSchema = z.object({
  type: z.literal('completion'),
  agentId: z.string(),
  summary: z.string(),
  artifactsProduced: z.array(z.string()),
  decisionsNeeded: z.array(z.string()),
  outcome: z.enum(['success', 'partial', 'abandoned', 'max_turns']),
  reason: z.string().optional()
})

export const errorEventSchema = z.object({
  type: z.literal('error'),
  agentId: z.string(),
  severity: severitySchema,
  message: z.string(),
  recoverable: z.boolean(),
  errorCode: z.string().optional(),
  category: z.enum(['provider', 'tool', 'model', 'timeout', 'internal']),
  context: z
    .object({
      toolName: z.string().optional(),
      lastAction: z.string().optional()
    })
    .optional()
})

export const delegationEventSchema = z.object({
  type: z.literal('delegation'),
  agentId: z.string(),
  action: z.enum(['spawned', 'handoff', 'returned']),
  childAgentId: z.string(),
  childRole: z.string(),
  reason: z.string(),
  delegationDepth: z.number().int(),
  rootAgentId: z.string()
})

export const guardrailEventSchema = z.object({
  type: z.literal('guardrail'),
  agentId: z.string(),
  guardrailName: z.string(),
  level: z.enum(['input', 'output', 'tool']),
  tripped: z.boolean(),
  message: z.string()
})

export const lifecycleEventSchema = z.object({
  type: z.literal('lifecycle'),
  agentId: z.string(),
  action: z.enum(['started', 'paused', 'resumed', 'killed', 'crashed', 'session_start', 'session_end']),
  reason: z.string().optional()
})

export const progressEventSchema = z.object({
  type: z.literal('progress'),
  agentId: z.string(),
  operationId: z.string(),
  description: z.string(),
  progressPct: z.number().min(0).max(100).nullable()
})

export const rawProviderEventSchema = z.object({
  type: z.literal('raw_provider'),
  agentId: z.string(),
  providerName: z.string(),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown())
})

export const agentEventSchema = z.union([
  statusEventSchema,
  optionDecisionEventSchema,
  toolApprovalEventSchema,
  artifactEventSchema,
  coherenceEventSchema,
  toolCallEventSchema,
  completionEventSchema,
  errorEventSchema,
  delegationEventSchema,
  guardrailEventSchema,
  lifecycleEventSchema,
  progressEventSchema,
  rawProviderEventSchema
])

export const adapterEventSchema = z.object({
  sourceEventId: z.string().min(1),
  sourceSequence: z.number().int().nonnegative(),
  sourceOccurredAt: z.string().datetime(),
  runId: z.string().min(1),
  event: agentEventSchema
})

export const eventEnvelopeSchema = adapterEventSchema.extend({
  ingestedAt: z.string().datetime()
})

const jsonSchemaSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.unknown()),
      z.record(z.string(), z.unknown())
    ])
  )
)

const secretRefSchema = z.object({
  name: z.string(),
  vaultKey: z.string(),
  scope: z.enum(['agent', 'project'])
})

const guardrailSpecSchema = z.object({
  name: z.string(),
  description: z.string(),
  action: z.enum(['block', 'warn', 'log'])
})

const escalationPredicateSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ field: z.literal('confidence'), op: z.enum(['lt', 'gt', 'lte', 'gte']), value: z.number() }),
    z.object({ field: z.literal('blastRadius'), op: z.enum(['eq', 'gte']), value: blastRadiusSchema }),
    z.object({ field: z.literal('trustScore'), op: z.enum(['lt', 'gt', 'lte', 'gte']), value: z.number() }),
    z.object({ field: z.literal('affectsMultipleWorkstreams'), op: z.literal('eq'), value: z.boolean() }),
    z.object({ type: z.literal('and'), rules: z.array(escalationPredicateSchema) }),
    z.object({ type: z.literal('or'), rules: z.array(escalationPredicateSchema) })
  ])
)

const contextReactiveTriggerSchema = z.union([
  z.object({ on: z.literal('artifact_approved'), workstreams: z.enum(['own', 'readable', 'all']) }),
  z.object({ on: z.literal('decision_resolved'), workstreams: z.enum(['own', 'readable', 'all']) }),
  z.object({ on: z.literal('coherence_issue'), severity: severitySchema }),
  z.object({ on: z.literal('agent_completed'), workstreams: z.literal('readable') }),
  z.object({ on: z.literal('brief_updated') })
])

export const knowledgeSnapshotSchema = z.object({
  version: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  workstreams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      activeAgentIds: z.array(z.string()),
      artifactCount: z.number().int().nonnegative(),
      pendingDecisionCount: z.number().int().nonnegative(),
      recentActivity: z.string()
    })
  ),
  pendingDecisions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      severity: severitySchema,
      agentId: z.string(),
      subtype: z.enum(['option', 'tool_approval']),
      options: z.array(decisionOptionSchema).optional(),
      recommendedOptionId: z.string().optional(),
      confidence: z.number().optional(),
      blastRadius: blastRadiusSchema.optional(),
      affectedArtifactIds: z.array(z.string()).optional(),
      requiresRationale: z.boolean().optional(),
      summary: z.string().optional(),
      dueByTick: z.number().nullable().optional(),
      toolName: z.string().optional(),
    })
  ),
  recentCoherenceIssues: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      severity: severitySchema,
      category: coherenceCategorySchema,
      affectedWorkstreams: z.array(z.string())
    })
  ),
  artifactIndex: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: artifactKindSchema,
      status: z.enum(['draft', 'in_review', 'approved', 'rejected']),
      workstream: z.string()
    })
  ),
  activeAgents: z.array(
    z.object({
      id: z.string(),
      role: z.string(),
      workstream: z.string(),
      status: z.enum(['running', 'paused', 'waiting_on_human', 'completed', 'error']),
      pluginName: z.string(),
      modelPreference: z.string().optional()
    })
  ),
  estimatedTokens: z.number().int().nonnegative()
})

const agentBriefSchema = z.object({
  agentId: z.string(),
  role: z.string(),
  description: z.string(),
  workstream: z.string(),
  readableWorkstreams: z.array(z.string()),
  constraints: z.array(z.string()),
  escalationProtocol: z.object({
    alwaysEscalate: z.array(z.string()),
    escalateWhen: z.array(z.object({ predicate: escalationPredicateSchema, description: z.string() })),
    neverEscalate: z.array(z.string())
  }),
  controlMode: controlModeSchema,
  projectBrief: z.object({
    id: z.string().optional(),
    title: z.string(),
    description: z.string(),
    goals: z.array(z.string()),
    checkpoints: z.array(z.string()),
    constraints: z.array(z.string()).optional()
  }),
  knowledgeSnapshot: knowledgeSnapshotSchema,
  modelPreference: z.string().optional(),
  allowedTools: z.array(z.string()),
  mcpServers: z
    .array(
      z.object({
        name: z.string(),
        transport: z.string().optional(),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        config: z.record(z.string(), z.unknown()).optional()
      })
    )
    .optional(),
  workspaceRequirements: z
    .object({
      mounts: z.array(z.object({ hostPath: z.string(), sandboxPath: z.string(), readOnly: z.boolean() })),
      capabilities: z.array(
        z.enum(['terminal', 'browser', 'git', 'docker', 'network_external', 'network_internal_only', 'gpu'])
      ),
      resourceLimits: z
        .object({
          cpuCores: z.number().positive().optional(),
          memoryMb: z.number().positive().optional(),
          diskMb: z.number().positive().optional(),
          timeoutMs: z.number().positive().optional()
        })
        .optional(),
      baseImage: z.string().optional()
    })
    .optional(),
  outputSchema: jsonSchemaSchema.optional(),
  guardrailPolicy: z
    .object({
      inputGuardrails: z.array(guardrailSpecSchema),
      outputGuardrails: z.array(guardrailSpecSchema),
      toolGuardrails: z.array(guardrailSpecSchema)
    })
    .optional(),
  delegationPolicy: z
    .object({
      canSpawnSubagents: z.boolean(),
      allowedHandoffs: z.array(z.string()),
      maxDepth: z.number().int().nonnegative()
    })
    .optional(),
  sessionPolicy: z
    .object({
      maxTurns: z.number().int().positive().optional(),
      contextBudgetTokens: z.number().int().positive().optional(),
      historyPolicy: z.enum(['full', 'summarized', 'recent_n']),
      historyN: z.number().int().positive().optional()
    })
    .optional(),
  contextInjectionPolicy: z
    .object({
      periodicIntervalTicks: z.number().int().positive().nullable(),
      reactiveEvents: z.array(contextReactiveTriggerSchema),
      stalenessThreshold: z.number().int().positive().nullable(),
      maxInjectionsPerHour: z.number().int().positive(),
      cooldownTicks: z.number().int().nonnegative()
    })
    .optional(),
  secretRefs: z.array(secretRefSchema).optional(),
  providerConfig: z.record(z.string(), z.unknown()).optional()
})

const brakeScopeSchema = z.union([
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('agent'), agentId: z.string() }),
  z.object({ type: z.literal('workstream'), workstream: z.string() })
])

const brakeReleaseConditionSchema = z.union([
  z.object({ type: z.literal('manual') }),
  z.object({ type: z.literal('timer'), releaseAfterMs: z.number().int().positive() }),
  z.object({ type: z.literal('decision'), decisionId: z.string() })
])

export const brakeActionSchema = z.object({
  scope: brakeScopeSchema,
  reason: z.string().min(1),
  behavior: z.enum(['pause', 'kill']),
  initiatedBy: z.string().min(1),
  timestamp: z.string().datetime(),
  releaseCondition: brakeReleaseConditionSchema.optional()
})

export const optionResolutionSchema = z.object({
  type: z.literal('option'),
  chosenOptionId: z.string().min(1),
  rationale: z.string(),
  actionKind: actionKindSchema
})

export const toolApprovalResolutionSchema = z.object({
  type: z.literal('tool_approval'),
  action: z.enum(['approve', 'reject', 'modify']),
  modifiedArgs: z.record(z.string(), z.unknown()).optional(),
  alwaysApprove: z.boolean().optional(),
  rationale: z.string().optional(),
  actionKind: actionKindSchema
})

export const resolutionSchema = z.union([optionResolutionSchema, toolApprovalResolutionSchema])

export const spawnAgentRequestSchema = z.object({
  brief: agentBriefSchema
})

export const killAgentRequestSchema = z.object({
  grace: z.boolean(),
  graceTimeoutMs: z.number().int().positive().optional()
})

export const pauseAgentRequestSchema = z.object({}).optional()
export const resumeAgentRequestSchema = z.object({}).optional()

export const updateAgentBriefRequestSchema = agentBriefSchema.partial()

export const resolveDecisionRequestSchema = z.object({
  resolution: resolutionSchema,
  agentId: z.string().optional()
})

export const setControlModeRequestSchema = z.object({
  controlMode: controlModeSchema
})

export const tickAdvanceRequestSchema = z.object({
  steps: z.number().int().positive().optional().default(1)
})

const sdkCheckpointSchema = z.union([
  z.object({ sdk: z.literal('openai'), runStateJson: z.string() }),
  z.object({ sdk: z.literal('claude'), sessionId: z.string(), lastMessageId: z.string().optional() }),
  z.object({ sdk: z.literal('gemini'), sessionId: z.string(), stateSnapshot: z.record(z.string(), z.unknown()).optional() }),
  z.object({ sdk: z.literal('mock'), scriptPosition: z.number().int() })
])

export const submitCheckpointRequestSchema = z.object({
  agentId: z.string().min(1),
  pluginName: z.string().min(1),
  sessionId: z.string().min(1),
  checkpoint: sdkCheckpointSchema,
  briefSnapshot: agentBriefSchema,
  conversationSummary: z.string().optional(),
  pendingDecisionIds: z.array(z.string()),
  lastSequence: z.number().int().nonnegative(),
  serializedAt: z.string().datetime(),
  serializedBy: z.enum(['pause', 'kill_grace', 'crash_recovery', 'decision_checkpoint']),
  estimatedSizeBytes: z.number().int().nonnegative(),
  decisionId: z.string().optional()
})

/**
 * Validates an unknown payload as an AdapterEvent.
 */
export function validateAdapterEvent(
  raw: unknown
): { ok: true; event: AdapterEvent } | { ok: false; error: ZodError; raw: unknown } {
  const parsed = adapterEventSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error, raw }
  }

  return { ok: true, event: parsed.data as AdapterEvent }
}
