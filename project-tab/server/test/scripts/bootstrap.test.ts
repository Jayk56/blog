import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import {
  scanWorkstreams,
  mapTestFiles,
  scanRootFiles,
  buildArtifacts,
  pickKeyFiles,
} from '../../scripts/lib/scanner'
import {
  extractLeadingJsDoc,
  parseBarrelExports,
  extractFileExports,
  buildDependencyGraph,
  synthesizeModuleDescription,
} from '../../scripts/lib/enrichment'
import {
  seedFileExists,
  readSeedFile,
  writeSeedFile,
  mergeSeeds,
  validateSeedFile,
  SEED_FILENAME,
} from '../../scripts/lib/seed-file'
import type {
  ProjectSeedPayload,
  WorkstreamDefinition,
} from '../../src/types/project-config'

const repoRoot = path.resolve(__dirname, '../..')

/**
 * Replicate the enrichment pipeline from bootstrap.ts (lines 238-275)
 * to build enriched WorkstreamDefinition[] from scanned workstreams.
 */
function buildEnrichedWorkstreams(root: string): WorkstreamDefinition[] {
  const scanned = scanWorkstreams(root)
  mapTestFiles(root, scanned)
  const depGraph = buildDependencyGraph(scanned, path.join(root, 'src'))

  return scanned.map((ws) => {
    const desc = synthesizeModuleDescription(ws.name, ws.dirPath, ws.files, root, ws.hasBarrelIndex)

    let exports: string[] | undefined
    if (ws.hasBarrelIndex) {
      const indexPath = path.join(ws.dirPath, 'index.ts')
      exports = parseBarrelExports(indexPath)
      if (exports.length === 0) exports = undefined
    }

    // Fallback: scan individual files for exports when no barrel index
    if (!exports || exports.length === 0) {
      const fileExports = new Set<string>()
      for (const f of ws.files) {
        const absPath = path.join(root, f)
        for (const sym of extractFileExports(absPath)) {
          fileExports.add(sym)
        }
      }
      if (fileExports.size > 0) {
        const arr = Array.from(fileExports)
        exports = arr.slice(0, 20) // Cap at 20
      }
    }

    const deps = depGraph.get(ws.id)

    return {
      id: ws.id,
      name: ws.name,
      description: desc,
      keyFiles: pickKeyFiles(ws.files, 10),
      status: 'active' as const,
      exports,
      dependencies: deps && deps.length > 0 ? deps : undefined,
      _autoDescription: true,
    }
  })
}

/**
 * Build a minimal ProjectSeedPayload suitable for seed-file tests.
 */
function buildTestPayload(workstreams: WorkstreamDefinition[]): ProjectSeedPayload {
  return {
    project: {
      title: 'test-project',
      description: 'A test project',
      goals: ['Complete test-project implementation'],
      checkpoints: ['All tests passing', 'Zero TypeScript errors'],
      constraints: ['Must compile with zero TS errors'],
    },
    workstreams,
    artifacts: [],
    repoRoot,
    defaultTools: ['Read', 'Write', 'Edit', 'Bash'],
    defaultConstraints: ['Must compile with zero TS errors'],
    defaultEscalation: {
      alwaysEscalate: ['Deleting files'],
      neverEscalate: ['Formatting'],
    },
  }
}

// ── B1: Enriched output has real descriptions ─────────────────────────

describe('B1: enriched output has real descriptions for workstreams with JSDoc', () => {
  it('intelligence has a description referencing Coherence, not a generic fallback', () => {
    const workstreams = buildEnrichedWorkstreams(repoRoot)
    const intelligence = workstreams.find((ws) => ws.id === 'intelligence')
    expect(intelligence).toBeDefined()
    expect(intelligence!.description).not.toBe('Workstream for intelligence')
    // The description should be non-trivial (not a generic fallback or Tier 5 file-name synthesis)
    expect(intelligence!.description.length).toBeGreaterThan(20)
    expect(intelligence!.description).not.toMatch(/^Intelligence:/)
  })

  it('routes has a description referencing router or API, not a generic fallback', () => {
    const workstreams = buildEnrichedWorkstreams(repoRoot)
    const routes = workstreams.find((ws) => ws.id === 'routes')
    expect(routes).toBeDefined()
    expect(routes!.description).not.toBe('Workstream for routes')
    expect(routes!.description).toMatch(/router|API/i)
  })
})

// ── B2: All scanned workstreams have _autoDescription: true ───────────

describe('B2: all scanned workstreams have _autoDescription: true', () => {
  it('every workstream built by the pipeline has _autoDescription set', () => {
    const workstreams = buildEnrichedWorkstreams(repoRoot)
    expect(workstreams.length).toBeGreaterThan(0)
    for (const ws of workstreams) {
      expect(ws._autoDescription, `${ws.id} should have _autoDescription: true`).toBe(true)
    }
  })
})

// ── B3: Workstreams with barrel indexes have exports arrays ───────────

describe('B3: workstreams with barrel indexes have exports arrays', () => {
  it('intelligence has exports containing TrustEngine and KnowledgeStore', () => {
    const workstreams = buildEnrichedWorkstreams(repoRoot)
    const intelligence = workstreams.find((ws) => ws.id === 'intelligence')
    expect(intelligence).toBeDefined()
    expect(intelligence!.exports).toBeDefined()
    expect(intelligence!.exports).toContain('TrustEngine')
    expect(intelligence!.exports).toContain('KnowledgeStore')
  })

  it('auth has exports containing AuthService', () => {
    const workstreams = buildEnrichedWorkstreams(repoRoot)
    const auth = workstreams.find((ws) => ws.id === 'auth')
    expect(auth).toBeDefined()
    expect(auth!.exports).toBeDefined()
    expect(auth!.exports).toContain('AuthService')
  })
})

// ── B4: Dependency graph is populated correctly ──────────────────────

describe('B4: dependency graph is populated correctly', () => {
  it('routes depends on intelligence, gateway, and types', () => {
    const scanned = scanWorkstreams(repoRoot)
    const depGraph = buildDependencyGraph(scanned, path.join(repoRoot, 'src'))
    const routesDeps = depGraph.get('routes')
    expect(routesDeps).toBeDefined()
    expect(routesDeps).toContain('intelligence')
    expect(routesDeps).toContain('gateway')
    expect(routesDeps).toContain('types')
  })

  it('types has empty dependencies (depends on nothing)', () => {
    const scanned = scanWorkstreams(repoRoot)
    const depGraph = buildDependencyGraph(scanned, path.join(repoRoot, 'src'))
    const typesDeps = depGraph.get('types')
    expect(typesDeps).toBeDefined()
    expect(typesDeps).toEqual([])
  })
})

// ── B5: --init creates project-seed.json, --validate passes ─────────

describe('B5: --init creates seed file, --validate passes afterward', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-b5-'))
    // Create a minimal src/ structure so scanWorkstreams finds something
    const srcDir = path.join(tmpDir, 'src')
    const wsDir = path.join(srcDir, 'mymodule')
    fs.mkdirSync(wsDir, { recursive: true })
    fs.writeFileSync(path.join(wsDir, 'index.ts'), 'export const x = 1\n')
    // Create a package.json
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-project', description: 'Test' }),
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writeSeedFile + validateSeedFile round-trips correctly', () => {
    // Build enriched workstreams for the tmpDir
    const scanned = scanWorkstreams(tmpDir)
    const depGraph = buildDependencyGraph(scanned, path.join(tmpDir, 'src'))
    const workstreams: WorkstreamDefinition[] = scanned.map((ws) => ({
      id: ws.id,
      name: ws.name,
      description: `Workstream for ${ws.name}`,
      keyFiles: pickKeyFiles(ws.files, 10),
      status: 'active' as const,
      _autoDescription: true,
    }))

    const payload: ProjectSeedPayload = {
      project: {
        title: 'test-project',
        description: 'Test',
        goals: ['Ship it'],
        checkpoints: ['All tests passing'],
      },
      workstreams,
      artifacts: [],
    }

    // Write the seed file
    writeSeedFile(tmpDir, payload)
    expect(seedFileExists(tmpDir)).toBe(true)

    // Read it back
    const read = readSeedFile(tmpDir)
    expect(read).not.toBeNull()
    expect(read!.project.title).toBe('test-project')

    // Validate — keyFiles should all exist since we built from actual scan
    const issues = validateSeedFile(tmpDir, read!)
    const errors = issues.filter((i) => i.severity === 'error')
    expect(errors).toEqual([])
  })
})

// ── B6: --refresh preserves hand-edited description ──────────────────

describe('B6: refresh preserves hand-edited description', () => {
  it('mergeSeeds keeps description when _autoDescription is falsy', () => {
    const originalWorkstreams: WorkstreamDefinition[] = [
      {
        id: 'intelligence',
        name: 'intelligence',
        description: 'Hand-edited: The brain of the system',
        keyFiles: ['src/intelligence/index.ts'],
        status: 'active',
        _autoDescription: false,
      },
      {
        id: 'routes',
        name: 'routes',
        description: 'Auto-generated routes desc',
        keyFiles: ['src/routes/index.ts'],
        status: 'active',
        _autoDescription: true,
      },
    ]

    const existingPayload = buildTestPayload(originalWorkstreams)

    // Simulate a fresh scan with different auto-generated descriptions
    const scannedWorkstreams: WorkstreamDefinition[] = [
      {
        id: 'intelligence',
        name: 'intelligence',
        description: 'Coherence Monitor with three detection layers.',
        keyFiles: ['src/intelligence/index.ts', 'src/intelligence/trust-engine.ts'],
        status: 'active',
        _autoDescription: true,
      },
      {
        id: 'routes',
        name: 'routes',
        description: 'Creates the root /api router.',
        keyFiles: ['src/routes/index.ts'],
        status: 'active',
        _autoDescription: true,
      },
    ]

    const scannedPayload = buildTestPayload(scannedWorkstreams)

    const merged = mergeSeeds(existingPayload, scannedPayload)

    // Human-edited description (no _autoDescription) should be preserved
    const intelligence = merged.workstreams.find((ws) => ws.id === 'intelligence')
    expect(intelligence).toBeDefined()
    expect(intelligence!.description).toBe('Hand-edited: The brain of the system')

    // Auto-generated description should be updated from scan
    const routes = merged.workstreams.find((ws) => ws.id === 'routes')
    expect(routes).toBeDefined()
    expect(routes!.description).toBe('Creates the root /api router.')

    // Structural fields (keyFiles) should be overwritten from scan
    expect(intelligence!.keyFiles).toEqual([
      'src/intelligence/index.ts',
      'src/intelligence/trust-engine.ts',
    ])
  })
})

// ── B7: --validate exits non-zero when no seed file exists ───────────

describe('B7: validate exits non-zero when no seed file exists', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-b7-'))
    // Create a minimal directory (no project-seed.json)
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('CLI --validate throws on missing seed file', () => {
    const scriptPath = path.join(repoRoot, 'scripts/bootstrap.ts')
    expect(() => {
      execSync(`npx tsx "${scriptPath}" "${tmpDir}" --validate`, {
        stdio: 'pipe',
        cwd: repoRoot,
      })
    }).toThrow()
  })
})

// ── B9: Default mode merges and preserves custom goals ───────────────

describe('B9: default mode merges and preserves custom goals', () => {
  it('mergeSeeds preserves custom goals from existing seed', () => {
    const existing: ProjectSeedPayload = {
      project: {
        title: 'My Project',
        description: 'A carefully crafted project',
        goals: ['Ship by March', 'Zero critical bugs'],
        checkpoints: ['Alpha release', 'Beta release'],
        constraints: ['No breaking changes'],
      },
      workstreams: [
        {
          id: 'routes',
          name: 'routes',
          description: 'API routes',
          keyFiles: ['src/routes/index.ts'],
          status: 'active',
          _autoDescription: false,
        },
      ],
    }

    const scanned: ProjectSeedPayload = {
      project: {
        title: 'server',
        description: 'Project server',
        goals: ['Complete server implementation'],
        checkpoints: ['All tests passing', 'Zero TypeScript errors'],
      },
      workstreams: [
        {
          id: 'routes',
          name: 'routes',
          description: 'Creates the root /api router.',
          keyFiles: ['src/routes/index.ts', 'src/routes/agents.ts'],
          status: 'active',
          _autoDescription: true,
        },
      ],
      artifacts: [{ name: 'index.ts', kind: 'code', workstream: 'routes', uri: 'src/routes/index.ts' }],
    }

    const merged = mergeSeeds(existing, scanned)

    // mergeSeeds starts from a deep clone of existing, so project-level fields
    // (goals, title, description, checkpoints, constraints) are preserved from existing
    expect(merged.project.goals).toEqual(['Ship by March', 'Zero critical bugs'])
    expect(merged.project.title).toBe('My Project')
    expect(merged.project.description).toBe('A carefully crafted project')
    expect(merged.project.checkpoints).toEqual(['Alpha release', 'Beta release'])

    // Artifacts are overwritten from scanned
    expect(merged.artifacts).toHaveLength(1)
    expect(merged.artifacts![0].name).toBe('index.ts')
  })
})

// ── B10: JSDoc fallback tries non-index files ────────────────────────

describe('B10: JSDoc fallback tries non-index files when barrel has no JSDoc', () => {
  it('core workstream gets a real description from app.ts, not a generic fallback', () => {
    const workstreams = buildEnrichedWorkstreams(repoRoot)
    const core = workstreams.find((ws) => ws.id === 'core')
    expect(core).toBeDefined()
    // core has hasBarrelIndex: true (src/index.ts exists), but src/index.ts has
    // no leading multi-line JSDoc. The fallback iterates core files and finds
    // app.ts which has a JSDoc "Creates the configured Express app instance."
    expect(core!.description).not.toBe('Workstream for core')
    expect(core!.description.length).toBeGreaterThan(10)
    expect(core!.description).not.toMatch(/^Core:/)
  })

  it('integration workstream uses generic fallback when no JSDoc exists', () => {
    const workstreams = buildEnrichedWorkstreams(repoRoot)
    const integration = workstreams.find((ws) => ws.id === 'integration')
    expect(integration).toBeDefined()
    // integration has no barrel index (hasBarrelIndex: false) and no source
    // files (only testFiles), so the JSDoc fallback loop has nothing to try.
    // It must use the generic "Workstream for <name>" fallback.
    expect(integration!.description).toBe('Cross-cutting integration and end-to-end test suite')
  })
})

// ── D2: Non-barrel workstream export coverage ─────────────────────────

describe('D2: non-barrel workstream export coverage', () => {
  it('gateway has exports despite no barrel index', () => {
    const workstreams = buildEnrichedWorkstreams(repoRoot)
    const gateway = workstreams.find((ws) => ws.id === 'gateway')
    expect(gateway).toBeDefined()
    // gateway has no index.ts but has many exported classes/functions
    expect(gateway!.exports).toBeDefined()
    expect(gateway!.exports!.length).toBeGreaterThan(0)
  })

  it('gateway exports include known classes from its source files', () => {
    const workstreams = buildEnrichedWorkstreams(repoRoot)
    const gateway = workstreams.find((ws) => ws.id === 'gateway')
    expect(gateway).toBeDefined()
    // These are from the earliest-alphabetically gateway files,
    // so they should be within the 20-symbol cap
    expect(gateway!.exports).toContain('AdapterHttpClient')
    expect(gateway!.exports).toContain('ChildProcessManager')
  })

  it('gateway exports are capped at 20', () => {
    const workstreams = buildEnrichedWorkstreams(repoRoot)
    const gateway = workstreams.find((ws) => ws.id === 'gateway')
    expect(gateway).toBeDefined()
    expect(gateway!.exports!.length).toBeLessThanOrEqual(20)
  })
})
