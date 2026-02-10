import { describe, expect, it } from 'vitest'

import { CoherenceMonitor } from '../../src/intelligence/coherence-monitor'
import type { ArtifactEvent } from '../../src/types/events'

function makeArtifact(overrides: Partial<ArtifactEvent> = {}): ArtifactEvent {
  return {
    type: 'artifact',
    agentId: 'agent-1',
    artifactId: `art-${Math.random().toString(36).slice(2, 8)}`,
    name: 'main.ts',
    kind: 'code',
    workstream: 'ws-backend',
    status: 'draft',
    qualityScore: 0.8,
    provenance: {
      createdBy: 'agent-1',
      createdAt: new Date().toISOString(),
      sourcePath: '/src/main.ts'
    },
    ...overrides
  }
}

describe('CoherenceMonitor', () => {
  describe('path ownership tracking', () => {
    it('registers ownership for new path', () => {
      const monitor = new CoherenceMonitor()
      const result = monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          artifactId: 'art-1',
          provenance: {
            createdBy: 'a-1',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/app.ts'
          }
        })
      )

      expect(result).toBeUndefined() // no conflict
      const ownership = monitor.getPathOwnership()
      expect(ownership.get('/src/app.ts')).toEqual({
        agentId: 'a-1',
        artifactId: 'art-1'
      })
    })

    it('allows same agent to write to same path without conflict', () => {
      const monitor = new CoherenceMonitor()

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          artifactId: 'art-1',
          provenance: {
            createdBy: 'a-1',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/app.ts'
          }
        })
      )

      const result = monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          artifactId: 'art-2',
          provenance: {
            createdBy: 'a-1',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/app.ts'
          }
        })
      )

      expect(result).toBeUndefined()
    })
  })

  describe('conflict detection', () => {
    it('detects conflict when different agent writes to same path', () => {
      const monitor = new CoherenceMonitor()

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          artifactId: 'art-1',
          provenance: {
            createdBy: 'a-1',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/config.ts'
          }
        })
      )

      const conflict = monitor.processArtifact(
        makeArtifact({
          agentId: 'a-2',
          artifactId: 'art-2',
          workstream: 'ws-frontend',
          provenance: {
            createdBy: 'a-2',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/config.ts'
          }
        })
      )

      expect(conflict).toBeDefined()
      expect(conflict!.type).toBe('coherence')
      expect(conflict!.category).toBe('duplication')
      expect(conflict!.severity).toBe('high')
      expect(conflict!.title).toContain('/src/config.ts')
      expect(conflict!.description).toContain('a-1')
      expect(conflict!.description).toContain('a-2')
      expect(conflict!.affectedArtifactIds).toContain('art-1')
      expect(conflict!.affectedArtifactIds).toContain('art-2')
    })

    it('updates ownership after conflict to latest writer', () => {
      const monitor = new CoherenceMonitor()

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          artifactId: 'art-1',
          provenance: {
            createdBy: 'a-1',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/index.ts'
          }
        })
      )

      // Agent 2 writes - conflict detected
      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-2',
          artifactId: 'art-2',
          provenance: {
            createdBy: 'a-2',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/index.ts'
          }
        })
      )

      // Agent 1 writes again - new conflict (a-2 is now owner)
      const secondConflict = monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          artifactId: 'art-3',
          provenance: {
            createdBy: 'a-1',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/index.ts'
          }
        })
      )

      expect(secondConflict).toBeDefined()
      expect(secondConflict!.description).toContain('a-2') // previous owner
    })

    it('tracks multiple paths independently', () => {
      const monitor = new CoherenceMonitor()

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          artifactId: 'art-1',
          provenance: {
            createdBy: 'a-1',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/a.ts'
          }
        })
      )

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-2',
          artifactId: 'art-2',
          provenance: {
            createdBy: 'a-2',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/b.ts'
          }
        })
      )

      // No conflict - different paths
      expect(monitor.getDetectedIssues()).toHaveLength(0)
    })
  })

  describe('artifacts without sourcePath', () => {
    it('ignores artifacts without sourcePath', () => {
      const monitor = new CoherenceMonitor()

      const result = monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          provenance: {
            createdBy: 'a-1',
            createdAt: new Date().toISOString()
            // no sourcePath
          }
        })
      )

      expect(result).toBeUndefined()
      expect(monitor.getPathOwnership().size).toBe(0)
    })
  })

  describe('issue accumulation', () => {
    it('accumulates detected issues', () => {
      const monitor = new CoherenceMonitor()

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          artifactId: 'art-1',
          provenance: {
            createdBy: 'a-1',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/x.ts'
          }
        })
      )

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-2',
          artifactId: 'art-2',
          provenance: {
            createdBy: 'a-2',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/x.ts'
          }
        })
      )

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          artifactId: 'art-3',
          provenance: {
            createdBy: 'a-1',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/y.ts'
          }
        })
      )

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-3',
          artifactId: 'art-4',
          provenance: {
            createdBy: 'a-3',
            createdAt: new Date().toISOString(),
            sourcePath: '/src/y.ts'
          }
        })
      )

      expect(monitor.getDetectedIssues()).toHaveLength(2)
    })

    it('generates unique issue IDs', () => {
      const monitor = new CoherenceMonitor()

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          provenance: { createdBy: 'a-1', createdAt: new Date().toISOString(), sourcePath: '/a.ts' }
        })
      )
      const issue1 = monitor.processArtifact(
        makeArtifact({
          agentId: 'a-2',
          provenance: { createdBy: 'a-2', createdAt: new Date().toISOString(), sourcePath: '/a.ts' }
        })
      )

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          provenance: { createdBy: 'a-1', createdAt: new Date().toISOString(), sourcePath: '/b.ts' }
        })
      )
      const issue2 = monitor.processArtifact(
        makeArtifact({
          agentId: 'a-3',
          provenance: { createdBy: 'a-3', createdAt: new Date().toISOString(), sourcePath: '/b.ts' }
        })
      )

      expect(issue1!.issueId).not.toBe(issue2!.issueId)
    })
  })

  describe('reset', () => {
    it('clears all tracked state', () => {
      const monitor = new CoherenceMonitor()

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          provenance: { createdBy: 'a-1', createdAt: new Date().toISOString(), sourcePath: '/a.ts' }
        })
      )
      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-2',
          provenance: { createdBy: 'a-2', createdAt: new Date().toISOString(), sourcePath: '/a.ts' }
        })
      )

      expect(monitor.getDetectedIssues()).toHaveLength(1)
      expect(monitor.getPathOwnership().size).toBe(1)

      monitor.reset()

      expect(monitor.getDetectedIssues()).toHaveLength(0)
      expect(monitor.getPathOwnership().size).toBe(0)
    })

    it('allows re-use after reset without false conflicts', () => {
      const monitor = new CoherenceMonitor()

      monitor.processArtifact(
        makeArtifact({
          agentId: 'a-1',
          provenance: { createdBy: 'a-1', createdAt: new Date().toISOString(), sourcePath: '/a.ts' }
        })
      )

      monitor.reset()

      // Same path, different agent - no conflict because state was cleared
      const result = monitor.processArtifact(
        makeArtifact({
          agentId: 'a-2',
          provenance: { createdBy: 'a-2', createdAt: new Date().toISOString(), sourcePath: '/a.ts' }
        })
      )

      expect(result).toBeUndefined()
    })
  })
})
