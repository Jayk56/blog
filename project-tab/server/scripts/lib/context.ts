import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

export interface FrameworkInfo {
  primary: string           // "Express.js" or empty
  persistence: string[]     // ["SQLite (better-sqlite3)"]
  auth: string[]            // ["JWT (jose)"]
  realtime: string[]        // ["WebSocket (ws)"]
  validation: string[]      // ["Zod"]
  testing: string[]         // ["Vitest"]
  language: string          // "TypeScript"
  containerization: string[] // ["Docker (dockerode)"]
}

export interface ProjectContext {
  title: string
  description: string
  goals: string[]
  checkpoints: string[]
  constraints: string[]
  framework: string         // human-readable summary like "Express.js + SQLite + JWT + WebSocket + Zod"
}

const FRAMEWORK_MAP: Record<string, { category: keyof Omit<FrameworkInfo, 'language'>; label: string }> = {
  'express': { category: 'primary', label: 'Express.js' },
  'fastify': { category: 'primary', label: 'Fastify' },
  'koa': { category: 'primary', label: 'Koa' },
  'better-sqlite3': { category: 'persistence', label: 'SQLite (better-sqlite3)' },
  'pg': { category: 'persistence', label: 'PostgreSQL' },
  'mysql2': { category: 'persistence', label: 'MySQL' },
  'jose': { category: 'auth', label: 'JWT (jose)' },
  'jsonwebtoken': { category: 'auth', label: 'JWT (jsonwebtoken)' },
  'ws': { category: 'realtime', label: 'WebSocket (ws)' },
  'socket.io': { category: 'realtime', label: 'Socket.IO' },
  'zod': { category: 'validation', label: 'Zod' },
  'joi': { category: 'validation', label: 'Joi' },
  'vitest': { category: 'testing', label: 'Vitest' },
  'jest': { category: 'testing', label: 'Jest' },
  'mocha': { category: 'testing', label: 'Mocha' },
  'dockerode': { category: 'containerization', label: 'Docker (dockerode)' },
}

const CATEGORY_SUFFIXES: Record<string, string> = {
  persistence: 'persistence',
  auth: 'authentication',
  realtime: 'real-time communication',
  validation: 'validation',
  containerization: 'container management',
  testing: 'testing',
}

/**
 * Scan both `dependencies` and `devDependencies` keys against FRAMEWORK_MAP.
 * Returns FrameworkInfo with detected items in each category.
 */
export function detectFrameworks(packageJson: Record<string, unknown>): FrameworkInfo {
  const info: FrameworkInfo = {
    primary: '',
    persistence: [],
    auth: [],
    realtime: [],
    validation: [],
    testing: [],
    language: 'JavaScript',
    containerization: [],
  }

  const deps = (packageJson.dependencies ?? {}) as Record<string, string>
  const devDeps = (packageJson.devDependencies ?? {}) as Record<string, string>

  // Check for TypeScript in devDependencies
  if ('typescript' in devDeps) {
    info.language = 'TypeScript'
  }

  // Scan both deps and devDeps for framework matches
  const allDeps = { ...deps, ...devDeps }
  for (const [pkg, mapping] of Object.entries(FRAMEWORK_MAP)) {
    if (pkg in allDeps) {
      if (mapping.category === 'primary') {
        // primary is a single string, use first match
        if (!info.primary) {
          info.primary = mapping.label
        }
      } else {
        info[mapping.category].push(mapping.label)
      }
    }
  }

  return info
}

/**
 * Build a description like "Express.js API server with SQLite (better-sqlite3) persistence,
 * JWT (jose) authentication, WebSocket (ws) real-time communication, Zod validation".
 */
export function synthesizeProjectDescription(frameworks: FrameworkInfo): string {
  const prefix = frameworks.primary ? `${frameworks.primary} API server` : 'Node.js server'

  const parts: string[] = []
  for (const [category, suffix] of Object.entries(CATEGORY_SUFFIXES)) {
    if (category === 'testing') continue // skip testing in description
    const items = frameworks[category as keyof FrameworkInfo]
    if (Array.isArray(items) && items.length > 0) {
      parts.push(`${items.join(', ')} ${suffix}`)
    }
  }

  if (parts.length === 0) return prefix
  return `${prefix} with ${parts.join(', ')}`
}

/**
 * Map known script names to goals.
 */
export function inferGoalsFromScripts(scripts: Record<string, string> | undefined): string[] {
  if (!scripts) return ['Complete implementation']

  const goals: string[] = []

  if ('test' in scripts) {
    goals.push('All tests passing')
  }
  if ('typecheck' in scripts) {
    goals.push('Clean TypeScript compilation with zero errors')
  }
  if ('build' in scripts) {
    goals.push('Successful production build')
  }
  if ('dev' in scripts || 'start' in scripts) {
    goals.push('Server starts and responds to health checks')
  }

  return goals.length > 0 ? goals : ['Complete implementation']
}

/**
 * More specific than goals — infer checkpoints from script content.
 */
export function inferCheckpointsFromScripts(scripts: Record<string, string> | undefined): string[] {
  if (!scripts) return ['All tests passing']

  const checkpoints: string[] = []

  if ('test' in scripts) {
    const testScript = scripts.test
    if (testScript.includes('vitest')) {
      checkpoints.push('All Vitest tests passing')
    } else if (testScript.includes('jest')) {
      checkpoints.push('All Jest tests passing')
    } else {
      checkpoints.push('All tests passing')
    }
  }

  if ('build' in scripts) {
    checkpoints.push('Successful production build')
  }

  if ('typecheck' in scripts) {
    const typecheckScript = scripts.typecheck
    if (typecheckScript.includes('tsc')) {
      checkpoints.push('Zero TypeScript errors')
    } else {
      checkpoints.push('Zero TypeScript errors')
    }
  }

  return checkpoints.length > 0 ? checkpoints : ['All tests passing']
}

/**
 * Build constraint list from tsconfig and package.json.
 */
export function inferConstraintsFromConfig(
  tsconfig: Record<string, unknown> | null,
  packageJson: Record<string, unknown> | null,
): string[] {
  const constraints: string[] = []

  if (tsconfig) {
    const compilerOptions = tsconfig.compilerOptions as Record<string, unknown> | undefined
    if (compilerOptions?.strict === true) {
      constraints.push('TypeScript strict mode enabled — no implicit any, strict null checks')
    }
  }

  if (packageJson) {
    if (packageJson.type === 'module') {
      constraints.push('ESM module system (import/export, no require)')
    }
  }

  constraints.push('Must pass existing tests before merging')
  constraints.push("Don't modify files outside assigned workstream without escalating")

  return constraints
}

/**
 * Master function that reads project context from a repo root.
 */
export function readProjectContext(repoRoot: string, titleOverride?: string): ProjectContext {
  // Read package.json
  let pkg: Record<string, unknown> = {}
  const pkgPath = path.join(repoRoot, 'package.json')
  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    pkg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // missing or invalid — use empty
  }

  // Read tsconfig.json
  let tsconfig: Record<string, unknown> | null = null
  const tsconfigPath = path.join(repoRoot, 'tsconfig.json')
  try {
    const raw = fs.readFileSync(tsconfigPath, 'utf-8')
    tsconfig = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // missing or invalid
  }

  const frameworks = detectFrameworks(pkg)
  const scripts = pkg.scripts as Record<string, string> | undefined

  const title = titleOverride ?? (pkg.name as string | undefined) ?? path.basename(repoRoot)
  const pkgDescription = pkg.description as string | undefined
  const synthesized = synthesizeProjectDescription(frameworks)
  const description = pkgDescription && pkgDescription.length > 0 ? pkgDescription : synthesized

  return {
    title,
    description,
    goals: inferGoalsFromScripts(scripts),
    checkpoints: inferCheckpointsFromScripts(scripts),
    constraints: inferConstraintsFromConfig(tsconfig, pkg),
    framework: synthesized,
  }
}

export interface GitInfo {
  commit?: string
  branch?: string
}

/**
 * Get current git commit and branch from a repo root.
 * Returns empty fields if not a git repo or git is unavailable.
 */
export function getGitInfo(repoRoot: string): GitInfo {
  const result: GitInfo = {}
  try {
    result.commit = execSync('git rev-parse HEAD', { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString().trim()
  } catch {
    // not a git repo or git not available
  }
  try {
    result.branch = execSync('git branch --show-current', { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString().trim()
  } catch {
    // ignore
  }
  return result
}
