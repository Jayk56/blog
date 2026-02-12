import type Docker from 'dockerode'
import type { ArtifactEvent } from '../types/events'

/** Naming convention for workspace volumes, matching ContainerOrchestrator. */
export function volumeNameForAgent(agentId: string): string {
  return `project-tab-workspace-${agentId}`
}

/** A file discovered on the persistent volume during recovery scan. */
export interface VolumeFile {
  /** Path relative to /workspace inside the container. */
  path: string
  /** Size in bytes. */
  sizeBytes: number
}

/** Classification of a recovered file after cross-referencing with known artifacts. */
export type RecoveryAction =
  | { type: 'skip'; reason: 'already_uploaded'; artifactId: string }
  | { type: 'reupload'; artifactId: string; sourcePath: string }
  | { type: 'orphan'; path: string }

/** Full result of a volume recovery operation. */
export interface RecoveryResult {
  agentId: string
  volumeName: string
  filesScanned: number
  skipped: Array<{ path: string; artifactId: string }>
  reuploaded: Array<{ path: string; artifactId: string; success: boolean; error?: string }>
  orphans: string[]
  volumeDeleted: boolean
  errors: string[]
}

/** Callback for re-uploading artifact content from the volume. */
export type ReuploadFn = (
  agentId: string,
  artifactId: string,
  sourcePath: string,
  content: Buffer
) => Promise<void>

/** Options for the volume recovery service. */
export interface VolumeRecoveryOptions {
  /** Docker client instance. */
  docker: Docker
  /** Function to re-upload artifact content to the backend. */
  reupload: ReuploadFn
  /** Working directory inside the container (default: /workspace). */
  workspacePath?: string
  /** Docker image to use for the recovery helper container (default: alpine:latest). */
  helperImage?: string
}

/**
 * VolumeRecoveryService handles artifact recovery from persistent Docker volumes
 * after unclean container teardown. It scans the volume for files, cross-references
 * them against known ArtifactEvents, re-uploads failed uploads, logs orphans, and
 * cleans up the volume.
 */
export class VolumeRecoveryService {
  private readonly docker: Docker
  private readonly reupload: ReuploadFn
  private readonly workspacePath: string
  private readonly helperImage: string

  constructor(options: VolumeRecoveryOptions) {
    this.docker = options.docker
    this.reupload = options.reupload
    this.workspacePath = options.workspacePath ?? '/workspace'
    this.helperImage = options.helperImage ?? 'alpine:latest'
  }

  /**
   * Run recovery for a single agent's volume.
   *
   * @param agentId - The agent whose volume to recover
   * @param knownArtifacts - ArtifactEvents received from this agent
   * @returns RecoveryResult with details of all actions taken
   */
  async recover(
    agentId: string,
    knownArtifacts: ArtifactEvent[]
  ): Promise<RecoveryResult> {
    const volumeName = volumeNameForAgent(agentId)
    const result: RecoveryResult = {
      agentId,
      volumeName,
      filesScanned: 0,
      skipped: [],
      reuploaded: [],
      orphans: [],
      volumeDeleted: false,
      errors: []
    }

    // 1. Check if volume exists
    const exists = await this.volumeExists(volumeName)
    if (!exists) {
      result.errors.push(`Volume ${volumeName} does not exist`)
      return result
    }

    // 2. List files on the volume
    let files: VolumeFile[]
    try {
      files = await this.listVolumeFiles(volumeName)
    } catch (err) {
      result.errors.push(`Failed to list files on volume: ${(err as Error).message}`)
      return result
    }
    result.filesScanned = files.length

    // 3. Build artifact lookup by sourcePath
    const artifactByPath = new Map<string, ArtifactEvent>()
    for (const artifact of knownArtifacts) {
      if (artifact.provenance.sourcePath) {
        artifactByPath.set(artifact.provenance.sourcePath, artifact)
      }
    }

    // 4. Classify each file
    const actions = this.classifyFiles(files, artifactByPath)

    // 5. Execute recovery actions
    for (const action of actions) {
      switch (action.type) {
        case 'skip':
          result.skipped.push({ path: action.artifactId, artifactId: action.artifactId })
          // Fix: use the file path, not artifactId for skipped path
          break

        case 'reupload': {
          let content: Buffer
          try {
            content = await this.readFileFromVolume(volumeName, action.sourcePath)
          } catch (err) {
            result.reuploaded.push({
              path: action.sourcePath,
              artifactId: action.artifactId,
              success: false,
              error: `Failed to read file: ${(err as Error).message}`
            })
            continue
          }

          try {
            await this.reupload(agentId, action.artifactId, action.sourcePath, content)
            result.reuploaded.push({
              path: action.sourcePath,
              artifactId: action.artifactId,
              success: true
            })
          } catch (err) {
            result.reuploaded.push({
              path: action.sourcePath,
              artifactId: action.artifactId,
              success: false,
              error: `Reupload failed: ${(err as Error).message}`
            })
          }
          break
        }

        case 'orphan':
          result.orphans.push(action.path)
          break
      }
    }

    // Fix the skipped entries to use actual paths
    result.skipped = []
    for (const action of actions) {
      if (action.type === 'skip') {
        // Find the file path for this artifact
        const artifact = knownArtifacts.find(a => a.artifactId === action.artifactId)
        result.skipped.push({
          path: artifact?.provenance.sourcePath ?? action.artifactId,
          artifactId: action.artifactId
        })
      }
    }

    // 6. Delete the volume
    try {
      await this.deleteVolume(volumeName)
      result.volumeDeleted = true
    } catch (err) {
      result.errors.push(`Failed to delete volume: ${(err as Error).message}`)
    }

    return result
  }

  /**
   * Classify files against known artifacts to determine recovery actions.
   */
  classifyFiles(
    files: VolumeFile[],
    artifactByPath: Map<string, ArtifactEvent>
  ): RecoveryAction[] {
    const actions: RecoveryAction[] = []

    for (const file of files) {
      // Try to match by sourcePath — normalize to /workspace-relative path
      const normalizedPath = this.normalizeFilePath(file.path)
      const artifact = artifactByPath.get(normalizedPath)

      if (!artifact) {
        // No matching artifact event — orphan file
        actions.push({ type: 'orphan', path: file.path })
        continue
      }

      if (artifact.uri && artifact.uri.startsWith('artifact://')) {
        // Artifact has a backend URI — content was already uploaded
        actions.push({
          type: 'skip',
          reason: 'already_uploaded',
          artifactId: artifact.artifactId
        })
      } else {
        // Artifact event received but content upload failed
        actions.push({
          type: 'reupload',
          artifactId: artifact.artifactId,
          sourcePath: file.path
        })
      }
    }

    return actions
  }

  /**
   * Normalize a file path from the volume listing to match sourcePath format.
   * Volume files are listed relative to /workspace, sourcePaths may be absolute.
   */
  private normalizeFilePath(volumePath: string): string {
    // If sourcePaths in artifacts are like /src/main.ts,
    // and volume listing is like /workspace/src/main.ts,
    // normalize by stripping the workspace prefix.
    if (volumePath.startsWith(this.workspacePath + '/')) {
      return volumePath.slice(this.workspacePath.length)
    }
    if (volumePath.startsWith('./')) {
      return '/' + volumePath.slice(2)
    }
    if (!volumePath.startsWith('/')) {
      return '/' + volumePath
    }
    return volumePath
  }

  // ---------------------------------------------------------------------------
  // Docker volume operations
  // ---------------------------------------------------------------------------

  /** Check if a Docker volume exists. */
  async volumeExists(volumeName: string): Promise<boolean> {
    try {
      const volume = this.docker.getVolume(volumeName)
      await volume.inspect()
      return true
    } catch {
      return false
    }
  }

  /**
   * List files on a Docker volume by running a helper container that
   * mounts the volume and outputs a file listing.
   */
  async listVolumeFiles(volumeName: string): Promise<VolumeFile[]> {
    const container = await this.docker.createContainer({
      Image: this.helperImage,
      Cmd: ['sh', '-c', `find ${this.workspacePath} -type f -exec stat -c '%s %n' {} +`],
      HostConfig: {
        Binds: [`${volumeName}:${this.workspacePath}:ro`],
        AutoRemove: true
      }
    })

    await container.start()
    const { StatusCode } = await container.wait() as { StatusCode: number }

    if (StatusCode !== 0) {
      throw new Error(`Volume file listing failed with exit code ${StatusCode}`)
    }

    // Read container logs to get the file listing
    const logsStream = await container.logs({ stdout: true, stderr: false })
    const output = typeof logsStream === 'string' ? logsStream : logsStream.toString('utf-8')

    return this.parseFileList(output)
  }

  /** Read a single file from a Docker volume via a helper container. */
  async readFileFromVolume(volumeName: string, filePath: string): Promise<Buffer> {
    const container = await this.docker.createContainer({
      Image: this.helperImage,
      Cmd: ['cat', filePath],
      Tty: true, // Enable TTY to prevent Docker log framing headers
      HostConfig: {
        Binds: [`${volumeName}:${this.workspacePath}:ro`],
        AutoRemove: true
      }
    })

    await container.start()
    const { StatusCode } = await container.wait() as { StatusCode: number }

    if (StatusCode !== 0) {
      throw new Error(`Failed to read file ${filePath} (exit code ${StatusCode})`)
    }

    const logsStream = await container.logs({ stdout: true, stderr: false })
    return typeof logsStream === 'string' ? Buffer.from(logsStream) : Buffer.from(logsStream)
  }

  /** Delete a Docker volume. */
  async deleteVolume(volumeName: string): Promise<void> {
    const volume = this.docker.getVolume(volumeName)
    await volume.remove()
  }

  /** Parse the output of `find -printf '%s %p\n'` into VolumeFile entries. */
  parseFileList(output: string): VolumeFile[] {
    const files: VolumeFile[] = []
    const lines = output.trim().split('\n')

    for (const line of lines) {
      if (!line.trim()) continue

      // Docker log framing may prepend 8-byte header per chunk
      // Strip any non-printable prefix bytes
      const cleaned = line.replace(/^[\x00-\x1f]+/, '')
      if (!cleaned.trim()) continue

      const spaceIdx = cleaned.indexOf(' ')
      if (spaceIdx === -1) continue

      const sizeStr = cleaned.slice(0, spaceIdx).trim()
      const path = cleaned.slice(spaceIdx + 1).trim()

      const sizeBytes = parseInt(sizeStr, 10)
      if (isNaN(sizeBytes)) continue

      files.push({ path, sizeBytes })
    }

    return files
  }
}
