/**
 * seed-file.ts — Read, write, merge, and validate project-seed.json files.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ProjectSeedPayload, WorkstreamDefinition } from '../../src/types/project-config.js'
export { mergeSeeds, configToSeedPayload } from '../../src/lib/merge-seeds.js'

// ── Constants ─────────────────────────────────────────────────────────

export const SEED_FILENAME = 'project-seed.json'

// ── Types ─────────────────────────────────────────────────────────────

export interface ValidationIssue {
  severity: 'error' | 'warning'
  message: string
  path?: string
}

// ── File I/O ──────────────────────────────────────────────────────────

/**
 * Check if project-seed.json exists in repoRoot.
 */
export function seedFileExists(repoRoot: string): boolean {
  const filePath = path.join(repoRoot, SEED_FILENAME)
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

export const CURRENT_SCHEMA_VERSION = 1

/**
 * Read and parse project-seed.json. Return null if file doesn't exist or is invalid JSON.
 * Warns to stderr if schemaVersion is missing or outdated.
 */
export function readSeedFile(repoRoot: string): ProjectSeedPayload | null {
  const filePath = path.join(repoRoot, SEED_FILENAME)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const payload = JSON.parse(raw) as ProjectSeedPayload
    if (!payload.schemaVersion) {
      process.stderr.write(`Warning: ${SEED_FILENAME} has no schemaVersion field. Run --refresh to update.\n`)
    } else if (payload.schemaVersion < CURRENT_SCHEMA_VERSION) {
      process.stderr.write(`Warning: ${SEED_FILENAME} schemaVersion ${payload.schemaVersion} is outdated (current: ${CURRENT_SCHEMA_VERSION}). Run --refresh to update.\n`)
    }
    return payload
  } catch {
    return null
  }
}

/**
 * Write payload as JSON with 2-space indent + trailing newline.
 */
export function writeSeedFile(repoRoot: string, payload: ProjectSeedPayload): void {
  const filePath = path.join(repoRoot, SEED_FILENAME)
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
}

// ── Merge ─────────────────────────────────────────────────────────────
// mergeSeeds and configToSeedPayload are re-exported from src/lib/merge-seeds.ts

// ── Circular dependency detection ────────────────────────────────────

/**
 * Detect circular dependencies among workstreams using DFS.
 * Returns an array of cycle paths, e.g. [['A', 'B', 'A']] means A depends on B which depends on A.
 */
export function detectCircularDependencies(workstreams: WorkstreamDefinition[]): string[][] {
  // Build adjacency list: id -> list of dependency ids
  const adj = new Map<string, string[]>()
  for (const ws of workstreams) {
    adj.set(ws.id, ws.dependencies ?? [])
  }

  const cycles: string[][] = []
  const visited = new Set<string>()
  const onStack = new Set<string>()
  const stack: string[] = []

  function dfs(node: string): void {
    if (onStack.has(node)) {
      // Found a cycle — extract it from the stack
      const cycleStart = stack.indexOf(node)
      const cycle = stack.slice(cycleStart)
      cycle.push(node) // close the cycle
      cycles.push(cycle)
      return
    }
    if (visited.has(node)) return

    visited.add(node)
    onStack.add(node)
    stack.push(node)

    const deps = adj.get(node) ?? []
    for (const dep of deps) {
      dfs(dep)
    }

    stack.pop()
    onStack.delete(node)
  }

  for (const ws of workstreams) {
    dfs(ws.id)
  }

  return cycles
}

// ── Validation ────────────────────────────────────────────────────────

/**
 * Validate a seed payload against the filesystem.
 *
 * Checks:
 *   - keyFiles referencing paths that don't exist on disk → error
 *   - artifact URIs that don't exist on disk → warning
 *   - Workstreams in seed with no matching src/ subdirectory (except "core" and "integration") → warning
 *   - src/ subdirectories not represented in seed workstreams → warning
 */
export function validateSeedFile(
  repoRoot: string,
  payload: ProjectSeedPayload,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Check keyFiles exist on disk
  for (const ws of payload.workstreams) {
    for (const keyFile of ws.keyFiles) {
      const fullPath = path.join(repoRoot, keyFile)
      if (!fileExists(fullPath)) {
        issues.push({
          severity: 'error',
          message: `keyFile not found: ${keyFile} (workstream: ${ws.id})`,
          path: keyFile,
        })
      }
    }
  }

  // Check artifact URIs exist on disk
  if (payload.artifacts) {
    for (const artifact of payload.artifacts) {
      if (artifact.uri) {
        const fullPath = path.join(repoRoot, artifact.uri)
        if (!fileExists(fullPath)) {
          issues.push({
            severity: 'warning',
            message: `artifact URI not found: ${artifact.uri} (artifact: ${artifact.name})`,
            path: artifact.uri,
          })
        }
      }
    }
  }

  // Check workstreams in seed with no matching src/ subdirectory
  const exemptIds = new Set(['core', 'integration'])
  const srcDir = path.join(repoRoot, 'src')
  const srcSubdirs = listSubdirectories(srcDir)

  for (const ws of payload.workstreams) {
    if (exemptIds.has(ws.id)) continue
    if (!srcSubdirs.has(ws.id)) {
      issues.push({
        severity: 'warning',
        message: `workstream "${ws.id}" has no matching src/${ws.id}/ directory`,
      })
    }
  }

  // Check src/ subdirectories not represented in seed
  const seedIds = new Set(payload.workstreams.map((ws) => ws.id))
  for (const dirName of srcSubdirs) {
    if (!seedIds.has(dirName)) {
      // Only warn if the directory has at least one .ts file
      const dirPath = path.join(srcDir, dirName)
      if (hasTsFiles(dirPath)) {
        issues.push({
          severity: 'warning',
          message: `src/${dirName}/ is not represented in seed workstreams`,
        })
      }
    }
  }

  // Check for circular dependencies
  const cycles = detectCircularDependencies(payload.workstreams)
  for (const cycle of cycles) {
    issues.push({
      severity: 'warning',
      message: `circular dependency detected: ${cycle.join(' \u2192 ')}`,
    })
  }

  // Check for missing test directories (exempt core and integration)
  const testDir = path.join(repoRoot, 'test')
  for (const ws of payload.workstreams) {
    if (exemptIds.has(ws.id)) continue
    const wsTestDir = path.join(testDir, ws.id)
    if (!hasTsFiles(wsTestDir)) {
      issues.push({
        severity: 'warning',
        message: `workstream "${ws.id}" has no test directory (test/${ws.id}/)`,
      })
    }
  }

  // Check for workstreams with no exports and no barrel index.ts
  for (const ws of payload.workstreams) {
    if (exemptIds.has(ws.id)) continue
    const hasExports = ws.exports !== undefined && ws.exports.length > 0
    const barrelPath = path.join(srcDir, ws.id, 'index.ts')
    const hasBarrel = fileExists(barrelPath)
    if (!hasExports && !hasBarrel) {
      issues.push({
        severity: 'warning',
        message: `workstream "${ws.id}" has no exports and no barrel index.ts`,
      })
    }
  }

  return issues
}

// ── Diff ──────────────────────────────────────────────────────────────

export interface WorkstreamDiff {
  id: string
  descriptionChanged: boolean
  descriptionPreserved: boolean  // human-edited, kept as-is
  keyFilesAdded: string[]
  keyFilesRemoved: string[]
  exportsAdded: string[]
  exportsRemoved: string[]
  depsAdded: string[]
  depsRemoved: string[]
}

export interface SeedDiff {
  newWorkstreams: string[]
  removedWorkstreams: string[]
  updatedWorkstreams: WorkstreamDiff[]
  artifactCountChange: { before: number; after: number }
}

export function computeSeedDiff(
  existing: ProjectSeedPayload,
  scanned: ProjectSeedPayload,
): SeedDiff {
  const existingMap = new Map(existing.workstreams.map(ws => [ws.id, ws]))
  const scannedMap = new Map(scanned.workstreams.map(ws => [ws.id, ws]))

  const newWorkstreams: string[] = []
  const removedWorkstreams: string[] = []
  const updatedWorkstreams: WorkstreamDiff[] = []

  // New workstreams (in scanned but not existing)
  for (const id of scannedMap.keys()) {
    if (!existingMap.has(id)) newWorkstreams.push(id)
  }

  // Removed workstreams (in existing but not scanned)
  for (const id of existingMap.keys()) {
    if (!scannedMap.has(id)) removedWorkstreams.push(id)
  }

  // Updated workstreams (in both)
  for (const [id, scannedWs] of scannedMap) {
    const existingWs = existingMap.get(id)
    if (!existingWs) continue

    const existKeyFiles = new Set(existingWs.keyFiles)
    const scannedKeyFiles = new Set(scannedWs.keyFiles)
    const existExports = new Set(existingWs.exports ?? [])
    const scannedExports = new Set(scannedWs.exports ?? [])
    const existDeps = new Set(existingWs.dependencies ?? [])
    const scannedDeps = new Set(scannedWs.dependencies ?? [])

    const diff: WorkstreamDiff = {
      id,
      descriptionChanged: existingWs._autoDescription ? existingWs.description !== scannedWs.description : false,
      descriptionPreserved: !existingWs._autoDescription,
      keyFilesAdded: [...scannedKeyFiles].filter(f => !existKeyFiles.has(f)),
      keyFilesRemoved: [...existKeyFiles].filter(f => !scannedKeyFiles.has(f)),
      exportsAdded: [...scannedExports].filter(e => !existExports.has(e)),
      exportsRemoved: [...existExports].filter(e => !scannedExports.has(e)),
      depsAdded: [...scannedDeps].filter(d => !existDeps.has(d)),
      depsRemoved: [...existDeps].filter(d => !scannedDeps.has(d)),
    }

    const hasChanges = diff.descriptionChanged || diff.keyFilesAdded.length > 0 ||
      diff.keyFilesRemoved.length > 0 || diff.exportsAdded.length > 0 ||
      diff.exportsRemoved.length > 0 || diff.depsAdded.length > 0 ||
      diff.depsRemoved.length > 0

    if (hasChanges || diff.descriptionPreserved) {
      updatedWorkstreams.push(diff)
    }
  }

  return {
    newWorkstreams,
    removedWorkstreams,
    updatedWorkstreams,
    artifactCountChange: {
      before: existing.artifacts?.length ?? 0,
      after: scanned.artifacts?.length ?? 0,
    },
  }
}

export function formatDiff(diff: SeedDiff): string {
  const lines: string[] = []

  if (diff.newWorkstreams.length > 0) {
    lines.push('New workstreams:')
    for (const id of diff.newWorkstreams) {
      lines.push(`  + ${id}`)
    }
  }

  if (diff.removedWorkstreams.length > 0) {
    lines.push('Removed workstreams:')
    for (const id of diff.removedWorkstreams) {
      lines.push(`  - ${id}`)
    }
  }

  if (diff.updatedWorkstreams.length > 0) {
    lines.push('Updated workstreams:')
    for (const ws of diff.updatedWorkstreams) {
      const changes: string[] = []
      if (ws.descriptionChanged) changes.push('description changed')
      if (ws.descriptionPreserved) changes.push('description preserved (human-edited)')
      if (ws.keyFilesAdded.length > 0) changes.push(`+${ws.keyFilesAdded.length} keyFiles`)
      if (ws.keyFilesRemoved.length > 0) changes.push(`-${ws.keyFilesRemoved.length} keyFiles`)
      if (ws.exportsAdded.length > 0) changes.push(`+${ws.exportsAdded.length} exports`)
      if (ws.exportsRemoved.length > 0) changes.push(`-${ws.exportsRemoved.length} exports`)
      if (ws.depsAdded.length > 0) changes.push(`+${ws.depsAdded.length} deps`)
      if (ws.depsRemoved.length > 0) changes.push(`-${ws.depsRemoved.length} deps`)
      if (changes.length > 0) {
        lines.push(`  ~ ${ws.id}: ${changes.join(', ')}`)
      }
    }
  }

  const { before, after } = diff.artifactCountChange
  if (before !== after) {
    lines.push(`Artifacts: ${before} -> ${after}`)
  }

  if (lines.length === 0) {
    lines.push('No changes detected.')
  }

  return lines.join('\n')
}

// ── Internal helpers ──────────────────────────────────────────────────

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function listSubdirectories(dir: string): Set<string> {
  const result = new Set<string>()
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        result.add(entry.name)
      }
    }
  } catch {
    // directory might not exist
  }
  return result
}

function hasTsFiles(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    return entries.some(
      (e) => e.isFile() && /\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name),
    )
  } catch {
    return false
  }
}
