#!/usr/bin/env npx tsx
/**
 * bootstrap.ts — Scan a repo and produce a ProjectSeedPayload.
 *
 * Usage:
 *   npx tsx scripts/bootstrap.ts <repo-root> [options]
 *
 * Options:
 *   --output <file>   Write JSON to file instead of stdout
 *   --server <url>    Server URL (default: http://localhost:3001)
 *   --post            POST the payload to the server's /api/project/seed
 *   --title <name>    Override project title
 *   --dry-run         Print what would be done without writing/posting
 *   --init            Create project-seed.json from scratch
 *   --refresh         Rescan and merge into existing project-seed.json
 *   --validate        Validate existing project-seed.json against filesystem
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  ProjectSeedPayload,
  WorkstreamDefinition,
} from '../src/types/project-config.js'
import {
  scanWorkstreams,
  mapTestFiles,
  scanRootFiles,
  buildArtifacts,
  pickKeyFiles,
} from './lib/scanner.js'
import {
  extractLeadingJsDoc,
  parseBarrelExports,
  extractFileExports,
  buildDependencyGraph,
  synthesizeModuleDescription,
  collectJsDocCandidates,
} from './lib/enrichment.js'
import {
  HeuristicDescriptionService,
  LlmDescriptionService,
} from './lib/description-service.js'
import { readProjectContext, getGitInfo } from './lib/context.js'
import {
  seedFileExists,
  readSeedFile,
  writeSeedFile,
  mergeSeeds,
  validateSeedFile,
  computeSeedDiff,
  formatDiff,
  SEED_FILENAME,
} from './lib/seed-file.js'

// ── CLI arg parsing ──────────────────────────────────────────────────

interface CliArgs {
  repoRoot: string
  output?: string
  server: string
  post: boolean
  title?: string
  dryRun: boolean
  mode: 'default' | 'init' | 'refresh' | 'validate' | 'diff'
  noLlm: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2) // skip node + script
  const result: CliArgs = {
    repoRoot: '',
    server: 'http://localhost:3001',
    post: false,
    dryRun: false,
    mode: 'default',
    noLlm: false,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]
    switch (arg) {
      case '--output':
        result.output = args[++i]
        break
      case '--server':
        result.server = args[++i]
        break
      case '--post':
        result.post = true
        break
      case '--title':
        result.title = args[++i]
        break
      case '--dry-run':
        result.dryRun = true
        break
      case '--init':
        result.mode = 'init'
        break
      case '--refresh':
        result.mode = 'refresh'
        break
      case '--validate':
        result.mode = 'validate'
        break
      case '--diff':
        result.mode = 'diff'
        break
      case '--no-llm':
        result.noLlm = true
        break
      default:
        if (arg.startsWith('-')) {
          stderr(`Unknown flag: ${arg}`)
          process.exit(1)
        }
        if (!result.repoRoot) {
          result.repoRoot = path.resolve(arg)
        } else {
          stderr(`Unexpected positional arg: ${arg}`)
          process.exit(1)
        }
    }
    i++
  }

  if (!result.repoRoot) {
    stderr('Usage: npx tsx scripts/bootstrap.ts <repo-root> [options]')
    process.exit(1)
  }

  return result
}

// ── Helpers ──────────────────────────────────────────────────────────

function stderr(msg: string): void {
  process.stderr.write(msg + '\n')
}

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

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseArgs(process.argv)

  if (!dirExists(cli.repoRoot)) {
    stderr(`Error: directory does not exist: ${cli.repoRoot}`)
    process.exit(1)
  }

  // VALIDATE mode: load seed, validate, report, exit
  if (cli.mode === 'validate') {
    if (!seedFileExists(cli.repoRoot)) {
      stderr(`No ${SEED_FILENAME} found in ${cli.repoRoot}`)
      process.exit(1)
    }
    const seed = readSeedFile(cli.repoRoot)
    if (!seed) {
      stderr(`Failed to parse ${SEED_FILENAME}`)
      process.exit(1)
    }
    const issues = validateSeedFile(cli.repoRoot, seed)
    if (issues.length === 0) {
      stderr('No issues found.')
    } else {
      for (const issue of issues) {
        stderr(`[${issue.severity}] ${issue.message}`)
      }
      if (issues.some(i => i.severity === 'error')) process.exit(1)
    }
    return
  }

  stderr(`Scanning ${cli.repoRoot}...`)

  // 1. Read metadata
  const context = readProjectContext(cli.repoRoot, cli.title)
  const title = context.title

  // 2. Scan
  const scanned = scanWorkstreams(cli.repoRoot)
  mapTestFiles(cli.repoRoot, scanned)
  const rootArtifacts = scanRootFiles(cli.repoRoot)
  stderr(`Found ${scanned.length} workstreams: ${scanned.map(w => w.name).join(', ') || '(none)'}`)

  // 3. Enrich
  const depGraph = buildDependencyGraph(scanned, path.join(cli.repoRoot, 'src'))

  // 4. Build enriched workstream definitions
  const descService = cli.noLlm || !process.env.ANTHROPIC_API_KEY
    ? new HeuristicDescriptionService()
    : new LlmDescriptionService(process.env.ANTHROPIC_API_KEY!)

  const workstreams: WorkstreamDefinition[] = []
  for (const ws of scanned) {
    // Collect JSDoc candidates
    const jsDocs = collectJsDocCandidates(ws.name, ws.dirPath, ws.files, cli.repoRoot)

    // Parse barrel exports if applicable
    let exports: string[] | undefined
    if (ws.hasBarrelIndex) {
      const indexPath = path.join(ws.dirPath, 'index.ts')
      exports = parseBarrelExports(indexPath)
      if (exports.length === 0) exports = undefined
    }

    // Fallback: extract file exports if no barrel
    if (!exports || exports.length === 0) {
      const fileExports = new Set<string>()
      for (const f of ws.files) {
        const absPath = path.join(cli.repoRoot, f)
        for (const sym of extractFileExports(absPath)) {
          fileExports.add(sym)
        }
      }
      if (fileExports.size > 0) {
        const arr = Array.from(fileExports)
        exports = arr.slice(0, 20)
      }
    }

    // Get dependencies
    const deps = depGraph.get(ws.id)

    // Use description service for better descriptions
    let desc: string
    if (ws.name === 'integration') {
      desc = 'Cross-cutting integration and end-to-end test suite'
    } else {
      const result = await descService.synthesize({
        workstreamName: ws.name,
        fileNames: ws.files,
        existingJsDocs: jsDocs,
        barrelExports: exports,
        dependencies: deps,
      })
      desc = result.description
    }

    workstreams.push({
      id: ws.id,
      name: ws.name,
      description: desc,
      keyFiles: pickKeyFiles(ws.files, 10),
      status: 'active' as const,
      exports,
      dependencies: deps && deps.length > 0 ? deps : undefined,
      _autoDescription: true,
    })
  }

  // 5. Build artifacts (cap 20 per workstream)
  const artifacts = buildArtifacts(scanned, rootArtifacts, 20, cli.repoRoot)
  stderr(`Found ${artifacts.length} artifacts`)

  // 6. Assemble payload
  const gitInfo = getGitInfo(cli.repoRoot)
  const payload: ProjectSeedPayload = {
    schemaVersion: 1,
    project: {
      title: context.title,
      description: context.description,
      goals: context.goals,
      checkpoints: context.checkpoints,
      constraints: context.constraints,
      framework: context.framework,
    },
    workstreams,
    artifacts,
    repoRoot: cli.repoRoot,
    provenance: {
      source: 'bootstrap-cli',
      gitCommit: gitInfo.commit,
      gitBranch: gitInfo.branch,
      repoRoot: cli.repoRoot,
      scannedAt: new Date().toISOString(),
    },
    defaultTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    defaultConstraints: context.constraints,
    defaultEscalation: {
      alwaysEscalate: ['Deleting files', 'Modifying CI/CD', 'Changing public API'],
      neverEscalate: ['Formatting', 'Adding comments'],
    },
  }

  // DIFF mode: compare existing seed against fresh scan, print, exit
  if (cli.mode === 'diff') {
    if (!seedFileExists(cli.repoRoot)) {
      stderr(`No ${SEED_FILENAME} found in ${cli.repoRoot}. Run --init first.`)
      process.exit(1)
    }
    const existing = readSeedFile(cli.repoRoot)
    if (!existing) {
      stderr(`Failed to parse ${SEED_FILENAME}`)
      process.exit(1)
    }
    const diff = computeSeedDiff(existing, payload)
    stderr(formatDiff(diff))
    return
  }

  // 7. Merge with existing seed if applicable
  let finalPayload = payload
  if ((cli.mode === 'default' || cli.mode === 'refresh') && seedFileExists(cli.repoRoot)) {
    const existing = readSeedFile(cli.repoRoot)
    if (existing) {
      stderr(`Merging with existing ${SEED_FILENAME}...`)
      finalPayload = mergeSeeds(existing, payload)
    }
  }

  const json = JSON.stringify(finalPayload, null, 2)

  // 8. Output
  if (cli.dryRun) {
    stderr('[dry-run] Would produce payload:')
    stderr(`  Title: ${title}`)
    stderr(`  Description: ${context.description}`)
    stderr(`  Workstreams: ${workstreams.length}`)
    stderr(`  Artifacts: ${artifacts.length}`)
    if (cli.output) stderr(`  Would write to: ${cli.output}`)
    if (cli.post) stderr(`  Would POST to: ${cli.server}/api/project/seed`)
    if (cli.mode === 'init' || cli.mode === 'refresh') stderr(`  Would write ${SEED_FILENAME}`)
    return
  }

  if (cli.mode === 'init' || cli.mode === 'refresh') {
    writeSeedFile(cli.repoRoot, finalPayload)
    stderr(`Wrote ${SEED_FILENAME}`)
  } else if (cli.output) {
    fs.writeFileSync(cli.output, json + '\n', 'utf-8')
    stderr(`Writing seed payload to ${cli.output}`)
  } else if (!cli.post) {
    stderr('Writing seed payload to stdout...')
    process.stdout.write(json + '\n')
  }

  if (cli.post) {
    const url = `${cli.server}/api/project/seed`
    stderr(`POSTing seed payload to ${url}...`)
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    })
    if (!resp.ok) {
      stderr(`Error: server returned ${resp.status} ${resp.statusText}`)
      const body = await resp.text()
      if (body) stderr(body)
      process.exit(1)
    }
    const result = await resp.json()
    stderr('Server response:')
    stderr(JSON.stringify(result, null, 2))
  }
}

main().catch((err) => {
  stderr(`Fatal: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
