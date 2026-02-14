import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import {
  detectFrameworks,
  synthesizeProjectDescription,
  inferGoalsFromScripts,
  inferCheckpointsFromScripts,
  inferConstraintsFromConfig,
  readProjectContext,
} from '../../scripts/lib/context'
import type { FrameworkInfo } from '../../scripts/lib/context'
import * as fs from 'node:fs'

const repoRoot = path.resolve(__dirname, '../..')

// ── detectFrameworks ─────────────────────────────────────────────────

describe('detectFrameworks', () => {
  it('detects Express from dependencies', () => {
    const info = detectFrameworks({ dependencies: { express: '^5' } })
    expect(info.primary).toBe('Express.js')
  })

  it('detects SQLite from better-sqlite3', () => {
    const info = detectFrameworks({ dependencies: { 'better-sqlite3': '^12' } })
    expect(info.persistence).toContain('SQLite (better-sqlite3)')
  })

  it('detects JWT from jose', () => {
    const info = detectFrameworks({ dependencies: { jose: '^6' } })
    expect(info.auth).toContain('JWT (jose)')
  })

  it('detects Vitest from devDependencies', () => {
    const info = detectFrameworks({ devDependencies: { vitest: '^4' } })
    expect(info.testing).toContain('Vitest')
  })

  it('returns empty categories for unknown deps', () => {
    const info = detectFrameworks({ dependencies: { 'some-random-lib': '1.0' } })
    expect(info.primary).toBe('')
    expect(info.persistence).toEqual([])
    expect(info.auth).toEqual([])
    expect(info.realtime).toEqual([])
    expect(info.validation).toEqual([])
    expect(info.testing).toEqual([])
    expect(info.containerization).toEqual([])
    expect(info.language).toBe('JavaScript')
  })

  it('detects the real project-tab-server package.json correctly', () => {
    const pkgPath = path.join(repoRoot, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    const info = detectFrameworks(pkg)
    expect(info.primary).toBe('Express.js')
    expect(info.persistence).toContain('SQLite (better-sqlite3)')
    expect(info.auth).toContain('JWT (jose)')
    expect(info.realtime).toContain('WebSocket (ws)')
    expect(info.validation).toContain('Zod')
    expect(info.testing).toContain('Vitest')
    expect(info.containerization).toContain('Docker (dockerode)')
    expect(info.language).toBe('TypeScript')
  })
})

// ── synthesizeProjectDescription ─────────────────────────────────────

describe('synthesizeProjectDescription', () => {
  it('produces description mentioning Express, SQLite, and JWT when all detected', () => {
    const frameworks: FrameworkInfo = {
      primary: 'Express.js',
      persistence: ['SQLite (better-sqlite3)'],
      auth: ['JWT (jose)'],
      realtime: [],
      validation: [],
      testing: ['Vitest'],
      language: 'TypeScript',
      containerization: [],
    }
    const desc = synthesizeProjectDescription(frameworks)
    expect(desc).toContain('Express.js')
    expect(desc).toContain('SQLite (better-sqlite3)')
    expect(desc).toContain('JWT (jose)')
  })

  it('produces "Node.js server" prefix when no primary framework detected', () => {
    const frameworks: FrameworkInfo = {
      primary: '',
      persistence: ['PostgreSQL'],
      auth: [],
      realtime: [],
      validation: [],
      testing: [],
      language: 'JavaScript',
      containerization: [],
    }
    const desc = synthesizeProjectDescription(frameworks)
    expect(desc).toMatch(/^Node\.js server/)
  })
})

// ── inferGoalsFromScripts ────────────────────────────────────────────

describe('inferGoalsFromScripts', () => {
  it('infers "All tests passing" from { test: "vitest run" }', () => {
    const goals = inferGoalsFromScripts({ test: 'vitest run' })
    expect(goals).toContain('All tests passing')
  })

  it('infers "Clean TypeScript compilation" from { typecheck: "tsc --noEmit" }', () => {
    const goals = inferGoalsFromScripts({ typecheck: 'tsc --noEmit' })
    expect(goals.some(g => g.includes('TypeScript compilation'))).toBe(true)
  })

  it('produces default goal when no scripts', () => {
    const goals = inferGoalsFromScripts({})
    expect(goals).toEqual(['Complete implementation'])
  })
})

// ── inferCheckpointsFromScripts ──────────────────────────────────────

describe('inferCheckpointsFromScripts', () => {
  it('detects Vitest from { test: "vitest run" }', () => {
    const checkpoints = inferCheckpointsFromScripts({ test: 'vitest run' })
    expect(checkpoints).toContain('All Vitest tests passing')
  })

  it('produces build checkpoint from { build: "tsc -p tsconfig.json" }', () => {
    const checkpoints = inferCheckpointsFromScripts({ build: 'tsc -p tsconfig.json' })
    expect(checkpoints).toContain('Successful production build')
  })
})

// ── inferConstraintsFromConfig ───────────────────────────────────────

describe('inferConstraintsFromConfig', () => {
  it('detects strict mode from { compilerOptions: { strict: true } }', () => {
    const constraints = inferConstraintsFromConfig({ compilerOptions: { strict: true } }, null)
    expect(constraints.some(c => c.includes('strict mode'))).toBe(true)
  })

  it('detects ESM from { type: "module" }', () => {
    const constraints = inferConstraintsFromConfig(null, { type: 'module' })
    expect(constraints.some(c => c.includes('ESM'))).toBe(true)
  })

  it('always includes test passing constraint even with null inputs', () => {
    const constraints = inferConstraintsFromConfig(null, null)
    expect(constraints.some(c => c.includes('Must pass existing tests'))).toBe(true)
  })
})

// ── readProjectContext (against real repo) ───────────────────────────

describe('readProjectContext', () => {
  it('produces non-boilerplate description (not "Project project-tab-server")', () => {
    const ctx = readProjectContext(repoRoot)
    expect(ctx.description).not.toBe('Project project-tab-server')
    expect(ctx.description.length).toBeGreaterThan(20)
  })

  it('description mentions Express or API', () => {
    const ctx = readProjectContext(repoRoot)
    expect(ctx.description).toMatch(/Express|API/i)
  })

  it('goals array has more than 1 entry', () => {
    const ctx = readProjectContext(repoRoot)
    expect(ctx.goals.length).toBeGreaterThan(1)
  })

  it('constraints include strict mode mention', () => {
    const ctx = readProjectContext(repoRoot)
    expect(ctx.constraints.some(c => c.includes('strict'))).toBe(true)
  })

  it('framework string is non-empty and mentions Express', () => {
    const ctx = readProjectContext(repoRoot)
    expect(ctx.framework.length).toBeGreaterThan(0)
    expect(ctx.framework).toContain('Express')
  })
})
