/**
 * Shared utilities for coherence pipeline experiments.
 * Provides corpus loading, scoring, result output, and helper functions.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { ArtifactEvent, ArtifactKind, CoherenceCategory, Severity } from '../../src/types/events.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManifestArtifact {
  artifactId: string
  workstream: string
  agentId: string
  filename: string
  kind: ArtifactKind
  estimatedTokens: number
  issueIds: number[]
}

export interface Manifest {
  generatedAt: string
  seed: number
  totalArtifacts: number
  totalIssues: number
  artifacts: ManifestArtifact[]
}

export interface CorpusArtifact {
  artifactId: string
  workstream: string
  agentId: string
  filename: string
  kind: ArtifactKind
  content: string
  estimatedTokens: number
}

export interface GroundTruthIssue {
  id: number
  pairKey: string
  artifactIdA: string
  artifactIdB: string
  workstreamA: string
  workstreamB: string
  category: CoherenceCategory
  severity: Severity
  difficulty: 'easy' | 'medium' | 'hard'
  description: string
  expectedDetectionLayers: string[]
}

export interface ScoringResult {
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  f1: number
  detectedIssueIds: number[]
  missedIssueIds: number[]
  falsePositivePairs: string[]
}

export interface ExperimentResult {
  experimentId: string
  timestamp: string
  duration: number
  data: unknown
}

// ---------------------------------------------------------------------------
// Corpus loading
// ---------------------------------------------------------------------------

const CORPUS_DIR = path.resolve(__dirname, 'corpus')

export function loadManifest(): Manifest {
  const raw = fs.readFileSync(path.join(CORPUS_DIR, 'manifest.json'), 'utf-8')
  return JSON.parse(raw)
}

export function loadGroundTruth(): GroundTruthIssue[] {
  const raw = fs.readFileSync(path.join(CORPUS_DIR, 'ground-truth.json'), 'utf-8')
  return JSON.parse(raw).issues
}

export function loadCorpus(): CorpusArtifact[] {
  const manifest = loadManifest()
  return manifest.artifacts.map(entry => {
    const content = fs.readFileSync(path.join(CORPUS_DIR, entry.filename), 'utf-8')
    return {
      artifactId: entry.artifactId,
      workstream: entry.workstream,
      agentId: entry.agentId,
      filename: entry.filename,
      kind: entry.kind,
      content,
      estimatedTokens: entry.estimatedTokens,
    }
  })
}

// ---------------------------------------------------------------------------
// ArtifactEvent bridge
// ---------------------------------------------------------------------------

export function toArtifactEvent(artifact: CorpusArtifact, tick?: number): ArtifactEvent {
  const contentHash = crypto.createHash('sha256').update(artifact.content).digest('hex')
  return {
    type: 'artifact',
    agentId: artifact.agentId,
    artifactId: artifact.artifactId,
    name: path.basename(artifact.filename),
    kind: artifact.kind,
    workstream: artifact.workstream,
    status: 'approved',
    qualityScore: 0.8,
    provenance: {
      createdBy: artifact.agentId,
      createdAt: new Date(2026, 0, 15, 0, 0, 0).toISOString(),
    },
    uri: artifact.filename,
    contentHash,
    sizeBytes: Buffer.byteLength(artifact.content, 'utf-8'),
  }
}

export function buildArtifactProvider(
  corpus: CorpusArtifact[]
): (id: string) => ArtifactEvent | undefined {
  const map = new Map<string, ArtifactEvent>()
  for (const a of corpus) {
    map.set(a.artifactId, toArtifactEvent(a))
  }
  return (id: string) => map.get(id)
}

export function buildContentProvider(
  corpus: CorpusArtifact[]
): (id: string) => string | undefined {
  const map = new Map<string, string>()
  for (const a of corpus) {
    map.set(a.artifactId, a.content)
  }
  return (id: string) => map.get(id)
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function makePairKey(a: string, b: string): string {
  return [a, b].sort().join(':')
}

export function scoreDetections(
  detectedPairs: Array<{ artifactIdA: string; artifactIdB: string }>,
  groundTruth: GroundTruthIssue[],
  filterDifficulty?: 'easy' | 'medium' | 'hard'
): ScoringResult {
  const relevantIssues = filterDifficulty
    ? groundTruth.filter(i => i.difficulty === filterDifficulty)
    : groundTruth

  const truthKeys = new Map<string, number>()
  for (const issue of relevantIssues) {
    truthKeys.set(issue.pairKey, issue.id)
  }

  const detectedKeys = new Set<string>()
  for (const pair of detectedPairs) {
    detectedKeys.add(makePairKey(pair.artifactIdA, pair.artifactIdB))
  }

  const detectedIssueIds: number[] = []
  const missedIssueIds: number[] = []

  for (const [key, id] of truthKeys) {
    if (detectedKeys.has(key)) {
      detectedIssueIds.push(id)
    } else {
      missedIssueIds.push(id)
    }
  }

  const falsePositivePairs: string[] = []
  for (const key of detectedKeys) {
    if (!truthKeys.has(key)) {
      falsePositivePairs.push(key)
    }
  }

  const tp = detectedIssueIds.length
  const fp = falsePositivePairs.length
  const fn = missedIssueIds.length

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
    detectedIssueIds,
    missedIssueIds,
    falsePositivePairs,
  }
}

// ---------------------------------------------------------------------------
// Result output
// ---------------------------------------------------------------------------

const RESULTS_DIR = path.resolve(__dirname, 'results')

export function writeResult(result: ExperimentResult): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true })
  }
  const filename = `${result.experimentId}-${result.timestamp.replace(/[:.]/g, '-')}.json`
  fs.writeFileSync(
    path.join(RESULTS_DIR, filename),
    JSON.stringify(result, null, 2) + '\n',
    'utf-8'
  )
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed)
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
