import Database from 'better-sqlite3'
import type {
  KnowledgeSnapshot,
  WorkstreamSummary,
  DecisionSummary,
  CoherenceIssueSummary,
  ArtifactSummary,
  AgentSummary
} from '../types/brief'
import type {
  ArtifactEvent,
  CoherenceEvent,
  EventEnvelope,
  AgentEvent,
  DecisionEvent,
  OptionDecisionEvent,
  ToolApprovalEvent
} from '../types/events'
import type { AgentHandle, SerializedAgentState } from '../types/plugin'
import type { ProjectConfig } from '../types/project-config'
import type { StoredCheckpoint } from '../types/service-interfaces'

/** Thrown when an optimistic concurrency check fails. */
export class ConflictError extends Error {
  constructor(entity: string, id: string, expected: number, actual: number) {
    super(`Conflict on ${entity} "${id}": expected version ${expected}, found ${actual}`)
    this.name = 'ConflictError'
  }
}

/** Filter criteria for querying persisted events. */
export interface EventFilter {
  agentId?: string
  runId?: string
  types?: AgentEvent['type'][]
  since?: string
  limit?: number
}

/**
 * SQLite-backed KnowledgeStore. Persists artifacts, agents, coherence issues,
 * trust profiles, workstreams, and an event log. Uses WAL mode for concurrent
 * reads. Supports optimistic concurrency control on artifacts and decisions.
 *
 * For tests, pass ':memory:' as dbPath. For production, pass a file path.
 */
export class KnowledgeStore {
  private readonly db: Database.Database
  private version = 0

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.initSchema()
    this.loadVersion()
  }

  /** Close the database connection. */
  close(): void {
    this.db.close()
  }

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        workstream TEXT NOT NULL,
        status TEXT NOT NULL,
        quality_score REAL NOT NULL,
        provenance_json TEXT NOT NULL,
        uri TEXT,
        mime_type TEXT,
        size_bytes INTEGER,
        content_hash TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_workstream ON artifacts(workstream);
      CREATE INDEX IF NOT EXISTS idx_artifacts_agent ON artifacts(agent_id);

      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        plugin_name TEXT NOT NULL,
        status TEXT NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        workstream TEXT NOT NULL,
        model_preference TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_agents_workstream ON agents(workstream);

      CREATE TABLE IF NOT EXISTS coherence_issues (
        issue_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        affected_workstreams_json TEXT NOT NULL,
        affected_artifact_ids_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        resolution TEXT,
        resolved_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_coherence_status ON coherence_issues(status);

      CREATE TABLE IF NOT EXISTS trust_profiles (
        agent_id TEXT PRIMARY KEY,
        score REAL NOT NULL DEFAULT 50,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS workstreams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        recent_activity TEXT NOT NULL DEFAULT 'Initialized'
      );

      CREATE TABLE IF NOT EXISTS events (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        source_event_id TEXT NOT NULL,
        source_sequence INTEGER NOT NULL,
        source_occurred_at TEXT NOT NULL,
        run_id TEXT NOT NULL,
        ingested_at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_ingested ON events(ingested_at);

      CREATE TABLE IF NOT EXISTS checkpoints (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        serialized_by TEXT NOT NULL,
        decision_id TEXT,
        state_json TEXT NOT NULL,
        estimated_size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_agent ON checkpoints(agent_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_agent_created ON checkpoints(agent_id, created_at);

      CREATE TABLE IF NOT EXISTS artifact_content (
        agent_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        content TEXT NOT NULL,
        mime_type TEXT,
        backend_uri TEXT NOT NULL,
        uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (agent_id, artifact_id)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        caller_agent_id TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        details_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

      CREATE TABLE IF NOT EXISTS project_config (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)

    // Seed version if not present
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('version') as { value: string } | undefined
    if (!row) {
      this.db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('version', '0')
    }
  }

  private loadVersion(): void {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('version') as { value: string } | undefined
    this.version = row ? parseInt(row.value, 10) : 0
  }

  private bumpVersion(): void {
    this.version += 1
    this.db.prepare('UPDATE metadata SET value = ? WHERE key = ?').run(String(this.version), 'version')
  }

  private recordAudit(entityType: string, entityId: string, action: string, callerAgentId?: string, details?: unknown): void {
    this.db.prepare(
      'INSERT INTO audit_log (entity_type, entity_id, action, caller_agent_id, details_json) VALUES (?, ?, ?, ?, ?)'
    ).run(entityType, entityId, action, callerAgentId ?? null, details ? JSON.stringify(details) : null)
  }

  /** Append a custom audit log entry. */
  appendAuditLog(entityType: string, entityId: string, action: string, callerAgentId?: string, details?: unknown): void {
    this.recordAudit(entityType, entityId, action, callerAgentId, details)
  }

  /** Retrieve audit log entries for diagnostics/tests. */
  listAuditLog(entityType?: string, entityId?: string): Array<{
    entityType: string
    entityId: string
    action: string
    callerAgentId?: string
    timestamp: string
    details?: unknown
  }> {
    const conditions: string[] = []
    const params: string[] = []

    if (entityType) {
      conditions.push('entity_type = ?')
      params.push(entityType)
    }
    if (entityId) {
      conditions.push('entity_id = ?')
      params.push(entityId)
    }

    let sql = 'SELECT * FROM audit_log'
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }
    sql += ' ORDER BY rowid ASC'

    const rows = this.db.prepare(sql).all(...params) as AuditRow[]
    return rows.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      callerAgentId: row.caller_agent_id ?? undefined,
      timestamp: row.timestamp,
      details: row.details_json ? JSON.parse(row.details_json) : undefined,
    }))
  }

  // ---------------------------------------------------------------------------
  // Artifacts (with optimistic concurrency)
  // ---------------------------------------------------------------------------

  /** Store or update an artifact from an ArtifactEvent. Caller-compatible with Phase 1. */
  storeArtifact(event: ArtifactEvent): void {
    this.upsertArtifactInternal(event)
  }

  /**
   * Upsert an artifact with optimistic concurrency control.
   * If expectedVersion is provided and doesn't match, throws ConflictError.
   */
  upsertArtifact(event: ArtifactEvent, expectedVersion: number, callerAgentId: string): void {
    const existing = this.db.prepare('SELECT version FROM artifacts WHERE artifact_id = ?').get(event.artifactId) as { version: number } | undefined

    if (existing && existing.version !== expectedVersion) {
      throw new ConflictError('artifact', event.artifactId, expectedVersion, existing.version)
    }

    if (!existing && expectedVersion !== 0) {
      throw new ConflictError('artifact', event.artifactId, expectedVersion, 0)
    }

    this.upsertArtifactInternal(event, callerAgentId)
  }

  private upsertArtifactInternal(event: ArtifactEvent, callerAgentId?: string): void {
    const existing = this.db.prepare('SELECT version FROM artifacts WHERE artifact_id = ?').get(event.artifactId) as { version: number } | undefined
    const newVersion = (existing?.version ?? 0) + 1

    this.db.prepare(`
      INSERT INTO artifacts (artifact_id, agent_id, name, kind, workstream, status, quality_score, provenance_json, uri, mime_type, size_bytes, content_hash, version, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(artifact_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        name = excluded.name,
        kind = excluded.kind,
        workstream = excluded.workstream,
        status = excluded.status,
        quality_score = excluded.quality_score,
        provenance_json = excluded.provenance_json,
        uri = excluded.uri,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        content_hash = excluded.content_hash,
        version = excluded.version,
        updated_by = excluded.updated_by,
        updated_at = datetime('now')
    `).run(
      event.artifactId,
      event.agentId,
      event.name,
      event.kind,
      event.workstream,
      event.status,
      event.qualityScore,
      JSON.stringify(event.provenance),
      event.uri ?? null,
      event.mimeType ?? null,
      event.sizeBytes ?? null,
      event.contentHash ?? null,
      newVersion,
      callerAgentId ?? event.agentId
    )

    this.bumpVersion()
    this.ensureWorkstream(event.workstream)
    this.recordAudit('artifact', event.artifactId, existing ? 'update' : 'create', callerAgentId ?? event.agentId)
  }

  /** Get a stored artifact by ID, returned as ArtifactEvent shape. */
  getArtifact(artifactId: string): ArtifactEvent | undefined {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE artifact_id = ?').get(artifactId) as ArtifactRow | undefined
    return row ? this.rowToArtifactEvent(row) : undefined
  }

  /** Get the version number of a stored artifact. */
  getArtifactVersion(artifactId: string): number {
    const row = this.db.prepare('SELECT version FROM artifacts WHERE artifact_id = ?').get(artifactId) as { version: number } | undefined
    return row?.version ?? 0
  }

  /**
   * Store artifact content uploaded from an adapter shim.
   * Returns a stable backend URI (artifact://agentId/artifactId).
   */
  storeArtifactContent(agentId: string, artifactId: string, content: string, mimeType?: string): { backendUri: string; artifactId: string; stored: boolean } {
    const backendUri = `artifact://${agentId}/${artifactId}`

    this.db.prepare(`
      INSERT INTO artifact_content (agent_id, artifact_id, content, mime_type, backend_uri, uploaded_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(agent_id, artifact_id) DO UPDATE SET
        content = excluded.content,
        mime_type = excluded.mime_type,
        backend_uri = excluded.backend_uri,
        uploaded_at = datetime('now')
    `).run(agentId, artifactId, content, mimeType ?? null, backendUri)

    this.recordAudit('artifact_content', artifactId, 'upload', agentId)
    return { backendUri, artifactId, stored: true }
  }

  /** Retrieve stored artifact content by agent ID and artifact ID. */
  getArtifactContent(agentId: string, artifactId: string): { content: string; mimeType: string | null; backendUri: string } | undefined {
    const row = this.db.prepare('SELECT content, mime_type, backend_uri FROM artifact_content WHERE agent_id = ? AND artifact_id = ?').get(agentId, artifactId) as
      { content: string; mime_type: string | null; backend_uri: string } | undefined
    return row ? { content: row.content, mimeType: row.mime_type, backendUri: row.backend_uri } : undefined
  }

  /** List all stored artifacts, optionally filtered by workstream. */
  listArtifacts(workstream?: string): ArtifactEvent[] {
    let rows: ArtifactRow[]
    if (workstream) {
      rows = this.db.prepare('SELECT * FROM artifacts WHERE workstream = ?').all(workstream) as ArtifactRow[]
    } else {
      rows = this.db.prepare('SELECT * FROM artifacts').all() as ArtifactRow[]
    }
    return rows.map((r) => this.rowToArtifactEvent(r))
  }

  // ---------------------------------------------------------------------------
  // Agent tracking
  // ---------------------------------------------------------------------------

  /** Register or update an agent handle with metadata. */
  registerAgent(handle: AgentHandle, meta: { role: string; workstream: string; pluginName: string; modelPreference?: string }): void {
    this.db.prepare(`
      INSERT INTO agents (agent_id, plugin_name, status, session_id, role, workstream, model_preference, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(agent_id) DO UPDATE SET
        plugin_name = excluded.plugin_name,
        status = excluded.status,
        session_id = excluded.session_id,
        role = excluded.role,
        workstream = excluded.workstream,
        model_preference = excluded.model_preference,
        updated_at = datetime('now')
    `).run(handle.id, meta.pluginName, handle.status, handle.sessionId, meta.role, meta.workstream, meta.modelPreference ?? null)

    this.bumpVersion()
    this.ensureWorkstream(meta.workstream)
    this.recordAudit('agent', handle.id, 'register')
  }

  /** Update an agent's status. */
  updateAgentStatus(agentId: string, status: AgentHandle['status']): void {
    const result = this.db.prepare("UPDATE agents SET status = ?, updated_at = datetime('now') WHERE agent_id = ?").run(status, agentId)
    if (result.changes > 0) {
      this.bumpVersion()
    }
  }

  /** Remove an agent from the store. */
  removeAgent(agentId: string): void {
    this.db.prepare('DELETE FROM agents WHERE agent_id = ?').run(agentId)
    this.bumpVersion()
    this.recordAudit('agent', agentId, 'remove')
  }

  /** Get an agent handle by ID, returned as AgentHandle shape. */
  getAgent(agentId: string): AgentHandle | undefined {
    const row = this.db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(agentId) as AgentRow | undefined
    return row ? this.rowToAgentHandle(row) : undefined
  }

  // ---------------------------------------------------------------------------
  // Coherence issues
  // ---------------------------------------------------------------------------

  /** Store a coherence issue from a CoherenceEvent. */
  storeCoherenceIssue(event: CoherenceEvent): void {
    this.addCoherenceIssue(event)
  }

  /** Add a coherence issue with optional caller tracking. */
  addCoherenceIssue(event: CoherenceEvent, callerAgentId?: string): void {
    this.db.prepare(`
      INSERT INTO coherence_issues (issue_id, agent_id, title, description, category, severity, affected_workstreams_json, affected_artifact_ids_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(issue_id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        severity = excluded.severity,
        affected_workstreams_json = excluded.affected_workstreams_json,
        affected_artifact_ids_json = excluded.affected_artifact_ids_json
    `).run(
      event.issueId,
      event.agentId,
      event.title,
      event.description,
      event.category,
      event.severity,
      JSON.stringify(event.affectedWorkstreams),
      JSON.stringify(event.affectedArtifactIds)
    )

    this.bumpVersion()
    this.recordAudit('coherence_issue', event.issueId, 'create', callerAgentId ?? event.agentId)
  }

  /** List coherence issues, optionally filtered by status. */
  listCoherenceIssues(status?: string): CoherenceEvent[] {
    let rows: CoherenceRow[]
    if (status) {
      rows = this.db.prepare('SELECT * FROM coherence_issues WHERE status = ?').all(status) as CoherenceRow[]
    } else {
      rows = this.db.prepare('SELECT * FROM coherence_issues').all() as CoherenceRow[]
    }
    return rows.map((r) => this.rowToCoherenceEvent(r))
  }

  /** Resolve a coherence issue with a resolution description. */
  resolveCoherenceIssue(issueId: string, resolution: string, callerAgentId: string): void {
    this.db.prepare(
      "UPDATE coherence_issues SET status = 'resolved', resolution = ?, resolved_by = ? WHERE issue_id = ?"
    ).run(resolution, callerAgentId, issueId)
    this.bumpVersion()
    this.recordAudit('coherence_issue', issueId, 'resolve', callerAgentId)
  }

  // ---------------------------------------------------------------------------
  // Trust profiles (atomic read-modify-write)
  // ---------------------------------------------------------------------------

  /** Get the trust profile for an agent. Returns default 50 score if not tracked. */
  getTrustProfile(agentId: string): { agentId: string; score: number } {
    const row = this.db.prepare('SELECT * FROM trust_profiles WHERE agent_id = ?').get(agentId) as TrustRow | undefined
    return { agentId, score: row?.score ?? 50 }
  }

  /** Atomically update trust via delta. Creates profile if needed. */
  updateTrust(agentId: string, delta: number, reason: string): void {
    // Atomic upsert with delta applied, clamped to [0, 100]
    this.db.prepare(`
      INSERT INTO trust_profiles (agent_id, score, updated_at)
      VALUES (?, MAX(0, MIN(100, 50 + ?)), datetime('now'))
      ON CONFLICT(agent_id) DO UPDATE SET
        score = MAX(0, MIN(100, trust_profiles.score + ?)),
        updated_at = datetime('now')
    `).run(agentId, delta, delta)

    this.recordAudit('trust', agentId, 'update', undefined, { delta, reason })
  }

  // ---------------------------------------------------------------------------
  // Workstreams
  // ---------------------------------------------------------------------------

  /** Register or update a workstream. */
  ensureWorkstream(id: string, name?: string, status?: string): void {
    const existing = this.db.prepare('SELECT * FROM workstreams WHERE id = ?').get(id) as WorkstreamRow | undefined

    if (!existing) {
      this.db.prepare('INSERT INTO workstreams (id, name, status) VALUES (?, ?, ?)').run(
        id,
        name ?? id,
        status ?? 'active'
      )
    } else if (name || status) {
      if (name) {
        this.db.prepare('UPDATE workstreams SET name = ? WHERE id = ?').run(name, id)
      }
      if (status) {
        this.db.prepare('UPDATE workstreams SET status = ? WHERE id = ?').run(status, id)
      }
    }
  }

  /** Update a workstream's recent activity description. */
  updateWorkstreamActivity(workstream: string, activity: string): void {
    this.db.prepare('UPDATE workstreams SET recent_activity = ? WHERE id = ?').run(activity, workstream)
  }

  // ---------------------------------------------------------------------------
  // Event log persistence
  // ---------------------------------------------------------------------------

  /** Append an event envelope to the persistent log. */
  appendEvent(envelope: EventEnvelope): void {
    this.db.prepare(`
      INSERT INTO events (source_event_id, source_sequence, source_occurred_at, run_id, ingested_at, event_type, agent_id, event_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      envelope.sourceEventId,
      envelope.sourceSequence,
      envelope.sourceOccurredAt,
      envelope.runId,
      envelope.ingestedAt,
      envelope.event.type,
      envelope.event.agentId,
      JSON.stringify(envelope.event)
    )
  }

  /** Query events with filtering. */
  getEvents(filter: EventFilter): EventEnvelope[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.agentId) {
      conditions.push('agent_id = ?')
      params.push(filter.agentId)
    }
    if (filter.runId) {
      conditions.push('run_id = ?')
      params.push(filter.runId)
    }
    if (filter.types && filter.types.length > 0) {
      conditions.push(`event_type IN (${filter.types.map(() => '?').join(', ')})`)
      params.push(...filter.types)
    }
    if (filter.since) {
      conditions.push('ingested_at >= ?')
      params.push(filter.since)
    }

    let sql = 'SELECT * FROM events'
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY rowid ASC'

    if (filter.limit) {
      sql += ' LIMIT ?'
      params.push(filter.limit)
    }

    const rows = this.db.prepare(sql).all(...params) as EventRow[]
    return rows.map((r) => this.rowToEventEnvelope(r))
  }

  // ---------------------------------------------------------------------------
  // Checkpoints (decision-on-checkpoint + pause/kill serialization)
  // ---------------------------------------------------------------------------

  /**
   * Store a checkpoint for an agent. Automatically prunes old checkpoints
   * to keep at most `maxPerAgent` per agent (default 3).
   */
  storeCheckpoint(state: SerializedAgentState, decisionId?: string, maxPerAgent = 3): void {
    this.db.prepare(`
      INSERT INTO checkpoints (agent_id, session_id, serialized_by, decision_id, state_json, estimated_size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      state.agentId,
      state.sessionId,
      state.serializedBy,
      decisionId ?? null,
      JSON.stringify(state),
      state.estimatedSizeBytes,
      state.serializedAt
    )

    this.pruneCheckpoints(state.agentId, maxPerAgent)
    this.recordAudit('checkpoint', state.agentId, 'create', state.agentId, {
      serializedBy: state.serializedBy,
      decisionId,
      estimatedSizeBytes: state.estimatedSizeBytes
    })
  }

  /** Get all checkpoints for an agent, ordered newest first. */
  getCheckpoints(agentId: string): StoredCheckpoint[] {
    const rows = this.db.prepare(
      'SELECT * FROM checkpoints WHERE agent_id = ? ORDER BY created_at DESC'
    ).all(agentId) as CheckpointRow[]
    return rows.map((r) => this.rowToStoredCheckpoint(r))
  }

  /** Get the most recent checkpoint for an agent. */
  getLatestCheckpoint(agentId: string): StoredCheckpoint | undefined {
    const row = this.db.prepare(
      'SELECT * FROM checkpoints WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(agentId) as CheckpointRow | undefined
    return row ? this.rowToStoredCheckpoint(row) : undefined
  }

  /** Count checkpoints for an agent. */
  getCheckpointCount(agentId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM checkpoints WHERE agent_id = ?'
    ).get(agentId) as { cnt: number }
    return row.cnt
  }

  /** Delete all checkpoints for an agent. */
  deleteCheckpoints(agentId: string): number {
    const result = this.db.prepare('DELETE FROM checkpoints WHERE agent_id = ?').run(agentId)
    return result.changes
  }

  /** Prune old checkpoints, keeping only the newest `keep` per agent. */
  private pruneCheckpoints(agentId: string, keep: number): void {
    // Get the rowid of the Nth newest checkpoint
    const cutoff = this.db.prepare(
      'SELECT rowid FROM checkpoints WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1 OFFSET ?'
    ).get(agentId, keep) as { rowid: number } | undefined

    if (cutoff) {
      this.db.prepare(
        'DELETE FROM checkpoints WHERE agent_id = ? AND rowid <= ?'
      ).run(agentId, cutoff.rowid)
    }
  }

  private rowToStoredCheckpoint(row: CheckpointRow): StoredCheckpoint {
    return {
      id: row.rowid,
      agentId: row.agent_id,
      sessionId: row.session_id,
      serializedBy: row.serialized_by as SerializedAgentState['serializedBy'],
      decisionId: row.decision_id ?? undefined,
      state: JSON.parse(row.state_json) as SerializedAgentState,
      estimatedSizeBytes: row.estimated_size_bytes,
      createdAt: row.created_at,
    }
  }

  // ---------------------------------------------------------------------------
  // Project config
  // ---------------------------------------------------------------------------

  /** Store or update the project configuration (single-row upsert). */
  storeProjectConfig(config: ProjectConfig): void {
    this.db.prepare(`
      INSERT INTO project_config (id, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `).run(config.id, JSON.stringify(config), config.createdAt, config.updatedAt)
    this.recordAudit('project_config', config.id, 'upsert')
  }

  /** Retrieve the stored project config, or undefined if none exists. */
  getProjectConfig(): ProjectConfig | undefined {
    const row = this.db.prepare('SELECT config_json FROM project_config LIMIT 1').get() as { config_json: string } | undefined
    return row ? JSON.parse(row.config_json) as ProjectConfig : undefined
  }

  /** Returns true if a project config has been seeded. */
  hasProject(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM project_config').get() as { cnt: number }
    return row.cnt > 0
  }

  // ---------------------------------------------------------------------------
  // Version tracking
  // ---------------------------------------------------------------------------

  /** Returns the current version number. */
  getVersion(): number {
    return this.version
  }

  // ---------------------------------------------------------------------------
  // Snapshot generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a KnowledgeSnapshot matching the Zod schema.
   * Accepts pending decisions from the DecisionQueue as external input
   * (the KnowledgeStore does not own decisions).
   */
  getSnapshot(pendingDecisions?: DecisionEvent[]): KnowledgeSnapshot {
    const workstreamSummaries = this.buildWorkstreamSummaries(pendingDecisions)
    const decisionSummaries = this.buildDecisionSummaries(pendingDecisions)
    const coherenceSummaries = this.buildCoherenceSummaries()
    const artifactSummaries = this.buildArtifactSummaries()
    const agentSummaries = this.buildAgentSummaries()

    const estimatedTokens = this.estimateTokens(
      workstreamSummaries,
      decisionSummaries,
      coherenceSummaries,
      artifactSummaries,
      agentSummaries
    )

    return {
      version: this.version,
      generatedAt: new Date().toISOString(),
      workstreams: workstreamSummaries,
      pendingDecisions: decisionSummaries,
      recentCoherenceIssues: coherenceSummaries,
      artifactIndex: artifactSummaries,
      activeAgents: agentSummaries,
      estimatedTokens
    }
  }

  // ---------------------------------------------------------------------------
  // Private: snapshot helpers
  // ---------------------------------------------------------------------------

  private buildWorkstreamSummaries(pendingDecisions?: DecisionEvent[]): WorkstreamSummary[] {
    const wsRows = this.db.prepare('SELECT * FROM workstreams').all() as WorkstreamRow[]
    const agentRows = this.db.prepare('SELECT * FROM agents').all() as AgentRow[]

    return wsRows.map((ws) => {
      const activeAgentIds: string[] = []
      for (const a of agentRows) {
        if (a.workstream === ws.id && (a.status === 'running' || a.status === 'paused' || a.status === 'waiting_on_human')) {
          activeAgentIds.push(a.agent_id)
        }
      }

      const artifactCount = (this.db.prepare(
        'SELECT COUNT(*) as cnt FROM artifacts WHERE workstream = ?'
      ).get(ws.id) as { cnt: number }).cnt

      let pendingDecisionCount = 0
      if (pendingDecisions) {
        for (const d of pendingDecisions) {
          const agentRow = agentRows.find((a) => a.agent_id === d.agentId)
          if (agentRow?.workstream === ws.id) pendingDecisionCount++
        }
      }

      return {
        id: ws.id,
        name: ws.name,
        status: ws.status,
        activeAgentIds,
        artifactCount,
        pendingDecisionCount,
        recentActivity: ws.recent_activity
      }
    })
  }

  private buildDecisionSummaries(pendingDecisions?: DecisionEvent[]): DecisionSummary[] {
    if (!pendingDecisions) return []

    return pendingDecisions.map((d) => {
      const base: DecisionSummary = {
        id: d.decisionId,
        title: d.subtype === 'option' ? (d as any).title : `Tool: ${(d as any).toolName}`,
        severity: d.subtype === 'option' ? (d as any).severity : ((d as any).severity ?? 'medium'),
        agentId: d.agentId,
        subtype: d.subtype,
      }

      if (d.subtype === 'option') {
        const optEvent = d as OptionDecisionEvent
        base.options = optEvent.options
        base.recommendedOptionId = optEvent.recommendedOptionId
        base.confidence = optEvent.confidence
        base.blastRadius = optEvent.blastRadius
        base.affectedArtifactIds = optEvent.affectedArtifactIds
        base.requiresRationale = optEvent.requiresRationale
        base.summary = optEvent.summary
        base.dueByTick = optEvent.dueByTick ?? null
      } else {
        const toolEvent = d as ToolApprovalEvent
        base.toolName = toolEvent.toolName
        base.toolArgs = toolEvent.toolArgs
        base.reasoning = toolEvent.reasoning
        base.confidence = toolEvent.confidence
        base.blastRadius = toolEvent.blastRadius
        base.affectedArtifactIds = toolEvent.affectedArtifactIds
        base.dueByTick = toolEvent.dueByTick ?? null
      }

      return base
    })
  }

  private buildCoherenceSummaries(): CoherenceIssueSummary[] {
    const rows = this.db.prepare('SELECT * FROM coherence_issues').all() as CoherenceRow[]
    return rows.map((r) => ({
      id: r.issue_id,
      title: r.title,
      severity: r.severity as any,
      category: r.category as any,
      affectedWorkstreams: JSON.parse(r.affected_workstreams_json) as string[]
    }))
  }

  private buildArtifactSummaries(): ArtifactSummary[] {
    const rows = this.db.prepare('SELECT artifact_id, name, kind, status, workstream FROM artifacts').all() as Array<{
      artifact_id: string; name: string; kind: string; status: string; workstream: string
    }>
    return rows.map((r) => ({
      id: r.artifact_id,
      name: r.name,
      kind: r.kind as any,
      status: r.status as any,
      workstream: r.workstream
    }))
  }

  private buildAgentSummaries(): AgentSummary[] {
    const rows = this.db.prepare('SELECT * FROM agents').all() as AgentRow[]
    return rows.map((r) => ({
      id: r.agent_id,
      role: r.role,
      workstream: r.workstream,
      status: r.status as any,
      pluginName: r.plugin_name,
      ...(r.model_preference ? { modelPreference: r.model_preference } : {})
    }))
  }

  /** Rough token estimate based on JSON serialization size. */
  private estimateTokens(
    workstreams: WorkstreamSummary[],
    decisions: DecisionSummary[],
    coherence: CoherenceIssueSummary[],
    artifacts: ArtifactSummary[],
    agents: AgentSummary[]
  ): number {
    const jsonSize = JSON.stringify({ workstreams, decisions, coherence, artifacts, agents }).length
    return Math.ceil(jsonSize / 4)
  }

  // ---------------------------------------------------------------------------
  // Private: row mapping
  // ---------------------------------------------------------------------------

  private rowToArtifactEvent(row: ArtifactRow): ArtifactEvent {
    return {
      type: 'artifact',
      agentId: row.agent_id,
      artifactId: row.artifact_id,
      name: row.name,
      kind: row.kind as any,
      workstream: row.workstream,
      status: row.status as any,
      qualityScore: row.quality_score,
      provenance: JSON.parse(row.provenance_json),
      ...(row.uri ? { uri: row.uri } : {}),
      ...(row.mime_type ? { mimeType: row.mime_type } : {}),
      ...(row.size_bytes != null ? { sizeBytes: row.size_bytes } : {}),
      ...(row.content_hash ? { contentHash: row.content_hash } : {})
    }
  }

  private rowToAgentHandle(row: AgentRow): AgentHandle {
    return {
      id: row.agent_id,
      pluginName: row.plugin_name,
      status: row.status as any,
      sessionId: row.session_id
    }
  }

  private rowToCoherenceEvent(row: CoherenceRow): CoherenceEvent {
    return {
      type: 'coherence',
      agentId: row.agent_id,
      issueId: row.issue_id,
      title: row.title,
      description: row.description,
      category: row.category as any,
      severity: row.severity as any,
      affectedWorkstreams: JSON.parse(row.affected_workstreams_json),
      affectedArtifactIds: JSON.parse(row.affected_artifact_ids_json)
    }
  }

  private rowToEventEnvelope(row: EventRow): EventEnvelope {
    return {
      sourceEventId: row.source_event_id,
      sourceSequence: row.source_sequence,
      sourceOccurredAt: row.source_occurred_at,
      runId: row.run_id,
      ingestedAt: row.ingested_at,
      event: JSON.parse(row.event_json)
    }
  }
}

// ---------------------------------------------------------------------------
// Row types for SQLite result mapping
// ---------------------------------------------------------------------------

interface ArtifactRow {
  artifact_id: string
  agent_id: string
  name: string
  kind: string
  workstream: string
  status: string
  quality_score: number
  provenance_json: string
  uri: string | null
  mime_type: string | null
  size_bytes: number | null
  content_hash: string | null
  version: number
  updated_by: string | null
  updated_at: string
}

interface AgentRow {
  agent_id: string
  plugin_name: string
  status: string
  session_id: string
  role: string
  workstream: string
  model_preference: string | null
  updated_at: string
}

interface CoherenceRow {
  issue_id: string
  agent_id: string
  title: string
  description: string
  category: string
  severity: string
  affected_workstreams_json: string
  affected_artifact_ids_json: string
  status: string
  resolution: string | null
  resolved_by: string | null
  created_at: string
}

interface TrustRow {
  agent_id: string
  score: number
  updated_at: string
}

interface WorkstreamRow {
  id: string
  name: string
  status: string
  recent_activity: string
}

interface EventRow {
  rowid: number
  source_event_id: string
  source_sequence: number
  source_occurred_at: string
  run_id: string
  ingested_at: string
  event_type: string
  agent_id: string
  event_json: string
}

interface AuditRow {
  entity_type: string
  entity_id: string
  action: string
  caller_agent_id: string | null
  timestamp: string
  details_json: string | null
}

interface CheckpointRow {
  rowid: number
  agent_id: string
  session_id: string
  serialized_by: string
  decision_id: string | null
  state_json: string
  estimated_size_bytes: number
  created_at: string
}

// Re-export StoredCheckpoint from shared types for backwards compatibility.
export type { StoredCheckpoint } from '../types/service-interfaces'
