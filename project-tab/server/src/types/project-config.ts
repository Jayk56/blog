export interface WorkstreamDefinition {
  id: string
  name: string
  description: string
  keyFiles: string[]
  status?: 'active' | 'paused' | 'completed'
  exports?: string[]
  dependencies?: string[]
  _autoDescription?: boolean
}

export interface SeedArtifact {
  name: string
  kind: 'code' | 'document' | 'design' | 'config' | 'test' | 'other'
  workstream: string
  uri?: string
  contentHash?: string
  sizeBytes?: number
}

export interface SeedProvenance {
  source: 'bootstrap-cli' | 'api' | 'manual'
  gitCommit?: string
  gitBranch?: string
  repoRoot?: string
  scannedAt?: string
}

export interface ProjectConfig {
  id: string
  title: string
  description: string
  goals: string[]
  checkpoints: string[]
  constraints: string[]
  framework?: string
  workstreams: WorkstreamDefinition[]
  defaultTools: string[]
  defaultConstraints: string[]
  defaultEscalation: { alwaysEscalate: string[]; neverEscalate: string[] }
  repoRoot?: string
  provenance?: SeedProvenance
  createdAt: string
  updatedAt: string
}

export interface ProjectSeedPayload {
  schemaVersion?: number
  project: {
    title: string
    description: string
    goals: string[]
    checkpoints: string[]
    constraints?: string[]
    framework?: string
  }
  workstreams: WorkstreamDefinition[]
  artifacts?: SeedArtifact[]
  repoRoot?: string
  provenance?: SeedProvenance
  defaultTools?: string[]
  defaultConstraints?: string[]
  defaultEscalation?: { alwaysEscalate?: string[]; neverEscalate?: string[] }
}

export interface DraftBriefRequest {
  agentId?: string
  role: string
  description: string
  workstream: string
  modelPreference?: string
  readableWorkstreams?: string[]
  additionalConstraints?: string[]
  additionalTools?: string[]
}
