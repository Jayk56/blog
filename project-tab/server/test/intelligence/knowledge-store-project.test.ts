import { describe, expect, it } from 'vitest'
import { KnowledgeStore } from '../../src/intelligence/knowledge-store'
import type { ProjectConfig } from '../../src/types/project-config'

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: 'proj-1',
    title: 'Test Project',
    description: 'A test project',
    goals: ['Build something'],
    checkpoints: ['CP1'],
    constraints: ['No bugs'],
    workstreams: [{ id: 'ws-1', name: 'Core', description: 'Core work', keyFiles: ['src/'] }],
    defaultTools: ['Read', 'Write'],
    defaultConstraints: ['Compile clean'],
    defaultEscalation: { alwaysEscalate: ['delete'], neverEscalate: ['format'] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}

describe('KnowledgeStore – project config', () => {
  it('storeProjectConfig stores and getProjectConfig retrieves', () => {
    const store = new KnowledgeStore(':memory:')
    const config = makeConfig()
    store.storeProjectConfig(config)

    const retrieved = store.getProjectConfig()
    expect(retrieved).toBeDefined()
    expect(retrieved!.id).toBe('proj-1')
    expect(retrieved!.title).toBe('Test Project')
    expect(retrieved!.goals).toEqual(['Build something'])
    expect(retrieved!.workstreams).toHaveLength(1)
    store.close()
  })

  it('storeProjectConfig upserts (overwrites existing)', () => {
    const store = new KnowledgeStore(':memory:')
    const config1 = makeConfig({ title: 'Version 1' })
    store.storeProjectConfig(config1)

    const config2 = makeConfig({ title: 'Version 2', updatedAt: new Date().toISOString() })
    store.storeProjectConfig(config2)

    const retrieved = store.getProjectConfig()
    expect(retrieved).toBeDefined()
    expect(retrieved!.title).toBe('Version 2')
    store.close()
  })

  it('getProjectConfig returns undefined when no config exists', () => {
    const store = new KnowledgeStore(':memory:')
    const result = store.getProjectConfig()
    expect(result).toBeUndefined()
    store.close()
  })

  it('hasProject returns false initially, true after storing', () => {
    const store = new KnowledgeStore(':memory:')
    expect(store.hasProject()).toBe(false)

    store.storeProjectConfig(makeConfig())
    expect(store.hasProject()).toBe(true)
    store.close()
  })

  it('project_config table is created on construction', () => {
    const store = new KnowledgeStore(':memory:')
    // Querying the table should not throw
    expect(() => store.hasProject()).not.toThrow()
    expect(() => store.getProjectConfig()).not.toThrow()
    store.close()
  })
})
