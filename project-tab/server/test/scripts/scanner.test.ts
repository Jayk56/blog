import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import {
  scanWorkstreams,
  mapTestFiles,
  scanRootFiles,
  buildArtifacts,
  listTsFiles,
  classifyFile,
  pickKeyFiles,
} from '../../scripts/lib/scanner.js'

const repoRoot = path.resolve(__dirname, '../..')

describe('scanner', () => {
  describe('scanWorkstreams', () => {
    it('finds all 10 workstreams (9 subdirs + core)', () => {
      const ws = scanWorkstreams(repoRoot)
      const ids = ws.map((w) => w.id).sort()
      expect(ids).toEqual([
        'auth',
        'core',
        'gateway',
        'identity',
        'intelligence',
        'lib',
        'registry',
        'routes',
        'types',
        'validation',
      ])
    })

    it('includes registry (1 file) and identity (2 files) with no threshold', () => {
      const ws = scanWorkstreams(repoRoot)
      const registry = ws.find((w) => w.id === 'registry')
      const identity = ws.find((w) => w.id === 'identity')
      expect(registry).toBeDefined()
      expect(registry!.files.length).toBeGreaterThanOrEqual(1)
      expect(identity).toBeDefined()
      expect(identity!.files.length).toBeGreaterThanOrEqual(2)
    })

    it('core workstream has root files like app.ts, bus.ts, tick.ts', () => {
      const ws = scanWorkstreams(repoRoot)
      const core = ws.find((w) => w.id === 'core')
      expect(core).toBeDefined()
      const basenames = core!.files.map((f) => path.basename(f))
      expect(basenames).toContain('app.ts')
      expect(basenames).toContain('bus.ts')
      expect(basenames).toContain('tick.ts')
    })

    it('excludes .d.ts files from all workstreams', () => {
      const ws = scanWorkstreams(repoRoot)
      for (const w of ws) {
        for (const f of w.files) {
          expect(f).not.toMatch(/\.d\.ts$/)
        }
      }
    })
  })

  describe('mapTestFiles', () => {
    it('maps test/gateway/ files to gateway workstream testFiles', () => {
      const ws = scanWorkstreams(repoRoot)
      mapTestFiles(repoRoot, ws)
      const gateway = ws.find((w) => w.id === 'gateway')
      expect(gateway).toBeDefined()
      expect(gateway!.testFiles.length).toBeGreaterThan(0)
      // Expect at least one file from test/gateway/
      const hasGatewayTest = gateway!.testFiles.some((f) =>
        f.startsWith(path.join('test', 'gateway')),
      )
      expect(hasGatewayTest).toBe(true)
    })

    it('maps test/bus.test.ts to core workstream testFiles', () => {
      const ws = scanWorkstreams(repoRoot)
      mapTestFiles(repoRoot, ws)
      const core = ws.find((w) => w.id === 'core')
      expect(core).toBeDefined()
      const basenames = core!.testFiles.map((f) => path.basename(f))
      expect(basenames).toContain('bus.test.ts')
    })
  })

  describe('scanRootFiles', () => {
    it('returns config artifacts for tsconfig.json and package.json', () => {
      const rootArtifacts = scanRootFiles(repoRoot)
      const names = rootArtifacts.map((a) => a.name)
      expect(names).toContain('tsconfig.json')
      expect(names).toContain('package.json')
      // All root artifacts should have workstream: 'root'
      for (const a of rootArtifacts) {
        expect(a.workstream).toBe('root')
      }
    })
  })

  describe('buildArtifacts', () => {
    it('includes test files with kind test', () => {
      const ws = scanWorkstreams(repoRoot)
      mapTestFiles(repoRoot, ws)
      const rootArtifacts = scanRootFiles(repoRoot)
      const artifacts = buildArtifacts(ws, rootArtifacts, 100)

      // Should have at least one test artifact
      const testArtifacts = artifacts.filter((a) => a.kind === 'test')
      expect(testArtifacts.length).toBeGreaterThan(0)

      // Every test file should have kind: 'test'
      for (const ws_ of ws) {
        for (const tf of ws_.testFiles) {
          const match = artifacts.find((a) => a.uri === tf)
          if (match) {
            expect(match.kind).toBe('test')
          }
        }
      }
    })

    it('S5: respects cap per workstream', () => {
      const ws = scanWorkstreams(repoRoot)
      mapTestFiles(repoRoot, ws)
      const rootArtifacts = scanRootFiles(repoRoot)
      const cap = 2
      const artifacts = buildArtifacts(ws, rootArtifacts, cap)

      // Count artifacts per workstream (excluding root)
      const countByWs = new Map<string, number>()
      for (const a of artifacts) {
        if (a.workstream === 'root') continue
        countByWs.set(a.workstream, (countByWs.get(a.workstream) ?? 0) + 1)
      }

      // At least one workstream must have been actually capped
      // (i.e., had more potential artifacts than the cap allows)
      const intelligence = ws.find((w) => w.id === 'intelligence')
      expect(
        intelligence!.files.length + intelligence!.testFiles.length,
        'intelligence should have more files than cap to verify capping works',
      ).toBeGreaterThan(cap)

      // No workstream should exceed the cap
      for (const [wsId, count] of countByWs) {
        expect(count, `workstream "${wsId}" has ${count} artifacts, cap is ${cap}`).toBeLessThanOrEqual(cap)
      }

      // Root artifacts are still present (not subject to cap)
      const rootCount = artifacts.filter((a) => a.workstream === 'root').length
      expect(rootCount).toBeGreaterThan(0)
    })
  })

  describe('mapTestFiles — integration pseudo-workstream', () => {
    it('S1: creates an "integration" pseudo-workstream with e2e and integration files', () => {
      const ws = scanWorkstreams(repoRoot)
      mapTestFiles(repoRoot, ws)
      const integration = ws.find((w) => w.id === 'integration')
      expect(integration).toBeDefined()

      // Should contain files from test/integration/ and/or test/e2e/
      const hasIntegrationFile = integration!.testFiles.some((f) =>
        f.startsWith(path.join('test', 'integration')),
      )
      const hasE2eFile = integration!.testFiles.some((f) =>
        f.startsWith(path.join('test', 'e2e')),
      )
      expect(hasIntegrationFile || hasE2eFile).toBe(true)
      // The real repo has both directories with .ts files
      expect(hasIntegrationFile).toBe(true)
      expect(hasE2eFile).toBe(true)
    })

    it('S2: does not include test/helpers/ in any workstream', () => {
      const ws = scanWorkstreams(repoRoot)
      mapTestFiles(repoRoot, ws)
      for (const w of ws) {
        for (const tf of w.testFiles) {
          expect(tf).not.toMatch(/^test[/\\]helpers[/\\]/)
        }
      }
    })
  })

  describe('scanWorkstreams — hasBarrelIndex', () => {
    it('S4: reflects index.ts existence per workstream', () => {
      const ws = scanWorkstreams(repoRoot)
      const byId = new Map(ws.map((w) => [w.id, w]))

      // These workstreams have src/<name>/index.ts
      for (const id of ['auth', 'intelligence', 'routes', 'types', 'identity']) {
        expect(byId.get(id)?.hasBarrelIndex, `${id} should have barrel index`).toBe(true)
      }

      // These workstreams do NOT have src/<name>/index.ts
      for (const id of ['gateway', 'registry', 'validation']) {
        expect(byId.get(id)?.hasBarrelIndex, `${id} should NOT have barrel index`).toBe(false)
      }
    })
  })

  describe('pickKeyFiles', () => {
    it('S7: puts index.ts first and tests last', () => {
      const input = ['src/foo/bar.test.ts', 'src/foo/baz.ts', 'src/foo/index.ts']
      const result = pickKeyFiles(input, 10)
      expect(result[0]).toBe('src/foo/index.ts')
      expect(result[1]).toBe('src/foo/baz.ts')
      expect(result[2]).toBe('src/foo/bar.test.ts')
    })

    it('S7: cap limits the number of returned files', () => {
      const input = ['src/foo/bar.test.ts', 'src/foo/baz.ts', 'src/foo/index.ts']
      const result = pickKeyFiles(input, 2)
      expect(result).toHaveLength(2)
      // First two should be index.ts and baz.ts (tests sorted last, so excluded by cap)
      expect(result[0]).toBe('src/foo/index.ts')
      expect(result[1]).toBe('src/foo/baz.ts')
    })
  })
})
