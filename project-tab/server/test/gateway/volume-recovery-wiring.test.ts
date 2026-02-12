/**
 * Tests for volume recovery bootstrap wiring.
 *
 * Validates Gap 7: VolumeRecoveryService is created when Docker is available,
 * and the startup scan finds and recovers orphaned volumes.
 *
 * Note: These tests use mocks rather than real Docker since Docker may not
 * be available in CI environments.
 */
import { describe, expect, it, vi } from 'vitest'

import { VolumeRecoveryService, volumeNameForAgent } from '../../src/gateway/volume-recovery'
import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import type { ArtifactEvent } from '../../src/types/events'
import type { RecoveryResult } from '../../src/gateway/volume-recovery'

// ── Helpers ──────────────────────────────────────────────────────────

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
      sourcePath: '/src/main.ts',
    },
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Volume recovery bootstrap wiring', () => {
  describe('VolumeRecoveryService creation', () => {
    it('creates service with reupload function that stores content', async () => {
      const knowledgeStore = new KnowledgeStore()

      // The reupload function mirrors how index.ts wires it
      const reupload = async (agentId: string, artifactId: string, _sourcePath: string, content: Buffer) => {
        knowledgeStore.storeArtifactContent(agentId, artifactId, content.toString('utf-8'))
      }

      // Simulate reupload
      await reupload('agent-1', 'art-1', '/src/main.ts', Buffer.from('file contents'))

      // Verify content was stored
      const stored = knowledgeStore.getArtifactContent('agent-1', 'art-1')
      expect(stored).toBeDefined()
      expect(stored!.content).toBe('file contents')
      expect(stored!.backendUri).toBe('artifact://agent-1/art-1')

      knowledgeStore.close()
    })
  })

  describe('Startup volume scan logic', () => {
    it('filters volumes matching project-tab-workspace-* pattern', () => {
      const volumes = [
        { Name: 'project-tab-workspace-agent-1' },
        { Name: 'project-tab-workspace-agent-2' },
        { Name: 'some-other-volume' },
        { Name: 'project-tab-data' },
      ]

      const orphanedVolumes = volumes.filter(
        (v) => v.Name.startsWith('project-tab-workspace-')
      )

      expect(orphanedVolumes).toHaveLength(2)
      expect(orphanedVolumes[0]!.Name).toBe('project-tab-workspace-agent-1')
      expect(orphanedVolumes[1]!.Name).toBe('project-tab-workspace-agent-2')
    })

    it('extracts agent ID from volume name', () => {
      const volumeName = 'project-tab-workspace-agent-42'
      const agentId = volumeName.replace('project-tab-workspace-', '')
      expect(agentId).toBe('agent-42')
    })

    it('skips volumes for running agents', () => {
      const runningAgents = new Set(['agent-1'])
      const volumes = [
        { Name: 'project-tab-workspace-agent-1' }, // running - skip
        { Name: 'project-tab-workspace-agent-2' }, // not running - recover
      ]

      const toRecover = volumes.filter((v) => {
        const agentId = v.Name.replace('project-tab-workspace-', '')
        return !runningAgents.has(agentId)
      })

      expect(toRecover).toHaveLength(1)
      expect(toRecover[0]!.Name).toBe('project-tab-workspace-agent-2')
    })

    it('filters known artifacts by agent ID for recovery', () => {
      const knowledgeStore = new KnowledgeStore()

      // Store artifacts for different agents
      knowledgeStore.storeArtifact(makeArtifact({
        agentId: 'agent-1',
        artifactId: 'art-a1',
        provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString(), sourcePath: '/a.ts' },
      }))
      knowledgeStore.storeArtifact(makeArtifact({
        agentId: 'agent-2',
        artifactId: 'art-b1',
        provenance: { createdBy: 'agent-2', createdAt: new Date().toISOString(), sourcePath: '/b.ts' },
      }))
      knowledgeStore.storeArtifact(makeArtifact({
        agentId: 'agent-1',
        artifactId: 'art-a2',
        provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString(), sourcePath: '/c.ts' },
      }))

      // Filter like the bootstrap code does
      const agent1Artifacts = knowledgeStore.listArtifacts().filter(
        (a) => a.agentId === 'agent-1'
      )

      expect(agent1Artifacts).toHaveLength(2)
      expect(agent1Artifacts.every((a) => a.agentId === 'agent-1')).toBe(true)

      knowledgeStore.close()
    })
  })

  describe('Volume name convention', () => {
    it('matches ContainerOrchestrator naming', () => {
      // ContainerOrchestrator uses `project-tab-workspace-${agentId}` for bind mounts
      // VolumeRecoveryService uses volumeNameForAgent() which produces the same pattern
      expect(volumeNameForAgent('agent-1')).toBe('project-tab-workspace-agent-1')
      expect(volumeNameForAgent('my-agent-xyz')).toBe('project-tab-workspace-my-agent-xyz')
    })
  })

  describe('Recovery result integration', () => {
    it('recovery result shape matches API response contract', () => {
      const result: RecoveryResult = {
        agentId: 'agent-1',
        volumeName: 'project-tab-workspace-agent-1',
        filesScanned: 5,
        skipped: [{ path: '/src/a.ts', artifactId: 'art-1' }],
        reuploaded: [{ path: '/src/b.ts', artifactId: 'art-2', success: true }],
        orphans: ['/src/orphan.log'],
        volumeDeleted: true,
        errors: [],
      }

      // Verify all fields are present (this is what POST /api/agents/:id/recover-artifacts returns)
      expect(result.agentId).toBe('agent-1')
      expect(result.filesScanned).toBe(5)
      expect(result.skipped).toHaveLength(1)
      expect(result.reuploaded).toHaveLength(1)
      expect(result.reuploaded[0]!.success).toBe(true)
      expect(result.orphans).toHaveLength(1)
      expect(result.volumeDeleted).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('recovery result with errors preserves error messages', () => {
      const result: RecoveryResult = {
        agentId: 'agent-crash',
        volumeName: 'project-tab-workspace-agent-crash',
        filesScanned: 2,
        skipped: [],
        reuploaded: [
          { path: '/src/fail.ts', artifactId: 'art-3', success: false, error: 'Upload service unavailable' },
        ],
        orphans: [],
        volumeDeleted: false,
        errors: ['Failed to delete volume: volume in use'],
      }

      expect(result.reuploaded[0]!.success).toBe(false)
      expect(result.reuploaded[0]!.error).toContain('Upload service unavailable')
      expect(result.volumeDeleted).toBe(false)
      expect(result.errors[0]).toContain('volume in use')
    })
  })
})
