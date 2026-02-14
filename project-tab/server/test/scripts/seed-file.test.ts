import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ProjectSeedPayload, WorkstreamDefinition } from '../../src/types/project-config.js'
import {
  SEED_FILENAME,
  seedFileExists,
  readSeedFile,
  writeSeedFile,
  mergeSeeds,
  validateSeedFile,
  detectCircularDependencies,
  computeSeedDiff,
  formatDiff,
} from '../../scripts/lib/seed-file'
import type { SeedDiff } from '../../scripts/lib/seed-file'

// ── Helpers ──────────────────────────────────────────────────────────

function makeSeedPayload(overrides?: Partial<ProjectSeedPayload>): ProjectSeedPayload {
  return {
    project: {
      title: 'Test Project',
      description: 'A test project',
      goals: ['Goal 1'],
      checkpoints: ['Checkpoint 1'],
    },
    workstreams: [],
    ...overrides,
  }
}

function makeWorkstream(overrides?: Partial<WorkstreamDefinition>): WorkstreamDefinition {
  return {
    id: 'ws-test',
    name: 'test',
    description: 'Test workstream',
    keyFiles: [],
    ...overrides,
  }
}

// ── Test suite ───────────────────────────────────────────────────────

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-file-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('seedFileExists', () => {
  it('returns false when no seed file exists', () => {
    expect(seedFileExists(tmpDir)).toBe(false)
  })

  it('returns true when seed file exists', () => {
    fs.writeFileSync(path.join(tmpDir, SEED_FILENAME), '{}', 'utf-8')
    expect(seedFileExists(tmpDir)).toBe(true)
  })
})

describe('readSeedFile', () => {
  it('returns null when file does not exist', () => {
    expect(readSeedFile(tmpDir)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, SEED_FILENAME), 'not json', 'utf-8')
    expect(readSeedFile(tmpDir)).toBeNull()
  })

  it('parses valid seed file', () => {
    const payload = makeSeedPayload()
    fs.writeFileSync(path.join(tmpDir, SEED_FILENAME), JSON.stringify(payload), 'utf-8')
    const result = readSeedFile(tmpDir)
    expect(result).toEqual(payload)
  })
})

describe('writeSeedFile', () => {
  it('writes JSON with 2-space indent and trailing newline', () => {
    const payload = makeSeedPayload()
    writeSeedFile(tmpDir, payload)
    const raw = fs.readFileSync(path.join(tmpDir, SEED_FILENAME), 'utf-8')
    expect(raw).toBe(JSON.stringify(payload, null, 2) + '\n')
  })
})

describe('mergeSeeds', () => {
  it('preserves human-edited description (no _autoDescription)', () => {
    const existing = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway', description: 'My custom desc' }),
      ],
    })
    const scanned = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway', description: 'Auto-generated desc' }),
      ],
    })

    const merged = mergeSeeds(existing, scanned)
    const ws = merged.workstreams.find((w) => w.id === 'gateway')!
    expect(ws.description).toBe('My custom desc')
  })

  it('overwrites auto description when _autoDescription is true', () => {
    const existing = makeSeedPayload({
      workstreams: [
        makeWorkstream({
          id: 'gateway',
          description: 'Old auto desc',
          _autoDescription: true,
        }),
      ],
    })
    const scanned = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway', description: 'New auto desc' }),
      ],
    })

    const merged = mergeSeeds(existing, scanned)
    const ws = merged.workstreams.find((w) => w.id === 'gateway')!
    expect(ws.description).toBe('New auto desc')
  })

  it('adds new workstreams from scan with _autoDescription: true', () => {
    const existing = makeSeedPayload({
      workstreams: [makeWorkstream({ id: 'gateway' })],
    })
    const scanned = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway' }),
        makeWorkstream({ id: 'routes', description: 'Routes workstream' }),
      ],
    })

    const merged = mergeSeeds(existing, scanned)
    expect(merged.workstreams).toHaveLength(2)
    const newWs = merged.workstreams.find((w) => w.id === 'routes')!
    expect(newWs).toBeDefined()
    expect(newWs._autoDescription).toBe(true)
    expect(newWs.description).toBe('Routes workstream')
  })

  it('preserves workstream status from existing', () => {
    const existing = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway', status: 'paused' }),
      ],
    })
    const scanned = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway', status: 'active' }),
      ],
    })

    const merged = mergeSeeds(existing, scanned)
    const ws = merged.workstreams.find((w) => w.id === 'gateway')!
    expect(ws.status).toBe('paused')
  })

  it('overwrites keyFiles/exports/dependencies from scan', () => {
    const existing = makeSeedPayload({
      workstreams: [
        makeWorkstream({
          id: 'gateway',
          keyFiles: ['old/file.ts'],
          exports: ['OldExport'],
          dependencies: ['old-dep'],
        }),
      ],
    })
    const scanned = makeSeedPayload({
      workstreams: [
        makeWorkstream({
          id: 'gateway',
          keyFiles: ['new/file.ts', 'new/other.ts'],
          exports: ['NewExport'],
          dependencies: ['new-dep'],
        }),
      ],
    })

    const merged = mergeSeeds(existing, scanned)
    const ws = merged.workstreams.find((w) => w.id === 'gateway')!
    expect(ws.keyFiles).toEqual(['new/file.ts', 'new/other.ts'])
    expect(ws.exports).toEqual(['NewExport'])
    expect(ws.dependencies).toEqual(['new-dep'])
  })

  it('preserves project.goals and project.checkpoints from existing', () => {
    const existing = makeSeedPayload({
      project: {
        title: 'Human Title',
        description: 'Human desc',
        goals: ['Human goal'],
        checkpoints: ['Human checkpoint'],
      },
    })
    const scanned = makeSeedPayload({
      project: {
        title: 'Scanned Title',
        description: 'Scanned desc',
        goals: ['Scanned goal'],
        checkpoints: ['Scanned checkpoint'],
      },
    })

    const merged = mergeSeeds(existing, scanned)
    expect(merged.project.title).toBe('Human Title')
    expect(merged.project.description).toBe('Human desc')
    expect(merged.project.goals).toEqual(['Human goal'])
    expect(merged.project.checkpoints).toEqual(['Human checkpoint'])
  })

  it('preserves defaultTools, defaultConstraints, and defaultEscalation from existing', () => {
    const existing = makeSeedPayload({
      defaultTools: ['Read', 'Write'],
      defaultConstraints: ['No force push'],
      defaultEscalation: {
        alwaysEscalate: ['Delete files'],
        neverEscalate: ['Formatting'],
      },
    })
    const scanned = makeSeedPayload({
      defaultTools: ['Bash'],
      defaultConstraints: ['Different constraint'],
      defaultEscalation: {
        alwaysEscalate: ['Something else'],
      },
    })

    const merged = mergeSeeds(existing, scanned)
    expect(merged.defaultTools).toEqual(['Read', 'Write'])
    expect(merged.defaultConstraints).toEqual(['No force push'])
    expect(merged.defaultEscalation).toEqual({
      alwaysEscalate: ['Delete files'],
      neverEscalate: ['Formatting'],
    })
  })

  it('overwrites artifacts from scanned', () => {
    const existing = makeSeedPayload({
      artifacts: [{ name: 'old.ts', kind: 'code', workstream: 'gateway' }],
    })
    const scanned = makeSeedPayload({
      artifacts: [{ name: 'new.ts', kind: 'code', workstream: 'routes' }],
    })

    const merged = mergeSeeds(existing, scanned)
    expect(merged.artifacts).toEqual([
      { name: 'new.ts', kind: 'code', workstream: 'routes' },
    ])
  })

  it('keeps removed workstreams that are in existing but not in scanned', () => {
    const customManual = makeWorkstream({
      id: 'custom-manual',
      name: 'Custom Manual',
      description: 'A manually defined workstream',
      keyFiles: ['src/custom/index.ts'],
    })
    const existing = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway' }),
        customManual,
      ],
    })
    const scanned = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway' }),
        // custom-manual is NOT in scanned
      ],
    })

    const merged = mergeSeeds(existing, scanned)
    expect(merged.workstreams).toHaveLength(2)
    const kept = merged.workstreams.find((w) => w.id === 'custom-manual')!
    expect(kept).toBeDefined()
    expect(kept.name).toBe('Custom Manual')
    expect(kept.description).toBe('A manually defined workstream')
    expect(kept.keyFiles).toEqual(['src/custom/index.ts'])
  })

  it('does not mutate its inputs', () => {
    const existing = makeSeedPayload({
      workstreams: [makeWorkstream({ id: 'gateway', keyFiles: ['old.ts'] })],
      artifacts: [{ name: 'old.ts', kind: 'code', workstream: 'gateway' }],
      defaultTools: ['Read'],
    })
    const scanned = makeSeedPayload({
      workstreams: [makeWorkstream({ id: 'gateway', keyFiles: ['new.ts'] })],
      artifacts: [{ name: 'new.ts', kind: 'code', workstream: 'routes' }],
      defaultTools: ['Bash'],
    })

    const existingClone = structuredClone(existing)
    const scannedClone = structuredClone(scanned)

    mergeSeeds(existing, scanned)

    expect(existing).toEqual(existingClone)
    expect(scanned).toEqual(scannedClone)
  })
})

describe('validateSeedFile', () => {
  it('catches missing files in keyFiles', () => {
    const payload = makeSeedPayload({
      workstreams: [
        makeWorkstream({
          id: 'gateway',
          keyFiles: ['src/gateway/nonexistent.ts'],
        }),
      ],
    })

    // Create src/gateway/ directory so the workstream itself is valid
    fs.mkdirSync(path.join(tmpDir, 'src', 'gateway'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src', 'gateway', 'index.ts'), '', 'utf-8')

    const issues = validateSeedFile(tmpDir, payload)
    const errors = issues.filter((i) => i.severity === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0].message).toContain('keyFile not found')
    expect(errors[0].message).toContain('nonexistent.ts')
  })

  it('warns about src/ directories not in seed workstreams', () => {
    // Create a src/foo/ directory with a .ts file
    fs.mkdirSync(path.join(tmpDir, 'src', 'foo'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src', 'foo', 'bar.ts'), '', 'utf-8')

    // Seed has no workstream for "foo"
    const payload = makeSeedPayload({ workstreams: [] })

    const issues = validateSeedFile(tmpDir, payload)
    const warnings = issues.filter((i) => i.severity === 'warning')
    expect(warnings.some((w) => w.message.includes('src/foo/'))).toBe(true)
  })

  it('warns about workstreams with no matching src/ directory', () => {
    // No src/ directory at all
    const payload = makeSeedPayload({
      workstreams: [makeWorkstream({ id: 'phantom', keyFiles: [] })],
    })

    const issues = validateSeedFile(tmpDir, payload)
    const warnings = issues.filter(
      (i) => i.severity === 'warning' && i.message.includes('phantom'),
    )
    expect(warnings.length).toBeGreaterThanOrEqual(1)
  })

  it('does not warn for "core" or "integration" workstreams without matching directory', () => {
    const payload = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'core', keyFiles: [] }),
        makeWorkstream({ id: 'integration', keyFiles: [] }),
      ],
    })

    const issues = validateSeedFile(tmpDir, payload)
    const warnings = issues.filter(
      (i) =>
        i.severity === 'warning' &&
        (i.message.includes('"core"') || i.message.includes('"integration"')),
    )
    expect(warnings).toHaveLength(0)
  })

  it('warns about artifact URIs that do not exist on disk', () => {
    const payload = makeSeedPayload({
      artifacts: [
        { name: 'ghost.ts', kind: 'code', workstream: 'gateway', uri: 'src/gateway/ghost.ts' },
      ],
    })

    const issues = validateSeedFile(tmpDir, payload)
    const warnings = issues.filter(
      (i) => i.severity === 'warning' && i.message.includes('artifact URI not found'),
    )
    expect(warnings.length).toBeGreaterThanOrEqual(1)
    expect(warnings[0].message).toContain('ghost.ts')
  })
})

describe('detectCircularDependencies', () => {
  it('detects A->B->A cycle', () => {
    const cycles = detectCircularDependencies([
      makeWorkstream({ id: 'A', dependencies: ['B'] }),
      makeWorkstream({ id: 'B', dependencies: ['A'] }),
    ])
    expect(cycles.length).toBeGreaterThanOrEqual(1)
    // The cycle should contain both A and B
    const flat = cycles.flat()
    expect(flat).toContain('A')
    expect(flat).toContain('B')
  })

  it('returns empty for acyclic graph', () => {
    const cycles = detectCircularDependencies([
      makeWorkstream({ id: 'A', dependencies: ['B'] }),
      makeWorkstream({ id: 'B', dependencies: [] }),
    ])
    expect(cycles).toEqual([])
  })

  it('detects longer cycles A->B->C->A', () => {
    const cycles = detectCircularDependencies([
      makeWorkstream({ id: 'A', dependencies: ['B'] }),
      makeWorkstream({ id: 'B', dependencies: ['C'] }),
      makeWorkstream({ id: 'C', dependencies: ['A'] }),
    ])
    expect(cycles.length).toBeGreaterThanOrEqual(1)
  })

  it('handles workstreams with no dependencies', () => {
    const cycles = detectCircularDependencies([
      makeWorkstream({ id: 'A' }),
      makeWorkstream({ id: 'B' }),
    ])
    expect(cycles).toEqual([])
  })
})

describe('validateSeedFile - new checks', () => {
  it('warns about circular dependencies', () => {
    const payload = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway', dependencies: ['routes'] }),
        makeWorkstream({ id: 'routes', dependencies: ['gateway'] }),
      ],
    })
    // Create matching src dirs
    fs.mkdirSync(path.join(tmpDir, 'src', 'gateway'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src', 'gateway', 'index.ts'), '', 'utf-8')
    fs.mkdirSync(path.join(tmpDir, 'src', 'routes'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src', 'routes', 'index.ts'), '', 'utf-8')

    const issues = validateSeedFile(tmpDir, payload)
    expect(issues.some(i => i.message.includes('circular dependency'))).toBe(true)
  })

  it('warns about workstreams with no test directory', () => {
    const payload = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway', keyFiles: [] }),
      ],
    })
    fs.mkdirSync(path.join(tmpDir, 'src', 'gateway'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src', 'gateway', 'index.ts'), '', 'utf-8')
    // No test/gateway/ directory

    const issues = validateSeedFile(tmpDir, payload)
    expect(issues.some(i => i.message.includes('no test directory'))).toBe(true)
  })

  it('does not warn about test directory for core or integration', () => {
    const payload = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'core', keyFiles: [] }),
        makeWorkstream({ id: 'integration', keyFiles: [] }),
      ],
    })

    const issues = validateSeedFile(tmpDir, payload)
    const testWarnings = issues.filter(i => i.message.includes('no test directory'))
    expect(testWarnings).toHaveLength(0)
  })

  it('warns about workstreams with no exports and no barrel', () => {
    const payload = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway', keyFiles: [], exports: undefined }),
      ],
    })
    fs.mkdirSync(path.join(tmpDir, 'src', 'gateway'), { recursive: true })
    // No index.ts in gateway

    const issues = validateSeedFile(tmpDir, payload)
    expect(issues.some(i => i.message.includes('no exports and no barrel'))).toBe(true)
  })

  it('does not warn about exports for workstreams with barrel index', () => {
    const payload = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway', keyFiles: [], exports: undefined }),
      ],
    })
    fs.mkdirSync(path.join(tmpDir, 'src', 'gateway'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src', 'gateway', 'index.ts'), 'export const x = 1', 'utf-8')

    const issues = validateSeedFile(tmpDir, payload)
    expect(issues.some(i => i.message.includes('no exports and no barrel'))).toBe(false)
  })

  it('no false positive for workstreams with exports', () => {
    const payload = makeSeedPayload({
      workstreams: [
        makeWorkstream({ id: 'gateway', keyFiles: [], exports: ['Foo', 'Bar'] }),
      ],
    })
    fs.mkdirSync(path.join(tmpDir, 'src', 'gateway'), { recursive: true })

    const issues = validateSeedFile(tmpDir, payload)
    expect(issues.some(i => i.message.includes('no exports and no barrel'))).toBe(false)
  })
})

describe('computeSeedDiff', () => {
  it('detects new workstream', () => {
    const existing = makeSeedPayload({ workstreams: [makeWorkstream({ id: 'gateway' })] })
    const scanned = makeSeedPayload({ workstreams: [
      makeWorkstream({ id: 'gateway' }),
      makeWorkstream({ id: 'routes' }),
    ]})
    const diff = computeSeedDiff(existing, scanned)
    expect(diff.newWorkstreams).toContain('routes')
    expect(diff.removedWorkstreams).toHaveLength(0)
  })

  it('detects removed workstream', () => {
    const existing = makeSeedPayload({ workstreams: [
      makeWorkstream({ id: 'gateway' }),
      makeWorkstream({ id: 'routes' }),
    ]})
    const scanned = makeSeedPayload({ workstreams: [makeWorkstream({ id: 'gateway' })] })
    const diff = computeSeedDiff(existing, scanned)
    expect(diff.removedWorkstreams).toContain('routes')
    expect(diff.newWorkstreams).toHaveLength(0)
  })

  it('detects keyFile changes', () => {
    const existing = makeSeedPayload({ workstreams: [
      makeWorkstream({ id: 'gateway', keyFiles: ['old.ts'] }),
    ]})
    const scanned = makeSeedPayload({ workstreams: [
      makeWorkstream({ id: 'gateway', keyFiles: ['old.ts', 'new.ts'] }),
    ]})
    const diff = computeSeedDiff(existing, scanned)
    const ws = diff.updatedWorkstreams.find(w => w.id === 'gateway')
    expect(ws).toBeDefined()
    expect(ws!.keyFilesAdded).toContain('new.ts')
    expect(ws!.keyFilesRemoved).toHaveLength(0)
  })

  it('detects preserved human description', () => {
    const existing = makeSeedPayload({ workstreams: [
      makeWorkstream({ id: 'gateway', description: 'Human desc', _autoDescription: false }),
    ]})
    const scanned = makeSeedPayload({ workstreams: [
      makeWorkstream({ id: 'gateway', description: 'Auto desc', _autoDescription: true }),
    ]})
    const diff = computeSeedDiff(existing, scanned)
    const ws = diff.updatedWorkstreams.find(w => w.id === 'gateway')
    expect(ws).toBeDefined()
    expect(ws!.descriptionPreserved).toBe(true)
    expect(ws!.descriptionChanged).toBe(false)
  })

  it('detects artifact count changes', () => {
    const existing = makeSeedPayload({
      artifacts: [{ name: 'a.ts', kind: 'code', workstream: 'gw' }],
    })
    const scanned = makeSeedPayload({
      artifacts: [
        { name: 'a.ts', kind: 'code', workstream: 'gw' },
        { name: 'b.ts', kind: 'code', workstream: 'gw' },
      ],
    })
    const diff = computeSeedDiff(existing, scanned)
    expect(diff.artifactCountChange.before).toBe(1)
    expect(diff.artifactCountChange.after).toBe(2)
  })

  it('returns no changes for identical payloads', () => {
    const payload = makeSeedPayload({ workstreams: [makeWorkstream({ id: 'gateway' })] })
    const diff = computeSeedDiff(payload, structuredClone(payload))
    expect(diff.newWorkstreams).toHaveLength(0)
    expect(diff.removedWorkstreams).toHaveLength(0)
  })

  it('detects export changes', () => {
    const existing = makeSeedPayload({ workstreams: [
      makeWorkstream({ id: 'gateway', exports: ['Foo', 'Bar'] }),
    ]})
    const scanned = makeSeedPayload({ workstreams: [
      makeWorkstream({ id: 'gateway', exports: ['Bar', 'Baz'] }),
    ]})
    const diff = computeSeedDiff(existing, scanned)
    const ws = diff.updatedWorkstreams.find(w => w.id === 'gateway')
    expect(ws).toBeDefined()
    expect(ws!.exportsAdded).toContain('Baz')
    expect(ws!.exportsRemoved).toContain('Foo')
  })

  it('detects dependency changes', () => {
    const existing = makeSeedPayload({ workstreams: [
      makeWorkstream({ id: 'gateway', dependencies: ['routes'] }),
    ]})
    const scanned = makeSeedPayload({ workstreams: [
      makeWorkstream({ id: 'gateway', dependencies: ['routes', 'intelligence'] }),
    ]})
    const diff = computeSeedDiff(existing, scanned)
    const ws = diff.updatedWorkstreams.find(w => w.id === 'gateway')
    expect(ws).toBeDefined()
    expect(ws!.depsAdded).toContain('intelligence')
    expect(ws!.depsRemoved).toHaveLength(0)
  })

  it('detects auto description change', () => {
    const existing = makeSeedPayload({ workstreams: [
      makeWorkstream({ id: 'gateway', description: 'Old auto', _autoDescription: true }),
    ]})
    const scanned = makeSeedPayload({ workstreams: [
      makeWorkstream({ id: 'gateway', description: 'New auto', _autoDescription: true }),
    ]})
    const diff = computeSeedDiff(existing, scanned)
    const ws = diff.updatedWorkstreams.find(w => w.id === 'gateway')
    expect(ws).toBeDefined()
    expect(ws!.descriptionChanged).toBe(true)
    expect(ws!.descriptionPreserved).toBe(false)
  })
})

describe('formatDiff', () => {
  it('returns "No changes detected." for empty diff', () => {
    const diff: SeedDiff = {
      newWorkstreams: [],
      removedWorkstreams: [],
      updatedWorkstreams: [],
      artifactCountChange: { before: 5, after: 5 },
    }
    expect(formatDiff(diff)).toBe('No changes detected.')
  })

  it('formats new and removed workstreams', () => {
    const diff: SeedDiff = {
      newWorkstreams: ['routes'],
      removedWorkstreams: ['legacy'],
      updatedWorkstreams: [],
      artifactCountChange: { before: 0, after: 0 },
    }
    const output = formatDiff(diff)
    expect(output).toContain('+ routes')
    expect(output).toContain('- legacy')
  })

  it('formats updated workstreams with changes', () => {
    const diff: SeedDiff = {
      newWorkstreams: [],
      removedWorkstreams: [],
      updatedWorkstreams: [{
        id: 'gateway',
        descriptionChanged: true,
        descriptionPreserved: false,
        keyFilesAdded: ['new.ts'],
        keyFilesRemoved: [],
        exportsAdded: ['Foo', 'Bar'],
        exportsRemoved: [],
        depsAdded: [],
        depsRemoved: ['old-dep'],
      }],
      artifactCountChange: { before: 3, after: 3 },
    }
    const output = formatDiff(diff)
    expect(output).toContain('~ gateway')
    expect(output).toContain('description changed')
    expect(output).toContain('+1 keyFiles')
    expect(output).toContain('+2 exports')
    expect(output).toContain('-1 deps')
  })

  it('formats artifact count changes', () => {
    const diff: SeedDiff = {
      newWorkstreams: [],
      removedWorkstreams: [],
      updatedWorkstreams: [],
      artifactCountChange: { before: 3, after: 7 },
    }
    const output = formatDiff(diff)
    expect(output).toContain('Artifacts: 3 -> 7')
  })

  it('formats preserved description', () => {
    const diff: SeedDiff = {
      newWorkstreams: [],
      removedWorkstreams: [],
      updatedWorkstreams: [{
        id: 'gateway',
        descriptionChanged: false,
        descriptionPreserved: true,
        keyFilesAdded: [],
        keyFilesRemoved: [],
        exportsAdded: [],
        exportsRemoved: [],
        depsAdded: [],
        depsRemoved: [],
      }],
      artifactCountChange: { before: 0, after: 0 },
    }
    const output = formatDiff(diff)
    expect(output).toContain('description preserved (human-edited)')
  })
})
