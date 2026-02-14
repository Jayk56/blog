import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import {
  extractLeadingJsDoc,
  parseBarrelExports,
  extractDependencies,
  buildDependencyGraph,
  extractFileExports,
} from '../../scripts/lib/enrichment'

const repoRoot = path.resolve(__dirname, '../..')

describe('extractLeadingJsDoc', () => {
  it('extracts JSDoc from intelligence/knowledge-store.ts', () => {
    const result = extractLeadingJsDoc(
      path.join(repoRoot, 'src/intelligence/knowledge-store.ts'),
    )
    expect(result).toBeDefined()
    // The JSDoc describes the SQLite-backed KnowledgeStore
    expect(result).toMatch(/SQLite|KnowledgeStore|WAL/)
  })

  it('returns undefined for a file with no qualifying JSDoc', () => {
    // src/index.ts starts with imports, no JSDoc before exports
    const result = extractLeadingJsDoc(
      path.join(repoRoot, 'src/index.ts'),
    )
    expect(result).toBeUndefined()
  })
})

describe('parseBarrelExports', () => {
  it('parses intelligence/index.ts barrel exports', () => {
    const result = parseBarrelExports(
      path.join(repoRoot, 'src/intelligence/index.ts'),
    )
    // Should contain known class/type exports
    expect(result).toContain('TrustEngine')
    expect(result).toContain('DecisionQueue')
    expect(result).toContain('KnowledgeStore')
    expect(result).toContain('CoherenceMonitor')
  })

  it('handles export type { ... } patterns', () => {
    const result = parseBarrelExports(
      path.join(repoRoot, 'src/intelligence/index.ts'),
    )
    // These are `export type { ... }` re-exports
    expect(result).toContain('TrustOutcome')
    expect(result).toContain('QueuedDecision')
    expect(result).toContain('CoherenceMonitorConfig')
    expect(result).toContain('EmbeddingService')
  })

  it('handles export * from patterns in types/index.ts', () => {
    const result = parseBarrelExports(
      path.join(repoRoot, 'src/types/index.ts'),
    )
    // types/index.ts uses `export * from './...'` patterns
    expect(result).toContain('*')
  })
})

describe('extractDependencies', () => {
  it('finds that intelligence/ depends on types/', () => {
    const allIds = new Map([
      ['intelligence', 'ws-intelligence'],
      ['types', 'ws-types'],
      ['gateway', 'ws-gateway'],
      ['routes', 'ws-routes'],
      ['auth', 'ws-auth'],
      ['validation', 'ws-validation'],
      ['registry', 'ws-registry'],
      ['identity', 'ws-identity'],
    ])

    const deps = extractDependencies(
      path.join(repoRoot, 'src/intelligence'),
      allIds,
      'ws-intelligence',
    )
    expect(deps).toContain('ws-types')
  })
})

describe('buildDependencyGraph', () => {
  const workstreams = [
    { id: 'ws-auth', dirPath: path.join(repoRoot, 'src/auth') },
    { id: 'ws-gateway', dirPath: path.join(repoRoot, 'src/gateway') },
    { id: 'ws-identity', dirPath: path.join(repoRoot, 'src/identity') },
    { id: 'ws-intelligence', dirPath: path.join(repoRoot, 'src/intelligence') },
    { id: 'ws-registry', dirPath: path.join(repoRoot, 'src/registry') },
    { id: 'ws-routes', dirPath: path.join(repoRoot, 'src/routes') },
    { id: 'ws-types', dirPath: path.join(repoRoot, 'src/types') },
    { id: 'ws-validation', dirPath: path.join(repoRoot, 'src/validation') },
  ]

  it('produces a valid dependency map for all workstreams', () => {
    const graph = buildDependencyGraph(workstreams, path.join(repoRoot, 'src'))
    expect(graph.size).toBe(workstreams.length)
    // Every workstream should have an entry
    for (const ws of workstreams) {
      expect(graph.has(ws.id)).toBe(true)
    }
  })

  it('routes workstream depends on intelligence, gateway, and types', () => {
    const graph = buildDependencyGraph(workstreams, path.join(repoRoot, 'src'))
    const routeDeps = graph.get('ws-routes')!
    expect(routeDeps).toContain('ws-intelligence')
    expect(routeDeps).toContain('ws-gateway')
    expect(routeDeps).toContain('ws-types')
  })

  it('no workstream depends on itself', () => {
    const graph = buildDependencyGraph(workstreams, path.join(repoRoot, 'src'))
    for (const [wsId, deps] of graph) {
      expect(deps).not.toContain(wsId)
    }
  })
})

// ─── Gap Coverage Tests (E1–E8, E11) ────────────────────────────────

describe('parseBarrelExports – multi-line export blocks', () => {
  // E1: BUG — multi-line export blocks are not parsed by current implementation
  it('E1: handles multi-line export blocks in auth/index.ts', () => {
    const result = parseBarrelExports(
      path.join(repoRoot, 'src/auth/index.ts'),
    )
    // auth/index.ts uses multi-line export { ... } from '...' blocks
    expect(result).toContain('AuthService')
    expect(result).toContain('createAuthMiddleware')
  })

  // E11: BUG — same multi-line issue on identity/index.ts
  it('E11: handles multi-line export blocks in identity/index.ts', () => {
    const result = parseBarrelExports(
      path.join(repoRoot, 'src/identity/index.ts'),
    )
    // identity/index.ts uses multi-line export { ... } from '...' blocks
    expect(result).toContain('JwtService')
  })
})

describe('parseBarrelExports – synthetic barrel files', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrichment-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // E2: BUG — multi-line blocks with inline type keyword not parsed
  it('E2: handles inline type keyword in multi-line export blocks', () => {
    const file = path.join(tmpDir, 'index.ts')
    fs.writeFileSync(
      file,
      `export {\n  Foo,\n  type Bar,\n  type Baz,\n} from './x'\n`,
    )
    const result = parseBarrelExports(file)
    expect(result).toContain('Foo')
    expect(result).toContain('Bar')
    expect(result).toContain('Baz')
  })

  // E3: export class declaration
  it('E3: handles export class declaration', () => {
    const file = path.join(tmpDir, 'index.ts')
    fs.writeFileSync(file, 'export class Qux {}\n')
    const result = parseBarrelExports(file)
    expect(result).toContain('Qux')
  })

  // E4: export function declaration
  it('E4: handles export function declaration', () => {
    const file = path.join(tmpDir, 'index.ts')
    fs.writeFileSync(file, 'export function doThing() {}\n')
    const result = parseBarrelExports(file)
    expect(result).toContain('doThing')
  })

  // E5: export const declaration
  it('E5: handles export const declaration', () => {
    const file = path.join(tmpDir, 'index.ts')
    fs.writeFileSync(file, 'export const THING = 42\n')
    const result = parseBarrelExports(file)
    expect(result).toContain('THING')
  })

  // E6: as-rename — should return the exported (renamed) name
  it('E6: handles as-rename and returns the exported name', () => {
    const file = path.join(tmpDir, 'index.ts')
    fs.writeFileSync(file, "export { Foo as Bar } from './x'\n")
    const result = parseBarrelExports(file)
    expect(result).toContain('Bar')
    expect(result).not.toContain('Foo')
  })

  // E7: deduplication — same symbol exported from two sources
  it('E7: deduplicates symbols exported multiple times', () => {
    const file = path.join(tmpDir, 'index.ts')
    fs.writeFileSync(
      file,
      "export { Foo } from './a'\nexport { Foo } from './b'\n",
    )
    const result = parseBarrelExports(file)
    const fooCount = result.filter(s => s === 'Foo').length
    expect(fooCount).toBe(1)
  })
})

describe('extractLeadingJsDoc – single-line JSDoc', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrichment-jsdoc-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // E8: single-line JSDoc blocks should not qualify (requires >= 3 lines)
  it('E8: ignores single-line JSDoc blocks', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, '/** Short doc */\nexport function x() {}\n')
    const result = extractLeadingJsDoc(file)
    expect(result).toBeUndefined()
  })
})

// ─── D2: extractFileExports tests ────────────────────────────────────

describe('extractFileExports', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrichment-file-exports-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('extracts class declarations', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, 'export class Foo {}\n')
    const result = extractFileExports(file)
    expect(result).toEqual(['Foo'])
  })

  it('extracts function declarations', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, 'export function bar() {}\n')
    const result = extractFileExports(file)
    expect(result).toEqual(['bar'])
  })

  it('extracts const declarations', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, 'export const BAZ = 1\n')
    const result = extractFileExports(file)
    expect(result).toEqual(['BAZ'])
  })

  it('extracts interface declarations', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, 'export interface Qux {}\n')
    const result = extractFileExports(file)
    expect(result).toEqual(['Qux'])
  })

  it('extracts export { A, B } from re-exports', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, "export { A, B } from './x'\n")
    const result = extractFileExports(file)
    expect(result).toContain('A')
    expect(result).toContain('B')
  })

  it('extracts export { C } without from clause', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, 'const C = 42\nexport { C }\n')
    const result = extractFileExports(file)
    expect(result).toContain('C')
  })

  it('returns empty array for nonexistent file', () => {
    const result = extractFileExports(path.join(tmpDir, 'nope.ts'))
    expect(result).toEqual([])
  })

  it('returns empty array for file with no exports', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, 'const x = 1\nfunction y() {}\n')
    const result = extractFileExports(file)
    expect(result).toEqual([])
  })

  it('handles export type declarations', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, 'export type MyType = string | number\n')
    const result = extractFileExports(file)
    expect(result).toEqual(['MyType'])
  })

  it('handles export enum declarations', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, 'export enum Status { Active, Inactive }\n')
    const result = extractFileExports(file)
    expect(result).toEqual(['Status'])
  })

  it('handles async function exports', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, 'export async function fetchData() {}\n')
    const result = extractFileExports(file)
    expect(result).toEqual(['fetchData'])
  })

  it('deduplicates symbols across multiple declarations', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, "export class Foo {}\nexport { Foo } from './other'\n")
    const result = extractFileExports(file)
    const fooCount = result.filter(s => s === 'Foo').length
    expect(fooCount).toBe(1)
  })

  it('handles multi-line export blocks', () => {
    const file = path.join(tmpDir, 'example.ts')
    fs.writeFileSync(file, "export {\n  Alpha,\n  Beta,\n  type Gamma,\n} from './mod'\n")
    const result = extractFileExports(file)
    expect(result).toContain('Alpha')
    expect(result).toContain('Beta')
    expect(result).toContain('Gamma')
  })

  it('extracts exports from a real gateway file', () => {
    const result = extractFileExports(
      path.join(repoRoot, 'src/gateway/port-pool.ts'),
    )
    expect(result).toContain('PortPool')
    expect(result).toContain('pollHealth')
  })
})
