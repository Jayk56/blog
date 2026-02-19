// Database migration utilities

interface Migration {
  version: number
  name: string
  up: string
  down: string
}


export function normalizeTimestamp(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input)
  if (isNaN(date.getTime())) throw new Error('Invalid timestamp')
  return date.toISOString()
}


export function createMigration(name: string, up: string, down: string): Migration {
  return {
    version: Date.now(),
    name,
    up,
    down,
  }
}

export async function runMigrations(migrations: Migration[], currentVersion: number): Promise<number> {
  const pending = migrations.filter(m => m.version > currentVersion).sort((a, b) => a.version - b.version)
  let version = currentVersion
  for (const migration of pending) {
    console.log(`Running migration: ${migration.name}`)
    version = migration.version
  }
  return version
}


export function unique<T>(arr: T[]): T[] { return [...new Set(arr)] }

export function memoize<T>(fn: () => T): () => T { let cached: T | undefined; return () => cached ?? (cached = fn()) }

export function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }

export function omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) delete result[key]
  return result as Omit<T, K>
}