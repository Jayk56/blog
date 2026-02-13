import type Docker from 'dockerode'

import type { AgentPlugin, ArtifactEvent } from './types'
import type { KnowledgeStore as KnowledgeStoreImpl } from './intelligence/knowledge-store'
import type { AgentRegistry } from './types/service-interfaces'
import type { VolumeRecoveryService } from './gateway/volume-recovery'

/** Result from wireDockerPlugin — exposes volume recovery if Docker is available. */
export interface DockerWiringResult {
  volumeRecovery: VolumeRecoveryService | null
  docker: Docker | null
}

export interface WireDockerPluginDeps {
  dockerEnabled: 'auto' | 'true' | 'false'
  dockerImage: string
  plugins: Map<string, AgentPlugin>
  backendUrl: string
  generateToken: (agentId: string) => Promise<{ token: string; expiresAt: string }>
  knowledgeStoreImpl: Pick<KnowledgeStoreImpl, 'storeArtifactContent'>
}

// ── Docker plugin wiring ──────────────────────────────────────────────────

export async function wireDockerPlugin(deps: WireDockerPluginDeps): Promise<DockerWiringResult> {
  if (deps.dockerEnabled === 'false') {
    // eslint-disable-next-line no-console
    console.log('[plugin] Docker disabled via DOCKER_ENABLED=false')
    return { volumeRecovery: null, docker: null }
  }

  try {
    const { default: DockerCtor } = await import('dockerode')
    const docker = new DockerCtor()

    // Probe Docker connectivity
    await docker.ping()

    const { ContainerOrchestrator } = await import('./gateway/container-orchestrator')
    const { ContainerPlugin } = await import('./gateway/container-plugin')
    const { createDefaultProvisioner } = await import('./gateway/mcp-provisioner')
    const { VolumeRecoveryService } = await import('./gateway/volume-recovery')

    const orchestrator = new ContainerOrchestrator(docker)
    const mcpProvisioner = createDefaultProvisioner()

    const claudePlugin = new ContainerPlugin({
      name: 'claude',
      version: '1.0.0',
      capabilities: {
        supportsPause: false,
        supportsResume: true,
        supportsKill: true,
        supportsHotBriefUpdate: true,
      },
      orchestrator,
      image: deps.dockerImage,
      backendUrl: deps.backendUrl,
      generateToken: deps.generateToken,
      mcpProvisioner,
    })

    deps.plugins.set('claude', claudePlugin)
    // eslint-disable-next-line no-console
    console.log(`[plugin] registered "claude" (Docker container: ${deps.dockerImage})`)

    // Wire up volume recovery service for artifact recovery on unclean teardown
    const volumeRecovery = new VolumeRecoveryService({
      docker,
      reupload: async (agentId, artifactId, _sourcePath, content) => {
        deps.knowledgeStoreImpl.storeArtifactContent(agentId, artifactId, content.toString('utf-8'))
      },
    })
    // eslint-disable-next-line no-console
    console.log('[plugin] VolumeRecoveryService wired for Docker volume recovery')

    return { volumeRecovery, docker }
  } catch (err) {
    if (deps.dockerEnabled === 'true') {
      throw new Error(`DOCKER_ENABLED=true but Docker is unavailable: ${err instanceof Error ? err.message : String(err)}`)
    }
    // auto mode: Docker not available, skip silently
    // eslint-disable-next-line no-console
    console.log(`[plugin] Docker not available, skipping container plugin (${err instanceof Error ? err.message : 'unknown error'})`)
    return { volumeRecovery: null, docker: null }
  }
}

export interface StartupVolumeRecoveryDeps {
  volumeRecovery: VolumeRecoveryService
  docker: Docker
  knowledgeStoreImpl: Pick<KnowledgeStoreImpl, 'listArtifacts'>
  registry: AgentRegistry
}

/**
 * Run startup volume recovery scan. Lists Docker volumes matching
 * the `project-tab-workspace-*` naming convention and runs recovery
 * for any that don't correspond to currently running agents.
 */
export async function runStartupVolumeRecovery(deps: StartupVolumeRecoveryDeps): Promise<void> {
  try {
    const volumes = await deps.docker.listVolumes()
    const orphanedVolumes = (volumes.Volumes ?? []).filter(
      (v: { Name: string }) => v.Name.startsWith('project-tab-workspace-')
    )

    if (orphanedVolumes.length === 0) return

    // eslint-disable-next-line no-console
    console.log(`[volume-recovery] found ${orphanedVolumes.length} project-tab volume(s), scanning for orphans...`)

    // List running Docker containers managed by project-tab to avoid
    // treating still-running agent volumes as orphaned. The registry is
    // empty on server restart, so we check Docker directly.
    const runningAgentIds = new Set<string>()
    try {
      const containers = await deps.docker.listContainers({
        filters: { label: ['project-tab.managed=true'] },
      })
      for (const c of containers) {
        const agentLabel = c.Labels?.['project-tab.agent-id']
        if (agentLabel) {
          runningAgentIds.add(agentLabel)
        }
      }
      if (runningAgentIds.size > 0) {
        // eslint-disable-next-line no-console
        console.log(`[volume-recovery] ${runningAgentIds.size} container(s) still running, will skip their volumes`)
      }
    } catch (containerErr) {
      // eslint-disable-next-line no-console
      console.warn('[volume-recovery] failed to list running containers:', containerErr instanceof Error ? containerErr.message : String(containerErr))
    }

    for (const vol of orphanedVolumes) {
      const agentId = vol.Name.replace('project-tab-workspace-', '')

      // Skip volumes belonging to currently running agents (check both registry and Docker)
      const handle = deps.registry.getHandle(agentId)
      if (handle && handle.status !== 'error') continue
      if (runningAgentIds.has(agentId)) continue

      const knownArtifacts: ArtifactEvent[] = deps.knowledgeStoreImpl.listArtifacts().filter(
        (a) => a.agentId === agentId
      )

      try {
        const result = await deps.volumeRecovery.recover(agentId, knownArtifacts)
        // eslint-disable-next-line no-console
        console.log(
          `[volume-recovery] agent ${agentId}: scanned=${result.filesScanned} skipped=${result.skipped.length} reuploaded=${result.reuploaded.length} orphans=${result.orphans.length} volumeDeleted=${result.volumeDeleted}`
        )
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[volume-recovery] failed for agent ${agentId}:`, err instanceof Error ? err.message : String(err))
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[volume-recovery] startup scan failed:', err instanceof Error ? err.message : String(err))
  }
}
