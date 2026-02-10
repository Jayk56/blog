import { describe, expect, it, vi, beforeEach } from 'vitest'

import {
  VolumeRecoveryService,
  volumeNameForAgent
} from '../../src/gateway/volume-recovery'
import type {
  VolumeFile,
  ReuploadFn,
  RecoveryResult
} from '../../src/gateway/volume-recovery'
import type { ArtifactEvent } from '../../src/types/events'

// ---------------------------------------------------------------------------
// Mock Docker
// ---------------------------------------------------------------------------

interface MockVolume {
  inspect: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

interface MockContainer {
  id: string
  start: ReturnType<typeof vi.fn>
  wait: ReturnType<typeof vi.fn>
  logs: ReturnType<typeof vi.fn>
}

interface MockDocker {
  getVolume: ReturnType<typeof vi.fn>
  createContainer: ReturnType<typeof vi.fn>
}

function makeMockVolume(exists = true): MockVolume {
  return {
    inspect: exists
      ? vi.fn(async () => ({ Name: 'test-volume' }))
      : vi.fn(async () => { throw new Error('Volume not found') }),
    remove: vi.fn(async () => undefined)
  }
}

function makeMockContainer(
  output: string = '',
  exitCode: number = 0
): MockContainer {
  return {
    id: 'recovery-container-123',
    start: vi.fn(async () => undefined),
    wait: vi.fn(async () => ({ StatusCode: exitCode })),
    logs: vi.fn(async () => Buffer.from(output))
  }
}

function makeMockDocker(volume?: MockVolume, container?: MockContainer): MockDocker {
  const v = volume ?? makeMockVolume()
  const c = container ?? makeMockContainer()

  return {
    getVolume: vi.fn(() => v),
    createContainer: vi.fn(async () => c)
  }
}

// ---------------------------------------------------------------------------
// Artifact helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('volumeNameForAgent', () => {
  it('returns correct naming convention', () => {
    expect(volumeNameForAgent('agent-1')).toBe('project-tab-workspace-agent-1')
    expect(volumeNameForAgent('abc-xyz')).toBe('project-tab-workspace-abc-xyz')
  })
})

describe('VolumeRecoveryService', () => {
  let docker: MockDocker
  let reupload: ReturnType<typeof vi.fn>
  let service: VolumeRecoveryService

  beforeEach(() => {
    docker = makeMockDocker()
    reupload = vi.fn(async () => undefined)
    service = new VolumeRecoveryService({
      docker: docker as any,
      reupload: reupload as ReuploadFn
    })
  })

  // =========================================================================
  // parseFileList
  // =========================================================================

  describe('parseFileList', () => {
    it('parses standard find output', () => {
      const output = '1024 /workspace/src/main.ts\n2048 /workspace/src/app.tsx\n'
      const files = service.parseFileList(output)

      expect(files).toHaveLength(2)
      expect(files[0]).toEqual({ path: '/workspace/src/main.ts', sizeBytes: 1024 })
      expect(files[1]).toEqual({ path: '/workspace/src/app.tsx', sizeBytes: 2048 })
    })

    it('handles empty output', () => {
      expect(service.parseFileList('')).toEqual([])
    })

    it('handles output with blank lines', () => {
      const output = '100 /workspace/a.ts\n\n200 /workspace/b.ts\n'
      const files = service.parseFileList(output)
      expect(files).toHaveLength(2)
    })

    it('handles large file sizes', () => {
      const output = '104857600 /workspace/large.bin\n'
      const files = service.parseFileList(output)
      expect(files).toHaveLength(1)
      expect(files[0].sizeBytes).toBe(104857600) // 100MB
    })

    it('handles paths with spaces', () => {
      const output = '512 /workspace/my project/file name.ts\n'
      const files = service.parseFileList(output)
      expect(files).toHaveLength(1)
      expect(files[0].path).toBe('/workspace/my project/file name.ts')
    })

    it('skips malformed lines', () => {
      const output = 'not-a-number /workspace/bad\nok 100 /workspace/good.ts\n100 /workspace/valid.ts\n'
      const files = service.parseFileList(output)
      // First line: NaN size. Second line: "ok" is not a number. Third is valid.
      expect(files).toHaveLength(1)
      expect(files[0].path).toBe('/workspace/valid.ts')
    })
  })

  // =========================================================================
  // classifyFiles
  // =========================================================================

  describe('classifyFiles', () => {
    it('marks file as skip when artifact has URI (already uploaded)', () => {
      const artifact = makeArtifact({
        artifactId: 'art-1',
        provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString(), sourcePath: '/src/main.ts' },
        uri: 'artifact://agent-1/art-1'
      })

      const artifactByPath = new Map([['/src/main.ts', artifact]])
      const files: VolumeFile[] = [{ path: '/workspace/src/main.ts', sizeBytes: 100 }]

      const actions = service.classifyFiles(files, artifactByPath)
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('skip')
      if (actions[0].type === 'skip') {
        expect(actions[0].artifactId).toBe('art-1')
        expect(actions[0].reason).toBe('already_uploaded')
      }
    })

    it('marks file for reupload when artifact has no URI', () => {
      const artifact = makeArtifact({
        artifactId: 'art-2',
        provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString(), sourcePath: '/src/app.tsx' }
        // no uri — upload failed
      })

      const artifactByPath = new Map([['/src/app.tsx', artifact]])
      const files: VolumeFile[] = [{ path: '/workspace/src/app.tsx', sizeBytes: 200 }]

      const actions = service.classifyFiles(files, artifactByPath)
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('reupload')
      if (actions[0].type === 'reupload') {
        expect(actions[0].artifactId).toBe('art-2')
        expect(actions[0].sourcePath).toBe('/workspace/src/app.tsx')
      }
    })

    it('marks file as orphan when no matching artifact', () => {
      const artifactByPath = new Map<string, ArtifactEvent>()
      const files: VolumeFile[] = [{ path: '/workspace/unknown.log', sizeBytes: 50 }]

      const actions = service.classifyFiles(files, artifactByPath)
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('orphan')
      if (actions[0].type === 'orphan') {
        expect(actions[0].path).toBe('/workspace/unknown.log')
      }
    })

    it('handles mix of skip, reupload, and orphan', () => {
      const uploaded = makeArtifact({
        artifactId: 'art-up',
        provenance: { createdBy: 'a', createdAt: new Date().toISOString(), sourcePath: '/src/a.ts' },
        uri: 'artifact://a/art-up'
      })
      const failed = makeArtifact({
        artifactId: 'art-fail',
        provenance: { createdBy: 'a', createdAt: new Date().toISOString(), sourcePath: '/src/b.ts' }
      })

      const artifactByPath = new Map([
        ['/src/a.ts', uploaded],
        ['/src/b.ts', failed]
      ])

      const files: VolumeFile[] = [
        { path: '/workspace/src/a.ts', sizeBytes: 100 },
        { path: '/workspace/src/b.ts', sizeBytes: 200 },
        { path: '/workspace/unknown.txt', sizeBytes: 50 }
      ]

      const actions = service.classifyFiles(files, artifactByPath)
      expect(actions).toHaveLength(3)

      const types = actions.map((a) => a.type)
      expect(types).toContain('skip')
      expect(types).toContain('reupload')
      expect(types).toContain('orphan')
    })

    it('handles empty file list', () => {
      const actions = service.classifyFiles([], new Map())
      expect(actions).toEqual([])
    })

    it('handles file path normalization — strips /workspace prefix', () => {
      const artifact = makeArtifact({
        artifactId: 'art-norm',
        provenance: { createdBy: 'a', createdAt: new Date().toISOString(), sourcePath: '/src/file.ts' },
        uri: 'uploaded'
      })

      const artifactByPath = new Map([['/src/file.ts', artifact]])
      const files: VolumeFile[] = [{ path: '/workspace/src/file.ts', sizeBytes: 100 }]

      const actions = service.classifyFiles(files, artifactByPath)
      expect(actions[0].type).toBe('skip')
    })
  })

  // =========================================================================
  // recover — full flow
  // =========================================================================

  describe('recover', () => {
    it('returns error when volume does not exist', async () => {
      const volume = makeMockVolume(false)
      docker = makeMockDocker(volume)
      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      const result = await service.recover('agent-1', [])
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('does not exist')
      expect(result.volumeDeleted).toBe(false)
    })

    it('scans volume and skips already-uploaded artifacts', async () => {
      const container = makeMockContainer('1024 /workspace/src/main.ts\n', 0)
      const volume = makeMockVolume(true)
      docker = makeMockDocker(volume, container)
      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      const artifact = makeArtifact({
        artifactId: 'art-uploaded',
        provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString(), sourcePath: '/src/main.ts' },
        uri: 'artifact://agent-1/art-uploaded'
      })

      const result = await service.recover('agent-1', [artifact])

      expect(result.filesScanned).toBe(1)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0].artifactId).toBe('art-uploaded')
      expect(result.reuploaded).toHaveLength(0)
      expect(result.orphans).toHaveLength(0)
      expect(result.volumeDeleted).toBe(true)
      expect(reupload).not.toHaveBeenCalled()
    })

    it('reuploads artifacts with failed uploads', async () => {
      // First createContainer call: file listing
      const listContainer = makeMockContainer('2048 /workspace/src/app.tsx\n', 0)
      // Second createContainer call: file read
      const readContainer = makeMockContainer('', 0)
      readContainer.logs.mockResolvedValue(Buffer.from('file content here'))

      const volume = makeMockVolume(true)
      docker = makeMockDocker(volume)
      let callCount = 0
      docker.createContainer.mockImplementation(async () => {
        callCount++
        return callCount === 1 ? listContainer : readContainer
      })

      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      const artifact = makeArtifact({
        artifactId: 'art-failed',
        provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString(), sourcePath: '/src/app.tsx' }
        // no uri — upload was never completed
      })

      const result = await service.recover('agent-1', [artifact])

      expect(result.filesScanned).toBe(1)
      expect(result.reuploaded).toHaveLength(1)
      expect(result.reuploaded[0].artifactId).toBe('art-failed')
      expect(result.reuploaded[0].success).toBe(true)
      expect(reupload).toHaveBeenCalledOnce()
      expect(reupload).toHaveBeenCalledWith(
        'agent-1',
        'art-failed',
        '/workspace/src/app.tsx',
        expect.any(Buffer)
      )
    })

    it('reports orphan files', async () => {
      const container = makeMockContainer('512 /workspace/mystery.log\n', 0)
      const volume = makeMockVolume(true)
      docker = makeMockDocker(volume, container)
      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      const result = await service.recover('agent-1', [])

      expect(result.orphans).toHaveLength(1)
      expect(result.orphans[0]).toBe('/workspace/mystery.log')
    })

    it('deletes volume after recovery', async () => {
      const container = makeMockContainer('', 0)
      const volume = makeMockVolume(true)
      docker = makeMockDocker(volume, container)
      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      const result = await service.recover('agent-1', [])

      expect(result.volumeDeleted).toBe(true)
      expect(volume.remove).toHaveBeenCalledOnce()
    })

    it('reports error if volume deletion fails', async () => {
      const container = makeMockContainer('', 0)
      const volume = makeMockVolume(true)
      volume.remove.mockRejectedValue(new Error('volume in use'))
      docker = makeMockDocker(volume, container)
      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      const result = await service.recover('agent-1', [])

      expect(result.volumeDeleted).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('volume in use')
    })

    it('handles reupload failure gracefully', async () => {
      const listContainer = makeMockContainer('100 /workspace/src/fail.ts\n', 0)
      const readContainer = makeMockContainer('', 0)
      readContainer.logs.mockResolvedValue(Buffer.from('content'))

      const volume = makeMockVolume(true)
      docker = makeMockDocker(volume)
      let callCount = 0
      docker.createContainer.mockImplementation(async () => {
        callCount++
        return callCount === 1 ? listContainer : readContainer
      })

      const failReupload = vi.fn(async () => {
        throw new Error('upload service unavailable')
      }) as any

      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: failReupload
      })

      const artifact = makeArtifact({
        artifactId: 'art-fail-up',
        provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString(), sourcePath: '/src/fail.ts' }
      })

      const result = await service.recover('agent-1', [artifact])

      expect(result.reuploaded).toHaveLength(1)
      expect(result.reuploaded[0].success).toBe(false)
      expect(result.reuploaded[0].error).toContain('upload service unavailable')
    })

    it('handles file read failure gracefully', async () => {
      const listContainer = makeMockContainer('100 /workspace/src/unreadable.ts\n', 0)
      const readContainer = makeMockContainer('', 1) // exit code 1 = failure

      const volume = makeMockVolume(true)
      docker = makeMockDocker(volume)
      let callCount = 0
      docker.createContainer.mockImplementation(async () => {
        callCount++
        return callCount === 1 ? listContainer : readContainer
      })

      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      const artifact = makeArtifact({
        artifactId: 'art-unread',
        provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString(), sourcePath: '/src/unreadable.ts' }
      })

      const result = await service.recover('agent-1', [artifact])

      expect(result.reuploaded).toHaveLength(1)
      expect(result.reuploaded[0].success).toBe(false)
      expect(result.reuploaded[0].error).toContain('Failed to read file')
    })

    it('handles file listing failure', async () => {
      const container = makeMockContainer('', 1) // exit code 1
      const volume = makeMockVolume(true)
      docker = makeMockDocker(volume, container)
      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      const result = await service.recover('agent-1', [])

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('failed with exit code')
      expect(result.filesScanned).toBe(0)
    })

    it('uses correct volume name', async () => {
      const container = makeMockContainer('', 0)
      const volume = makeMockVolume(true)
      docker = makeMockDocker(volume, container)
      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      await service.recover('agent-42', [])

      expect(docker.getVolume).toHaveBeenCalledWith('project-tab-workspace-agent-42')
    })

    it('produces correct result structure', async () => {
      const container = makeMockContainer('', 0)
      const volume = makeMockVolume(true)
      docker = makeMockDocker(volume, container)
      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      const result = await service.recover('agent-1', [])

      expect(result.agentId).toBe('agent-1')
      expect(result.volumeName).toBe('project-tab-workspace-agent-1')
      expect(result.filesScanned).toBe(0)
      expect(result.skipped).toEqual([])
      expect(result.reuploaded).toEqual([])
      expect(result.orphans).toEqual([])
      expect(result.volumeDeleted).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('processes multiple files in a single recovery', async () => {
      const fileList = [
        '100 /workspace/src/uploaded.ts',
        '200 /workspace/src/failed.ts',
        '300 /workspace/src/orphan.log'
      ].join('\n') + '\n'

      const listContainer = makeMockContainer(fileList, 0)
      const readContainer = makeMockContainer('', 0)
      readContainer.logs.mockResolvedValue(Buffer.from('recovered content'))

      const volume = makeMockVolume(true)
      docker = makeMockDocker(volume)
      let callCount = 0
      docker.createContainer.mockImplementation(async () => {
        callCount++
        return callCount === 1 ? listContainer : readContainer
      })

      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      const artifacts = [
        makeArtifact({
          artifactId: 'art-up',
          provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString(), sourcePath: '/src/uploaded.ts' },
          uri: 'artifact://agent-1/art-up'
        }),
        makeArtifact({
          artifactId: 'art-fail',
          provenance: { createdBy: 'agent-1', createdAt: new Date().toISOString(), sourcePath: '/src/failed.ts' }
        })
      ]

      const result = await service.recover('agent-1', artifacts)

      expect(result.filesScanned).toBe(3)
      expect(result.skipped).toHaveLength(1)
      expect(result.reuploaded).toHaveLength(1)
      expect(result.reuploaded[0].success).toBe(true)
      expect(result.orphans).toHaveLength(1)
      expect(result.orphans[0]).toBe('/workspace/src/orphan.log')
    })
  })

  // =========================================================================
  // volumeExists
  // =========================================================================

  describe('volumeExists', () => {
    it('returns true when volume exists', async () => {
      const volume = makeMockVolume(true)
      docker = makeMockDocker(volume)
      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      expect(await service.volumeExists('test-vol')).toBe(true)
    })

    it('returns false when volume does not exist', async () => {
      const volume = makeMockVolume(false)
      docker = makeMockDocker(volume)
      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn
      })

      expect(await service.volumeExists('nonexistent')).toBe(false)
    })
  })

  // =========================================================================
  // Custom options
  // =========================================================================

  describe('custom options', () => {
    it('uses custom workspace path', () => {
      service = new VolumeRecoveryService({
        docker: docker as any,
        reupload: reupload as ReuploadFn,
        workspacePath: '/custom/path'
      })

      // Normalization should use the custom workspace path
      const files: VolumeFile[] = [{ path: '/custom/path/src/main.ts', sizeBytes: 100 }]
      const artifact = makeArtifact({
        artifactId: 'art-custom',
        provenance: { createdBy: 'a', createdAt: new Date().toISOString(), sourcePath: '/src/main.ts' },
        uri: 'uploaded'
      })

      const actions = service.classifyFiles(files, new Map([['/src/main.ts', artifact]]))
      expect(actions[0].type).toBe('skip')
    })
  })
})
