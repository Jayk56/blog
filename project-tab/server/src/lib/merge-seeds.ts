/**
 * merge-seeds.ts — Shared merge logic for ProjectSeedPayload.
 *
 * Used by both the CLI (scripts/lib/seed-file.ts) and the API route (POST /api/project/seed?mode=merge).
 */

import type { ProjectConfig, ProjectSeedPayload, WorkstreamDefinition } from '../types/project-config'

/**
 * Merge an existing seed with a freshly scanned seed.
 *
 * Strategy:
 *   OVERWRITE from scanned: keyFiles, exports, dependencies, artifacts
 *   PRESERVE from existing: project-level fields, workstream.description
 *     (when _autoDescription is falsy), workstream.status, default* fields
 *   NEW workstreams (in scanned but not existing): added with _autoDescription: true
 *   REMOVED workstreams (in existing but not scanned): kept
 */
export function mergeSeeds(
  existing: ProjectSeedPayload,
  scanned: ProjectSeedPayload,
): ProjectSeedPayload {
  // Start with a deep clone of existing to preserve all fields
  const merged: ProjectSeedPayload = structuredClone(existing)

  // Build a lookup of existing workstreams by id
  const existingMap = new Map<string, WorkstreamDefinition>()
  for (const ws of existing.workstreams) {
    existingMap.set(ws.id, ws)
  }

  // Build a set of scanned workstream ids
  const scannedMap = new Map<string, WorkstreamDefinition>()
  for (const ws of scanned.workstreams) {
    scannedMap.set(ws.id, ws)
  }

  // Process workstreams: update existing, add new, keep removed
  const mergedWorkstreams: WorkstreamDefinition[] = []

  // First, keep all existing workstreams (possibly updated)
  for (const existWs of existing.workstreams) {
    const scannedWs = scannedMap.get(existWs.id)
    if (scannedWs) {
      // Merge: overwrite structural fields, preserve human-edited fields
      const mergedWs: WorkstreamDefinition = {
        ...existWs,
        // OVERWRITE structural fields from scan
        keyFiles: scannedWs.keyFiles,
        exports: scannedWs.exports,
        dependencies: scannedWs.dependencies,
      }

      // Preserve description only if _autoDescription is falsy
      if (existWs._autoDescription) {
        mergedWs.description = scannedWs.description
        mergedWs._autoDescription = scannedWs._autoDescription ?? true
      }
      // else: keep existWs.description (human-edited), leave _autoDescription as-is

      mergedWorkstreams.push(mergedWs)
    } else {
      // Workstream removed from scan — keep it (may be manually defined)
      mergedWorkstreams.push(structuredClone(existWs))
    }
  }

  // Then add new workstreams from scan that aren't in existing
  for (const scannedWs of scanned.workstreams) {
    if (!existingMap.has(scannedWs.id)) {
      mergedWorkstreams.push({
        ...structuredClone(scannedWs),
        _autoDescription: true,
      })
    }
  }

  merged.workstreams = mergedWorkstreams

  // Overwrite artifacts from scanned
  merged.artifacts = scanned.artifacts ? structuredClone(scanned.artifacts) : undefined

  // Update provenance if scanned has one
  if (scanned.provenance) {
    merged.provenance = scanned.provenance
  }

  // Update schema version if scanned has one
  if (scanned.schemaVersion) {
    merged.schemaVersion = scanned.schemaVersion
  }

  return merged
}

/**
 * Reconstruct a ProjectSeedPayload from a stored ProjectConfig.
 * Used when doing API-level merge: we need the existing config in seed format
 * so we can merge incoming payload against it.
 */
export function configToSeedPayload(config: ProjectConfig): ProjectSeedPayload {
  return {
    schemaVersion: 1,
    project: {
      title: config.title,
      description: config.description,
      goals: config.goals,
      checkpoints: config.checkpoints,
      constraints: config.constraints,
      framework: config.framework,
    },
    workstreams: config.workstreams,
    repoRoot: config.repoRoot,
    provenance: config.provenance,
    defaultTools: config.defaultTools,
    defaultConstraints: config.defaultConstraints,
    defaultEscalation: config.defaultEscalation,
    // Note: artifacts are not stored in ProjectConfig, so we omit them here.
    // The merge will use the incoming payload's artifacts.
  }
}
