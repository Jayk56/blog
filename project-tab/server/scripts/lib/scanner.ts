/**
 * scanner.ts — File scanning and workstream detection for bootstrap.
 *
 * Extracts scanning logic from bootstrap.ts into a reusable, testable module.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { SeedArtifact } from '../../src/types/project-config.js'

// ── Types ────────────────────────────────────────────────────────────

export interface ScannedWorkstream {
  id: string
  name: string
  dirPath: string           // absolute path
  files: string[]           // relative to repo root
  testFiles: string[]       // matched from test/ dir
  hasBarrelIndex: boolean   // index.ts exists
}

type ArtifactKind = SeedArtifact['kind']

// ── File utilities ───────────────────────────────────────────────────

/**
 * Recursively list .ts files in a directory. Excludes .d.ts files.
 */
export function listTsFiles(dir: string): string[] {
  const results: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && /\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        results.push(fullPath)
      } else if (entry.isDirectory()) {
        results.push(...listTsFiles(fullPath))
      }
    }
  } catch {
    // ignore permission errors etc.
  }
  return results
}

/**
 * Classify a file by its name into an artifact kind.
 */
export function classifyFile(filename: string): ArtifactKind {
  if (/\.(test|spec)\./i.test(filename)) return 'test'

  const ext = path.extname(filename).toLowerCase()
  switch (ext) {
    case '.ts':
    case '.js':
    case '.py':
      return 'code'
    case '.md':
      return 'document'
    case '.json':
    case '.yaml':
    case '.yml':
      return 'config'
    default:
      return 'other'
  }
}

/**
 * Sort files: index.ts first, then non-test files, then tests. Return first `cap`.
 */
export function pickKeyFiles(files: string[], cap: number): string[] {
  const sorted = [...files].sort((a, b) => {
    const aBase = path.basename(a)
    const bBase = path.basename(b)
    if (aBase === 'index.ts') return -1
    if (bBase === 'index.ts') return 1
    const aTest = /\.(test|spec)\./.test(aBase) ? 1 : 0
    const bTest = /\.(test|spec)\./.test(bBase) ? 1 : 0
    return aTest - bTest || aBase.localeCompare(bBase)
  })
  return sorted.slice(0, cap)
}

// ── Scanning ─────────────────────────────────────────────────────────

/**
 * Scan src/ subdirectories. Any subdirectory with 1+ .ts file becomes a workstream.
 * Root-level .ts files in src/ are grouped into a "core" pseudo-workstream.
 * Excludes .d.ts files.
 */
export function scanWorkstreams(repoRoot: string): ScannedWorkstream[] {
  const srcDir = path.join(repoRoot, 'src')
  if (!dirExists(srcDir)) return []

  const entries = fs.readdirSync(srcDir, { withFileTypes: true })
  const workstreams: ScannedWorkstream[] = []
  const coreFiles: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(srcDir, entry.name)

    if (entry.isDirectory()) {
      const tsFiles = listTsFiles(fullPath)
      if (tsFiles.length >= 1) {
        const hasBarrel = tsFiles.some((f) => path.basename(f) === 'index.ts')
        workstreams.push({
          id: entry.name,
          name: entry.name,
          dirPath: fullPath,
          files: tsFiles.map((f) => path.relative(repoRoot, f)),
          testFiles: [],
          hasBarrelIndex: hasBarrel,
        })
      }
    } else if (entry.isFile() && /\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      coreFiles.push(path.relative(repoRoot, fullPath))
    }
  }

  // Add "core" pseudo-workstream for root-level src/*.ts files
  if (coreFiles.length > 0) {
    workstreams.push({
      id: 'core',
      name: 'core',
      dirPath: srcDir,
      files: coreFiles,
      testFiles: [],
      hasBarrelIndex: coreFiles.some((f) => path.basename(f) === 'index.ts'),
    })
  }

  return workstreams
}

/**
 * Map test/ files to workstreams. Mutates workstreams in place.
 * - test/<name>/ maps to workstream by name
 * - Root-level test files (test/bus.test.ts) map to "core" workstream
 * - test/integration/ and test/e2e/ map to an "integration" pseudo-workstream
 * - test/helpers/ is excluded
 */
export function mapTestFiles(repoRoot: string, workstreams: ScannedWorkstream[]): void {
  const testDir = path.join(repoRoot, 'test')
  if (!dirExists(testDir)) return

  const wsMap = new Map<string, ScannedWorkstream>()
  for (const ws of workstreams) {
    wsMap.set(ws.id, ws)
  }

  const entries = fs.readdirSync(testDir, { withFileTypes: true })
  let integrationWs: ScannedWorkstream | undefined = wsMap.get('integration')

  for (const entry of entries) {
    const fullPath = path.join(testDir, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === 'helpers') continue

      if (entry.name === 'integration' || entry.name === 'e2e') {
        const tsFiles = listTsFiles(fullPath)
        if (tsFiles.length === 0) continue
        const relFiles = tsFiles.map((f) => path.relative(repoRoot, f))

        if (!integrationWs) {
          integrationWs = {
            id: 'integration',
            name: 'integration',
            dirPath: path.join(testDir, 'integration'),
            files: [],
            testFiles: relFiles,
            hasBarrelIndex: false,
          }
          workstreams.push(integrationWs)
          wsMap.set('integration', integrationWs)
        } else {
          integrationWs.testFiles.push(...relFiles)
        }
        continue
      }

      // Match to workstream by directory name
      const target = wsMap.get(entry.name)
      if (target) {
        const tsFiles = listTsFiles(fullPath)
        target.testFiles.push(...tsFiles.map((f) => path.relative(repoRoot, f)))
      }
    } else if (entry.isFile() && /\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      // Root-level test files go to "core"
      const core = wsMap.get('core')
      if (core) {
        core.testFiles.push(path.relative(repoRoot, fullPath))
      }
    }
  }
}

/**
 * Scan root config and documentation files, returning SeedArtifact[].
 */
export function scanRootFiles(repoRoot: string): SeedArtifact[] {
  const artifacts: SeedArtifact[] = []

  // Root config files
  const configFiles = ['tsconfig.json', 'vitest.config.ts', 'package.json']
  for (const name of configFiles) {
    if (fileExists(path.join(repoRoot, name))) {
      artifacts.push({
        name,
        kind: classifyFile(name),
        workstream: 'root',
        uri: name,
      })
    }
  }

  // README.md
  if (fileExists(path.join(repoRoot, 'README.md'))) {
    artifacts.push({
      name: 'README.md',
      kind: 'document',
      workstream: 'root',
      uri: 'README.md',
    })
  }

  // docs/*.md
  const docsDir = path.join(repoRoot, 'docs')
  if (dirExists(docsDir)) {
    try {
      const entries = fs.readdirSync(docsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && /\.md$/i.test(entry.name)) {
          artifacts.push({
            name: entry.name,
            kind: 'document',
            workstream: 'root',
            uri: path.join('docs', entry.name),
          })
        }
      }
    } catch {
      // ignore
    }
  }

  return artifacts
}

/**
 * Compute SHA-256 hash of a file's content. Returns undefined if file can't be read.
 */
export function computeFileHash(absolutePath: string): { hash: string; sizeBytes: number } | undefined {
  try {
    const content = fs.readFileSync(absolutePath)
    const hash = createHash('sha256').update(content).digest('hex')
    return { hash, sizeBytes: content.length }
  } catch {
    return undefined
  }
}

/**
 * Build SeedArtifact[] from workstreams (src files + testFiles), capped at `cap`
 * per workstream, plus rootArtifacts appended.
 * When repoRoot is provided, computes content hashes for each artifact with a URI.
 */
export function buildArtifacts(
  workstreams: ScannedWorkstream[],
  rootArtifacts: SeedArtifact[],
  cap: number,
  repoRoot?: string,
): SeedArtifact[] {
  const artifacts: SeedArtifact[] = []

  function withHash(artifact: SeedArtifact): SeedArtifact {
    if (!repoRoot || !artifact.uri) return artifact
    const info = computeFileHash(path.join(repoRoot, artifact.uri))
    if (info) {
      return { ...artifact, contentHash: info.hash, sizeBytes: info.sizeBytes }
    }
    return artifact
  }

  for (const ws of workstreams) {
    // Source files with classifyFile
    const srcArtifacts: SeedArtifact[] = ws.files.map((relPath) => withHash({
      name: path.basename(relPath),
      kind: classifyFile(path.basename(relPath)),
      workstream: ws.id,
      uri: relPath,
    }))

    // Test files always get kind: 'test'
    const testArtifacts: SeedArtifact[] = ws.testFiles.map((relPath) => withHash({
      name: path.basename(relPath),
      kind: 'test' as const,
      workstream: ws.id,
      uri: relPath,
    }))

    const all = [...srcArtifacts, ...testArtifacts]
    // Cap per workstream
    artifacts.push(...all.slice(0, cap))
  }

  // Append root artifacts (with hashes)
  artifacts.push(...rootArtifacts.map(a => withHash(a)))

  return artifacts
}

// ── Internal helpers ─────────────────────────────────────────────────

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}
