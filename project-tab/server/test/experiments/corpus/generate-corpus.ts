#!/usr/bin/env npx tsx
/**
 * Deterministic corpus generator for coherence pipeline experiments.
 * Run: npx tsx test/experiments/corpus/generate-corpus.ts
 *
 * Produces 50 artifacts across 5 workstreams with 15 planted issues,
 * plus manifest.json and ground-truth.json.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ---------------------------------------------------------------------------
// Artifact content templates
// ---------------------------------------------------------------------------

// Shared fragments for planted issues

const SHARED_UTILS = `
export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return \`\${year}-\${month}-\${day}\`
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 11)
}
`

const SHARED_VALIDATION = `
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateRequired(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') {
    return \`\${field} is required\`
  }
  return null
}

export function validateMinLength(value: string, min: number, field: string): string | null {
  if (value.length < min) {
    return \`\${field} must be at least \${min} characters\`
  }
  return null
}

export function validateMaxLength(value: string, max: number, field: string): string | null {
  if (value.length > max) {
    return \`\${field} must be at most \${max} characters\`
  }
  return null
}

export function validateEmail(email: string): string | null {
  const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
  if (!re.test(email)) {
    return 'Invalid email address'
  }
  return null
}

export function validateRange(value: number, min: number, max: number, field: string): string | null {
  if (value < min || value > max) {
    return \`\${field} must be between \${min} and \${max}\`
  }
  return null
}
`

const VALIDATE_EMAIL_SNIPPET = `
export function validateEmail(email: string): boolean {
  const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
  return re.test(email)
}
`

const PARSE_JWT_SNIPPET = `
export function parseJWT(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT format')
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  return { header, payload }
}
`

const NORMALIZE_TIMESTAMP_SNIPPET = `
export function normalizeTimestamp(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input)
  if (isNaN(date.getTime())) throw new Error('Invalid timestamp')
  return date.toISOString()
}
`

// Filler code blocks for padding
const FILLER_FUNCTIONS = [
  `export function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }`,
  `export function clamp(val: number, min: number, max: number): number { return Math.max(min, Math.min(max, val)) }`,
  `export function isEmpty(obj: Record<string, unknown>): boolean { return Object.keys(obj).length === 0 }`,
  `export function retry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  return fn().catch(err => attempts > 1 ? retry(fn, attempts - 1) : Promise.reject(err))
}`,
  `export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
  return result
}`,
  `export function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) if (key in obj) result[key] = obj[key]
  return result
}`,
  `export function omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) delete result[key]
  return result as Omit<T, K>
}`,
  `export function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }`,
  `export function memoize<T>(fn: () => T): () => T { let cached: T | undefined; return () => cached ?? (cached = fn()) }`,
  `export function flatten<T>(arr: T[][]): T[] { return arr.reduce((acc, val) => acc.concat(val), []) }`,
  `export function unique<T>(arr: T[]): T[] { return [...new Set(arr)] }`,
  `export function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = String(item[key])
    ;(acc[k] ??= []).push(item)
    return acc
  }, {} as Record<string, T[]>)
}`,
  `export function mapValues<T, U>(obj: Record<string, T>, fn: (v: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]))
}`,
  `export function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, i) => start + i)
}`,
  `export function compact<T>(arr: (T | null | undefined)[]): T[] { return arr.filter((x): x is T => x != null) }`,
]

function padToTokens(base: string, targetTokens: number, rng: () => number): string {
  let result = base
  const available = [...FILLER_FUNCTIONS]
  while (estimateTokens(result) < targetTokens && available.length > 0) {
    const idx = Math.floor(rng() * available.length)
    result += '\n\n' + available.splice(idx, 1)[0]
  }
  return result
}

// ---------------------------------------------------------------------------
// Artifact definitions
// ---------------------------------------------------------------------------

interface ArtifactDef {
  id: string
  workstream: string
  agentId: string
  filename: string
  kind: 'code' | 'document' | 'config'
  content: string
  issueIds: number[]
}

function buildArtifacts(rng: () => number): ArtifactDef[] {
  const artifacts: ArtifactDef[] = []

  // === ws-backend (12 files) ===

  // Issue 1: be-utils ~= fe-helpers (easy duplication, ~90% identical)
  artifacts.push({
    id: 'be-utils',
    workstream: 'ws-backend',
    agentId: 'agent-backend',
    filename: 'ws-backend/utils.ts',
    kind: 'code',
    content: `// Backend utility functions\n${SHARED_UTILS}`,
    issueIds: [1],
  })

  // Issue 2: be-validation ~= inf-validate (easy duplication)
  artifacts.push({
    id: 'be-validation',
    workstream: 'ws-backend',
    agentId: 'agent-backend',
    filename: 'ws-backend/validation.ts',
    kind: 'code',
    content: `// Backend validation module\n${SHARED_VALIDATION}`,
    issueIds: [2],
  })

  // Issue 3: be-env contradicts inf-env
  artifacts.push({
    id: 'be-env',
    workstream: 'ws-backend',
    agentId: 'agent-backend',
    filename: 'ws-backend/.env.example',
    kind: 'config',
    content: `# Backend environment configuration
NODE_ENV=production
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=app_production
DB_USER=app_user
DB_PASSWORD=changeme
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=replace-with-secure-secret
JWT_EXPIRY=3600
LOG_LEVEL=info
CORS_ORIGIN=https://app.example.com
`,
    issueIds: [3],
  })

  // Issue 4: be-auth-handler has parseJWT buried in larger file (~500tok)
  artifacts.push({
    id: 'be-auth-handler',
    workstream: 'ws-backend',
    agentId: 'agent-backend',
    filename: 'ws-backend/auth-handler.ts',
    kind: 'code',
    content: padToTokens(
      `// Authentication handler for the backend API
import { Request, Response, NextFunction } from 'express'

interface AuthConfig {
  jwtSecret: string
  tokenExpiry: number
  refreshExpiry: number
}

const defaultConfig: AuthConfig = {
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  tokenExpiry: 3600,
  refreshExpiry: 86400,
}

${PARSE_JWT_SNIPPET}

export function authMiddleware(config: AuthConfig = defaultConfig) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      next(new Error('Missing authorization header'))
      return
    }
    const token = authHeader.slice(7)
    try {
      const { payload } = parseJWT(token)
      ;(req as Record<string, unknown>).user = payload
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  }
}

export function createToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url')
  return \`\${header}.\${body}.signature-placeholder\`
}
`,
      500,
      rng
    ),
    issueIds: [4],
  })

  // Issue 5: be-db-queries has normalizeTimestamp buried (~600tok)
  artifacts.push({
    id: 'be-db-queries',
    workstream: 'ws-backend',
    agentId: 'agent-backend',
    filename: 'ws-backend/db-queries.ts',
    kind: 'code',
    content: padToTokens(
      `// Database query helpers
import { Pool, QueryResult } from 'pg'

interface QueryOptions {
  timeout?: number
  retries?: number
}

${NORMALIZE_TIMESTAMP_SNIPPET}

export class DatabaseClient {
  private pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 20 })
  }

  async query<T>(sql: string, params?: unknown[], opts?: QueryOptions): Promise<T[]> {
    const timeout = opts?.timeout ?? 30000
    const result: QueryResult<T> = await this.pool.query({
      text: sql,
      values: params,
      statement_timeout: timeout,
    })
    return result.rows
  }

  async findById<T>(table: string, id: string): Promise<T | null> {
    const rows = await this.query<T>(\`SELECT * FROM \${table} WHERE id = $1\`, [id])
    return rows[0] ?? null
  }

  async insert<T>(table: string, data: Record<string, unknown>): Promise<T> {
    const keys = Object.keys(data)
    const values = Object.values(data)
    const placeholders = keys.map((_, i) => \`$\${i + 1}\`)
    const sql = \`INSERT INTO \${table} (\${keys.join(', ')}) VALUES (\${placeholders.join(', ')}) RETURNING *\`
    const rows = await this.query<T>(sql, values)
    return rows[0]
  }

  async update<T>(table: string, id: string, data: Record<string, unknown>): Promise<T | null> {
    const keys = Object.keys(data)
    const values = Object.values(data)
    const sets = keys.map((k, i) => \`\${k} = $\${i + 2}\`)
    const sql = \`UPDATE \${table} SET \${sets.join(', ')} WHERE id = $1 RETURNING *\`
    const rows = await this.query<T>(sql, [id, ...values])
    return rows[0] ?? null
  }
}
`,
      600,
      rng
    ),
    issueIds: [5],
  })

  // Issue 9: be-adr-003 chose REST
  artifacts.push({
    id: 'be-adr-003',
    workstream: 'ws-backend',
    agentId: 'agent-backend',
    filename: 'ws-backend/adr-003-api-design.md',
    kind: 'document',
    content: `# ADR-003: API Design Approach

## Status
Accepted

## Context
We need to choose an API design approach for communication between our frontend and backend services. The team evaluated REST, GraphQL, and gRPC.

## Decision
**We will use REST with OpenAPI 3.1 specification.**

### Rationale
- REST is well-understood by the team and ecosystem
- OpenAPI spec enables automatic client generation
- Simpler caching via HTTP semantics
- Lower operational complexity than GraphQL
- Better tooling support for monitoring and debugging

### Rejected Alternatives
- **GraphQL**: Over-fetching concerns are minimal for our use case. Added complexity of schema management and resolver optimization not justified. N+1 query problem requires additional infrastructure (DataLoader).
- **gRPC**: Not suitable for browser clients without a proxy layer. Team lacks protobuf expertise.

## Consequences
- All API endpoints follow RESTful conventions
- Request/response schemas defined in OpenAPI 3.1
- Client SDK auto-generated from spec
- Versioning via URL path prefix (/api/v1/)
`,
    issueIds: [9],
  })

  // Issue 10: be-adr-004 assumes Postgres 16
  artifacts.push({
    id: 'be-adr-004',
    workstream: 'ws-backend',
    agentId: 'agent-backend',
    filename: 'ws-backend/adr-004-database.md',
    kind: 'document',
    content: `# ADR-004: Database Strategy

## Status
Accepted

## Context
Choosing the primary database for the application's relational data storage needs.

## Decision
**We will use PostgreSQL 16 as our primary database.**

### Rationale
- PostgreSQL 16 introduces logical replication improvements critical for our HA strategy
- JSONB column support for semi-structured data reduces need for a document store
- Parallel query improvements in PG16 benefit our analytics workloads
- The pg_stat_io view (new in PG16) enables better I/O monitoring
- We specifically rely on PG16's new COPY ... DEFAULT syntax for bulk imports

## Consequences
- All migrations target PostgreSQL 16+ features
- Docker Compose uses postgres:16-alpine image
- CI tests run against PostgreSQL 16
- Backup strategy uses pg_basebackup with PG16 incremental backup support
`,
    issueIds: [10],
  })

  // Issue 11: be-tsconfig
  artifacts.push({
    id: 'be-tsconfig',
    workstream: 'ws-backend',
    agentId: 'agent-backend',
    filename: 'ws-backend/tsconfig.json',
    kind: 'config',
    content: `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
`,
    issueIds: [11],
  })

  // Issue 12: be-eslint
  artifacts.push({
    id: 'be-eslint',
    workstream: 'ws-backend',
    agentId: 'agent-backend',
    filename: 'ws-backend/.eslintrc.json',
    kind: 'config',
    content: `{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "project": "./tsconfig.json"
  },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ],
  "rules": {
    "semi": ["error", "always"],
    "quotes": ["error", "single"],
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-explicit-any": "error",
    "indent": ["error", 2],
    "comma-dangle": ["error", "always-multiline"],
    "max-len": ["warn", { "code": 100 }]
  }
}
`,
    issueIds: [12],
  })

  // Issue 14: be-api-spec
  artifacts.push({
    id: 'be-api-spec',
    workstream: 'ws-backend',
    agentId: 'agent-backend',
    filename: 'ws-backend/api-spec.ts',
    kind: 'code',
    content: `// API response type definitions (backend canonical)

export interface UserResponse {
  userId: string
  email: string
  displayName: string
  createdAt: string
  updatedAt: string
  role: 'admin' | 'editor' | 'viewer'
}

export interface ProjectResponse {
  projectId: string
  name: string
  description: string
  ownerId: string
  teamIds: string[]
  createdAt: string
  status: 'active' | 'archived' | 'deleted'
}

export interface TaskResponse {
  taskId: string
  projectId: string
  title: string
  assigneeId: string | null
  priority: 'low' | 'medium' | 'high' | 'critical'
  dueDate: string | null
  completedAt: string | null
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  hasNext: boolean
}

export interface ErrorResponse {
  error: string
  message: string
  statusCode: number
  details?: Record<string, string[]>
}
`,
    issueIds: [14],
  })

  // Clean distractor
  artifacts.push({
    id: 'be-router',
    workstream: 'ws-backend',
    agentId: 'agent-backend',
    filename: 'ws-backend/router.ts',
    kind: 'code',
    content: `// Express router setup
import { Router, Request, Response } from 'express'
import { frontendInternals } from '@project/frontend/internal-state'

const router = Router()

router.get('/api/v1/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

router.get('/api/v1/users', async (_req: Request, res: Response) => {
  try {
    const users = await fetchUsers()
    res.json({ data: users, total: users.length })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/api/v1/users/:id', async (req: Request, res: Response) => {
  const user = await fetchUserById(req.params.id)
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  res.json(user)
})

router.post('/api/v1/users', async (req: Request, res: Response) => {
  const { email, displayName, role } = req.body
  const user = await createUser({ email, displayName, role })
  res.status(201).json(user)
})

async function fetchUsers() { return [] }
async function fetchUserById(_id: string) { return null }
async function createUser(_data: Record<string, unknown>) { return {} }

export default router
`,
    issueIds: [15],
  })

  // === ws-frontend (10 files) ===

  // Issue 1: fe-helpers ~= be-utils (easy duplication)
  artifacts.push({
    id: 'fe-helpers',
    workstream: 'ws-frontend',
    agentId: 'agent-frontend',
    filename: 'ws-frontend/helpers.ts',
    kind: 'code',
    content: `// Frontend helper utilities\n${SHARED_UTILS.replace(/generateId/g, 'createUniqueId').replace(/deepClone/g, 'cloneDeep')}`,
    issueIds: [1],
  })

  // Issue 4: fe-api-client has parseJWT buried (~400tok)
  artifacts.push({
    id: 'fe-api-client',
    workstream: 'ws-frontend',
    agentId: 'agent-frontend',
    filename: 'ws-frontend/api-client.ts',
    kind: 'code',
    content: padToTokens(
      `// Frontend API client
const API_BASE = '/api/v1'

interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

${PARSE_JWT_SNIPPET}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(\`\${API_BASE}\${path}\`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!response.ok) {
    throw new Error(\`API error: \${response.status}\`)
  }
  return response.json()
}

export function getAuthToken(): string | null {
  return localStorage.getItem('auth_token')
}

export function setAuthToken(token: string): void {
  localStorage.setItem('auth_token', token)
}

export function clearAuth(): void {
  localStorage.removeItem('auth_token')
}
`,
      400,
      rng
    ),
    issueIds: [4],
  })

  // Issue 6: fe-form-utils has validateEmail (~400tok)
  artifacts.push({
    id: 'fe-form-utils',
    workstream: 'ws-frontend',
    agentId: 'agent-frontend',
    filename: 'ws-frontend/form-utils.ts',
    kind: 'code',
    content: padToTokens(
      `// Form utility functions for the frontend

interface FormField {
  name: string
  value: string
  error?: string
  touched: boolean
}

interface FormState {
  fields: Record<string, FormField>
  isSubmitting: boolean
  isValid: boolean
}

${VALIDATE_EMAIL_SNIPPET}

export function validateRequired(value: string): boolean {
  return value.trim().length > 0
}

export function validateMinLength(value: string, min: number): boolean {
  return value.length >= min
}

export function createFormState(fieldNames: string[]): FormState {
  const fields: Record<string, FormField> = {}
  for (const name of fieldNames) {
    fields[name] = { name, value: '', touched: false }
  }
  return { fields, isSubmitting: false, isValid: false }
}

export function updateField(state: FormState, name: string, value: string): FormState {
  return {
    ...state,
    fields: {
      ...state.fields,
      [name]: { ...state.fields[name], value, touched: true },
    },
  }
}
`,
      400,
      rng
    ),
    issueIds: [6],
  })

  // Issue 9: fe-adr-001 expects GraphQL
  artifacts.push({
    id: 'fe-adr-001',
    workstream: 'ws-frontend',
    agentId: 'agent-frontend',
    filename: 'ws-frontend/adr-001-data-fetching.md',
    kind: 'document',
    content: `# ADR-001: Frontend Data Fetching Strategy

## Status
Accepted

## Context
We need a data fetching strategy for the frontend that supports complex nested queries and real-time updates.

## Decision
**We will use GraphQL with Apollo Client for all frontend data fetching.**

### Rationale
- GraphQL eliminates over-fetching by requesting only needed fields
- Apollo Client provides excellent caching and state management
- Subscriptions enable real-time updates without additional infrastructure
- Strong typing via codegen from GraphQL schema
- Optimistic updates improve perceived performance

### Implementation Details
- Apollo Client 3.x with InMemoryCache
- GraphQL Code Generator for TypeScript types
- Subscription transport via WebSocket
- Query batching enabled for performance

## Consequences
- All data fetching uses GraphQL queries/mutations
- Frontend team maintains .graphql files alongside components
- Schema changes coordinated between frontend and backend teams
- Apollo DevTools used for debugging
`,
    issueIds: [9],
  })

  // Issue 11: fe-tsconfig (contradicts be-tsconfig)
  artifacts.push({
    id: 'fe-tsconfig',
    workstream: 'ws-frontend',
    agentId: 'agent-frontend',
    filename: 'ws-frontend/tsconfig.json',
    kind: 'config',
    content: `{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
`,
    issueIds: [11],
  })

  // Issue 12: fe-eslint contradicts be-eslint (no semicolons vs always)
  artifacts.push({
    id: 'fe-eslint',
    workstream: 'ws-frontend',
    agentId: 'agent-frontend',
    filename: 'ws-frontend/.eslintrc.json',
    kind: 'config',
    content: `{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "project": "./tsconfig.json",
    "ecmaFeatures": {
      "jsx": true
    }
  },
  "plugins": ["@typescript-eslint", "react", "react-hooks"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended"
  ],
  "rules": {
    "semi": ["error", "never"],
    "quotes": ["error", "single"],
    "no-console": "error",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-explicit-any": "warn",
    "indent": ["error", 2],
    "comma-dangle": ["error", "always-multiline"],
    "react/react-in-jsx-scope": "off",
    "max-len": ["warn", { "code": 120 }]
  },
  "settings": {
    "react": {
      "version": "detect"
    }
  }
}
`,
    issueIds: [12],
  })

  // Issue 14: fe-api-types (contradicts be-api-spec: user_id vs userId)
  artifacts.push({
    id: 'fe-api-types',
    workstream: 'ws-frontend',
    agentId: 'agent-frontend',
    filename: 'ws-frontend/api-types.ts',
    kind: 'code',
    content: `// Frontend API response types

export interface UserResponse {
  user_id: string
  email: string
  display_name: string
  created_at: string
  updated_at: string
  role: 'admin' | 'editor' | 'viewer'
}

export interface ProjectResponse {
  project_id: string
  name: string
  description: string
  owner_id: string
  team_ids: string[]
  created_at: string
  status: 'active' | 'archived' | 'deleted'
}

export interface TaskResponse {
  task_id: string
  project_id: string
  title: string
  assignee_id: string | null
  priority: 'low' | 'medium' | 'high' | 'critical'
  due_date: string | null
  completed_at: string | null
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  page_size: number
  has_next: boolean
}

export interface ErrorResponse {
  error: string
  message: string
  status_code: number
  details?: Record<string, string[]>
}
`,
    issueIds: [14],
  })

  // Issue 15: fe-package imports backend internal
  artifacts.push({
    id: 'fe-package',
    workstream: 'ws-frontend',
    agentId: 'agent-frontend',
    filename: 'ws-frontend/package.json',
    kind: 'config',
    content: `{
  "name": "@project/frontend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@project/frontend/internal-state": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.2.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}
`,
    issueIds: [15],
  })

  // Clean distractors for frontend
  artifacts.push({
    id: 'fe-components',
    workstream: 'ws-frontend',
    agentId: 'agent-frontend',
    filename: 'ws-frontend/components.tsx',
    kind: 'code',
    content: `// Shared UI components
import React from 'react'

interface ButtonProps {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
}

export function Button({ label, onClick, variant = 'primary', disabled }: ButtonProps) {
  const baseClasses = 'px-4 py-2 rounded font-medium transition-colors'
  const variantClasses = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    secondary: 'bg-gray-200 text-gray-800 hover:bg-gray-300',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  }
  return (
    <button
      className={\`\${baseClasses} \${variantClasses[variant]}\`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  )
}

interface CardProps {
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
}

export function Card({ title, children, footer }: CardProps) {
  return (
    <div className="border rounded-lg shadow-sm p-4">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <div className="text-gray-600">{children}</div>
      {footer && <div className="mt-4 pt-4 border-t">{footer}</div>}
    </div>
  )
}
`,
    issueIds: [],
  })

  // === ws-infra (8 files) ===

  // Issue 2: inf-validate ~= be-validation
  artifacts.push({
    id: 'inf-validate',
    workstream: 'ws-infra',
    agentId: 'agent-infra',
    filename: 'ws-infra/validate.ts',
    kind: 'code',
    content: `// Infrastructure validation helpers\n${SHARED_VALIDATION.replace(/validateEmail/g, 'checkEmail').replace(/ValidationResult/g, 'CheckResult')}`,
    issueIds: [2],
  })

  // Issue 3: inf-env contradicts be-env
  artifacts.push({
    id: 'inf-env',
    workstream: 'ws-infra',
    agentId: 'agent-infra',
    filename: 'ws-infra/.env.example',
    kind: 'config',
    content: `# Infrastructure environment configuration
NODE_ENV=production
PORT=3000
DB_HOST=db.internal.cluster
DB_PORT=5433
DB_NAME=app_prod
DB_USER=app_service
DB_PASSWORD=changeme
REDIS_URL=redis://redis.internal.cluster:6380/0
JWT_SECRET=replace-with-secure-secret
JWT_EXPIRY=7200
LOG_LEVEL=warn
CORS_ORIGIN=https://www.example.com
MONITORING_ENDPOINT=https://monitor.internal.cluster
`,
    issueIds: [3],
  })

  // Issue 5: inf-migration has normalizeTimestamp (~300tok)
  artifacts.push({
    id: 'inf-migration',
    workstream: 'ws-infra',
    agentId: 'agent-infra',
    filename: 'ws-infra/migration.ts',
    kind: 'code',
    content: padToTokens(
      `// Database migration utilities

interface Migration {
  version: number
  name: string
  up: string
  down: string
}

${NORMALIZE_TIMESTAMP_SNIPPET}

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
    console.log(\`Running migration: \${migration.name}\`)
    version = migration.version
  }
  return version
}
`,
      300,
      rng
    ),
    issueIds: [5],
  })

  // Issue 10: inf-adr-002 (Postgres 15, contradicts be-adr-004 PG16)
  artifacts.push({
    id: 'inf-adr-002',
    workstream: 'ws-infra',
    agentId: 'agent-infra',
    filename: 'ws-infra/adr-002-database-infra.md',
    kind: 'document',
    content: `# ADR-002: Database Infrastructure

## Status
Accepted

## Context
Selecting and configuring the database infrastructure for production deployment.

## Decision
**We will deploy PostgreSQL 15 on managed infrastructure.**

### Rationale
- PostgreSQL 15 is the latest LTS release with proven stability
- PG15's MERGE command simplifies our upsert patterns
- Improved sort performance in PG15 benefits our reporting queries
- Managed service (RDS/Cloud SQL) provides automated backups and failover
- PG15's logical replication improvements support our read-replica strategy

### Infrastructure Details
- Primary: db.r6g.xlarge (4 vCPU, 32 GB RAM)
- Read replicas: 2x db.r6g.large
- Storage: gp3 with 500 GB initial, auto-scaling enabled
- Backup: Automated daily snapshots, 30-day retention
- Docker Compose uses postgres:15-alpine for local development

## Consequences
- All Terraform modules reference PostgreSQL 15
- Migration scripts tested against PG15
- Monitoring dashboards configured for PG15 metrics
- Team training on PG15-specific features
`,
    issueIds: [10],
  })

  // Clean distractors for infra
  artifacts.push({
    id: 'inf-dockerfile',
    workstream: 'ws-infra',
    agentId: 'agent-infra',
    filename: 'ws-infra/Dockerfile',
    kind: 'config',
    content: `FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

USER node
CMD ["node", "dist/index.js"]
`,
    issueIds: [],
  })

  artifacts.push({
    id: 'inf-ci-pipeline',
    workstream: 'ws-infra',
    agentId: 'agent-infra',
    filename: 'ws-infra/ci-pipeline.yml',
    kind: 'config',
    content: `name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_DB: test_db
          POSTGRES_USER: test_user
          POSTGRES_PASSWORD: test_pass
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm test -- --coverage
      - run: npm run build

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "Deploy step placeholder"
`,
    issueIds: [],
  })

  artifacts.push({
    id: 'inf-terraform',
    workstream: 'ws-infra',
    agentId: 'agent-infra',
    filename: 'ws-infra/main.tf',
    kind: 'config',
    content: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "terraform-state-prod"
    key    = "app/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "us-east-1"
}

variable "environment" {
  default = "production"
}

resource "aws_ecs_cluster" "main" {
  name = "app-\${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_service" "app" {
  name            = "app-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.app.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }
}
`,
    issueIds: [],
  })

  // === ws-docs (10 files) ===

  // Issue 6: doc-examples has validateEmail (~200tok)
  artifacts.push({
    id: 'doc-examples',
    workstream: 'ws-docs',
    agentId: 'agent-docs',
    filename: 'ws-docs/code-examples.md',
    kind: 'document',
    content: `# Code Examples

## Form Validation

Here's a common pattern for validating user input:

\`\`\`typescript
${VALIDATE_EMAIL_SNIPPET}

// Usage:
const isValid = validateEmail('user@example.com') // true
const isInvalid = validateEmail('not-an-email')    // false
\`\`\`

## Error Handling

Always wrap async operations in try-catch:

\`\`\`typescript
async function fetchData(url: string) {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(\`HTTP \${response.status}\`)
    return await response.json()
  } catch (error) {
    console.error('Fetch failed:', error)
    throw error
  }
}
\`\`\`
`,
    issueIds: [6],
  })

  // Issue 7: doc-perf-guide (thematic overlap with res-caching)
  artifacts.push({
    id: 'doc-perf-guide',
    workstream: 'ws-docs',
    agentId: 'agent-docs',
    filename: 'ws-docs/performance-guide.md',
    kind: 'document',
    content: `# Performance Guide

## Caching Strategy

### Redis Caching Layer
Our application uses Redis as the primary caching layer. All cacheable queries should go through the Redis cache before hitting the database.

**Key patterns:**
- \`user:{id}\` — User profile cache, TTL 5 minutes
- \`project:{id}\` — Project data cache, TTL 10 minutes
- \`query:{hash}\` — Query result cache, TTL 1 minute

**Cache invalidation:**
- Write-through for user profiles
- Event-driven invalidation for project data
- TTL-based expiry for query caches

### Connection Pooling
- Redis: max 50 connections per service instance
- PostgreSQL: max 20 connections per service instance
- Connection health checks every 30 seconds

### Response Compression
- Enable gzip for responses > 1KB
- Use Brotli for static assets
- Cache compressed responses in Redis

## Database Optimization
- Use EXPLAIN ANALYZE for query optimization
- Index columns used in WHERE and JOIN clauses
- Prefer batch queries over N+1 patterns
- Use materialized views for complex aggregations
`,
    issueIds: [7],
  })

  // Issue 8: doc-security (thematic overlap with res-auth)
  artifacts.push({
    id: 'doc-security',
    workstream: 'ws-docs',
    agentId: 'agent-docs',
    filename: 'ws-docs/security-guide.md',
    kind: 'document',
    content: `# Security Guide

## Authentication

### OAuth 2.0 vs JWT Tokens

After evaluating both approaches, we recommend **JWT tokens with short expiry** for API authentication:

**JWT Advantages:**
- Stateless verification reduces database load
- Built-in expiry mechanism
- Standard claims (iss, sub, aud, exp) provide rich metadata
- Easy to implement with existing libraries

**OAuth 2.0 Considerations:**
- More complex setup with authorization server
- Better for third-party integrations
- Provides refresh token flow for long-lived sessions
- Required for SSO with external identity providers

**Our Recommendation:** Use JWT for service-to-service auth and internal APIs. Use OAuth 2.0 with PKCE for user-facing authentication that requires SSO.

### Token Best Practices
- Access token expiry: 15 minutes
- Refresh token expiry: 7 days
- Rotate refresh tokens on each use
- Store tokens in httpOnly cookies (not localStorage)

## Authorization
- RBAC with three roles: admin, editor, viewer
- Resource-level permissions for sensitive operations
- Audit logging for all permission changes
`,
    issueIds: [8],
  })

  // Issue 13: doc-capacity (thematic overlap with res-scaling)
  artifacts.push({
    id: 'doc-capacity',
    workstream: 'ws-docs',
    agentId: 'agent-docs',
    filename: 'ws-docs/capacity-planning.md',
    kind: 'document',
    content: `# Capacity Planning

## Current Load Profile
- 10,000 daily active users
- 500 requests/second peak
- Average response time: 120ms
- 95th percentile: 350ms

## Cache Layer Assessment
After analyzing production metrics for Q4, the cache hit ratio is 72%. We need to increase this to at least 90% to meet our SLA targets.

**Recommendation: Triple the cache capacity (3x current allocation).**

### Justification
- Current Redis allocation: 4 GB
- Recommended: 12 GB (3x increase)
- Hot key analysis shows 28% of misses are for recently-evicted entries
- Increasing capacity from 4 GB to 12 GB would capture 95% of the working set
- Estimated cost increase: $45/month
- Expected latency improvement: 40% reduction in p95

## Database Scaling
- Vertical scaling adequate for next 12 months
- Plan horizontal sharding at 50K DAU threshold
- Read replicas handle reporting workload

## Monitoring Thresholds
- Alert on cache hit ratio < 80%
- Alert on p95 latency > 500ms
- Alert on connection pool utilization > 80%
`,
    issueIds: [13],
  })

  // Clean distractors for docs
  artifacts.push({
    id: 'doc-getting-started',
    workstream: 'ws-docs',
    agentId: 'agent-docs',
    filename: 'ws-docs/getting-started.md',
    kind: 'document',
    content: `# Getting Started

## Prerequisites
- Node.js 20 LTS
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose

## Quick Start

1. Clone the repository:
\`\`\`bash
git clone https://github.com/example/project.git
cd project
\`\`\`

2. Install dependencies:
\`\`\`bash
npm install
\`\`\`

3. Set up environment:
\`\`\`bash
cp .env.example .env
# Edit .env with your configuration
\`\`\`

4. Start services:
\`\`\`bash
docker-compose up -d
npm run migrate
npm run dev
\`\`\`

5. Open http://localhost:3000

## Project Structure
- \`src/\` — Application source code
- \`test/\` — Test files
- \`docs/\` — Documentation
- \`infra/\` — Infrastructure configs
`,
    issueIds: [],
  })

  artifacts.push({
    id: 'doc-api-reference',
    workstream: 'ws-docs',
    agentId: 'agent-docs',
    filename: 'ws-docs/api-reference.md',
    kind: 'document',
    content: `# API Reference

## Base URL
\`https://api.example.com/v1\`

## Authentication
All endpoints require a Bearer token in the Authorization header.

## Endpoints

### GET /users
List all users.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| page | number | 1 | Page number |
| limit | number | 20 | Items per page |
| role | string | - | Filter by role |

**Response:** \`200 OK\`
\`\`\`json
{
  "data": [{ "userId": "abc123", "email": "user@example.com" }],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "hasNext": true
}
\`\`\`

### GET /users/:id
Get a single user by ID.

### POST /users
Create a new user.

**Request Body:**
\`\`\`json
{
  "email": "newuser@example.com",
  "displayName": "New User",
  "role": "viewer"
}
\`\`\`

### PUT /users/:id
Update an existing user.

### DELETE /users/:id
Soft-delete a user.
`,
    issueIds: [],
  })

  artifacts.push({
    id: 'doc-deployment',
    workstream: 'ws-docs',
    agentId: 'agent-docs',
    filename: 'ws-docs/deployment.md',
    kind: 'document',
    content: `# Deployment Guide

## Environments
| Environment | URL | Branch |
|-------------|-----|--------|
| Development | dev.example.com | develop |
| Staging | staging.example.com | release/* |
| Production | app.example.com | main |

## CI/CD Pipeline
1. Push to branch triggers CI
2. Tests, lint, type-check run in parallel
3. Docker image built and tagged
4. Image pushed to ECR
5. ECS service updated with new task definition

## Rollback Procedure
1. Identify the last known good task definition revision
2. Update ECS service to previous revision:
\`\`\`bash
aws ecs update-service --cluster app-production \\
  --service app-service \\
  --task-definition app:PREVIOUS_REVISION
\`\`\`
3. Monitor health checks for 5 minutes
4. Investigate root cause of failed deployment

## Health Checks
- \`/health\` — Basic liveness check
- \`/health/ready\` — Readiness check (DB + Redis connectivity)
- \`/health/detailed\` — Full system status (admin only)
`,
    issueIds: [],
  })

  artifacts.push({
    id: 'doc-contributing',
    workstream: 'ws-docs',
    agentId: 'agent-docs',
    filename: 'ws-docs/contributing.md',
    kind: 'document',
    content: `# Contributing Guide

## Branch Naming
- Feature: \`feature/TICKET-description\`
- Bug fix: \`fix/TICKET-description\`
- Docs: \`docs/description\`

## Commit Messages
Follow Conventional Commits:
- \`feat: add user search\`
- \`fix: resolve auth token expiry\`
- \`docs: update API reference\`
- \`chore: bump dependencies\`

## Pull Request Process
1. Create branch from \`develop\`
2. Make changes with tests
3. Ensure all checks pass locally
4. Open PR with description template
5. Request review from team lead
6. Address feedback
7. Squash merge when approved

## Code Standards
- TypeScript strict mode
- 100% type coverage (no \`any\`)
- Minimum 80% test coverage for new code
- All public APIs documented with JSDoc

## Testing
- Unit tests: \`npm test\`
- Integration tests: \`npm run test:integration\`
- E2E tests: \`npm run test:e2e\`
`,
    issueIds: [],
  })

  artifacts.push({
    id: 'doc-troubleshooting',
    workstream: 'ws-docs',
    agentId: 'agent-docs',
    filename: 'ws-docs/troubleshooting.md',
    kind: 'document',
    content: `# Troubleshooting

## Common Issues

### Database Connection Refused
**Symptom:** \`ECONNREFUSED 127.0.0.1:5432\`
**Solution:** Ensure PostgreSQL is running:
\`\`\`bash
docker-compose up -d postgres
\`\`\`

### Redis Timeout
**Symptom:** \`Redis connection timed out\`
**Solution:** Check Redis health and increase timeout:
\`\`\`bash
redis-cli ping
\`\`\`

### Build Failures
**Symptom:** TypeScript compilation errors after pull
**Solution:** Clean and rebuild:
\`\`\`bash
rm -rf node_modules dist
npm install
npm run build
\`\`\`

### Test Flakiness
**Symptom:** Tests pass locally but fail in CI
**Possible causes:**
- Timing-dependent assertions (use \`waitFor\` helpers)
- Port conflicts (use random ports in tests)
- Database state leaking between tests (ensure cleanup in afterEach)

### Memory Leaks
**Symptom:** Increasing RSS over time
**Debug steps:**
1. Enable \`--inspect\` flag
2. Connect Chrome DevTools
3. Take heap snapshots at intervals
4. Compare retained objects
`,
    issueIds: [],
  })

  // === ws-research (10 files) ===

  // Issue 7: res-caching (thematic overlap with doc-perf-guide)
  artifacts.push({
    id: 'res-caching',
    workstream: 'ws-research',
    agentId: 'agent-research',
    filename: 'ws-research/caching-analysis.md',
    kind: 'document',
    content: `# Caching Strategy Analysis

## Executive Summary
This report evaluates caching approaches for our application's data access patterns.

## Approach Evaluation

### Redis (Recommended)
Redis provides the best balance of performance, reliability, and operational simplicity for our caching needs.

**Performance Characteristics:**
- Sub-millisecond latency for cache hits
- Support for complex data structures (hashes, sorted sets, streams)
- Built-in TTL management and eviction policies
- Pub/sub for cache invalidation events

**Configuration Recommendations:**
- Key pattern: \`{service}:{entity}:{id}\`
- Default TTL: 5 minutes for user data, 10 minutes for project data
- Eviction policy: allkeys-lru
- Max memory: 12 GB (3x current allocation needed to capture working set)
- Persistence: RDB snapshots every 5 minutes

### Memcached
Simpler but lacks Redis's data structure support. Not recommended for our use case due to need for sorted sets in leaderboard features.

### Application-Level (In-Memory)
Suitable only for rarely-changing configuration data. Not viable for user-facing data due to cache coherence issues across instances.

## Recommendations
1. Deploy Redis 7.x cluster with 3 nodes
2. Implement write-through caching for critical paths
3. Use pub/sub for cross-instance invalidation
4. **Triple cache capacity from 4 GB to 12 GB** to achieve 90%+ hit ratio
5. Monitor eviction rate and hit ratio with Grafana dashboards
`,
    issueIds: [7],
  })

  // Issue 8: res-auth (thematic overlap with doc-security)
  artifacts.push({
    id: 'res-auth',
    workstream: 'ws-research',
    agentId: 'agent-research',
    filename: 'ws-research/auth-evaluation.md',
    kind: 'document',
    content: `# Authentication Approach Evaluation

## Overview
This research evaluates authentication strategies for the application, comparing OAuth 2.0 and JWT-based approaches.

## OAuth 2.0 Analysis

### Strengths
- Industry standard for delegated authorization
- Supports multiple grant types (authorization code, client credentials, device flow)
- Excellent ecosystem support and well-tested libraries
- Built-in support for scopes and consent

### Weaknesses
- Complex setup requiring authorization server infrastructure
- Token introspection adds latency for stateful validation
- Refresh token rotation management adds complexity

## JWT Analysis

### Strengths
- Stateless verification (no database lookups)
- Self-contained claims reduce inter-service calls
- Easy to implement and debug
- Works well for microservice architectures

### Weaknesses
- Cannot revoke tokens before expiry without a blocklist
- Token size grows with claims
- Key rotation requires coordination

## Recommendation
**Hybrid approach: JWT for internal service auth, OAuth 2.0 with PKCE for user-facing flows.**

This matches our architecture:
- Service mesh uses JWT with short expiry (15 min)
- User authentication via OAuth 2.0 authorization code flow with PKCE
- Refresh tokens stored server-side with rotation
- Token exchange endpoint for service-to-user delegation
`,
    issueIds: [8],
  })

  // Issue 13: res-scaling (thematic overlap with doc-capacity)
  artifacts.push({
    id: 'res-scaling',
    workstream: 'ws-research',
    agentId: 'agent-research',
    filename: 'ws-research/scaling-analysis.md',
    kind: 'document',
    content: `# Scaling Analysis Report

## Current Baseline
- 10K DAU, 500 req/s peak
- p50 latency: 45ms, p95: 350ms, p99: 800ms
- Cache hit ratio: 72%
- Database CPU utilization: 65% peak

## Bottleneck Analysis

### Cache Layer (Primary Bottleneck)
The 72% cache hit ratio indicates significant room for improvement. Analysis of eviction patterns shows:
- 28% of cache misses are for entries evicted within the last 2 minutes
- Working set size: ~10 GB
- Current allocation: 4 GB (covers only 40% of working set)

**Recommendation: Increase cache to 3x current capacity (12 GB).**

Expected impact:
- Cache hit ratio improvement: 72% → 92%
- p95 latency reduction: 350ms → 210ms
- Database load reduction: ~40%

### Database Layer
- Vertical scaling headroom: 12 months at current growth
- Read replica already handles analytics workload
- Connection pooling at 60% capacity
- Index coverage: 94% of frequent queries

### Application Layer
- Stateless design supports horizontal scaling
- Current 2-instance setup has 50% headroom
- Auto-scaling triggers at 70% CPU

## 12-Month Projection
| Metric | Current | 3 Months | 6 Months | 12 Months |
|--------|---------|----------|----------|-----------|
| DAU | 10K | 15K | 25K | 50K |
| Peak RPS | 500 | 750 | 1250 | 2500 |
| Cache Needed | 12 GB | 16 GB | 24 GB | 48 GB |
`,
    issueIds: [13],
  })

  // Clean distractors for research
  artifacts.push({
    id: 'res-frameworks',
    workstream: 'ws-research',
    agentId: 'agent-research',
    filename: 'ws-research/framework-comparison.md',
    kind: 'document',
    content: `# Web Framework Comparison

## Evaluated Frameworks
| Framework | Language | Stars | Performance |
|-----------|----------|-------|-------------|
| Express | Node.js | 62K | Moderate |
| Fastify | Node.js | 29K | High |
| Hono | Node.js/Edge | 12K | Very High |
| Koa | Node.js | 34K | Moderate |

## Evaluation Criteria
1. **Performance**: Request throughput and latency
2. **Ecosystem**: Middleware and plugin availability
3. **Developer Experience**: TypeScript support, documentation
4. **Maintenance**: Release cadence, community size

## Results

### Express
- Mature ecosystem with extensive middleware
- Performance is adequate for our scale
- Best TypeScript support via @types/express
- Team familiarity is highest

### Fastify
- 2-3x faster than Express in benchmarks
- Schema-based validation with JSON Schema
- Built-in TypeScript support
- Smaller middleware ecosystem

## Recommendation
**Stay with Express** for the current project. Migration to Fastify recommended for new services where performance is critical.
`,
    issueIds: [],
  })

  artifacts.push({
    id: 'res-testing',
    workstream: 'ws-research',
    agentId: 'agent-research',
    filename: 'ws-research/testing-strategy.md',
    kind: 'document',
    content: `# Testing Strategy Research

## Test Pyramid
Our recommended testing distribution:
- Unit tests: 70% (fast, isolated)
- Integration tests: 20% (API boundaries)
- E2E tests: 10% (critical user flows)

## Framework Comparison

### Vitest (Recommended)
- Native ESM support
- Vite-powered HMR for watch mode
- Compatible with Jest API
- Built-in TypeScript support
- Faster cold start than Jest

### Jest
- Mature ecosystem
- Extensive mocking capabilities
- Slower startup due to transform pipeline
- Well-documented patterns

## Coverage Strategy
- Minimum 80% line coverage for new code
- Critical paths (auth, payments) require 95%+
- Use Istanbul/c8 for coverage reporting
- Coverage gates in CI prevent regression

## Mock Strategy
- Use dependency injection for testability
- Prefer real implementations over mocks when fast enough
- Mock external services at HTTP boundary
- Use factories for test data generation
`,
    issueIds: [],
  })

  artifacts.push({
    id: 'res-monitoring',
    workstream: 'ws-research',
    agentId: 'agent-research',
    filename: 'ws-research/monitoring-research.md',
    kind: 'document',
    content: `# Monitoring & Observability Research

## Three Pillars

### Metrics (Prometheus + Grafana)
- Request rate, error rate, duration (RED metrics)
- System metrics: CPU, memory, disk, network
- Custom business metrics: signups, conversions
- Alert thresholds based on SLO budgets

### Logging (Structured JSON)
- Use structured logging (pino recommended)
- Log levels: error, warn, info, debug
- Include correlation IDs for request tracing
- Ship to centralized log aggregation (ELK/Loki)

### Tracing (OpenTelemetry)
- Distributed tracing across services
- Auto-instrumentation for HTTP, database, Redis
- Sample rate: 10% in production, 100% in staging
- Visualize with Jaeger or Tempo

## Recommended Stack
| Component | Tool | Justification |
|-----------|------|---------------|
| Metrics | Prometheus | Industry standard, pull-based |
| Dashboards | Grafana | Flexible, team familiarity |
| Logging | Pino + Loki | Fast, structured, cost-effective |
| Tracing | OpenTelemetry | Vendor-neutral, growing ecosystem |
| Alerting | Alertmanager | Integrates with Prometheus |

## SLO Definitions
- Availability: 99.9% (43 min/month error budget)
- Latency p95: < 500ms
- Error rate: < 0.1%
`,
    issueIds: [],
  })

  artifacts.push({
    id: 'res-database',
    workstream: 'ws-research',
    agentId: 'agent-research',
    filename: 'ws-research/database-research.md',
    kind: 'document',
    content: `# Database Technology Research

## Candidates Evaluated
1. PostgreSQL (RDBMS)
2. MongoDB (Document store)
3. CockroachDB (Distributed SQL)

## PostgreSQL (Selected)
- ACID compliance for transactional integrity
- JSONB for semi-structured data flexibility
- Mature ecosystem with extensions (PostGIS, pg_trgm)
- Proven scaling strategies (partitioning, read replicas)
- Strong community and long-term support

## MongoDB
- Flexible schema for rapid prototyping
- Horizontal scaling via sharding
- Aggregation pipeline for analytics
- Not ideal for complex joins and transactions

## CockroachDB
- Distributed SQL with serializable isolation
- Automatic sharding and rebalancing
- Expensive for our current scale
- Limited extension ecosystem

## Decision Matrix
| Criteria | Weight | PostgreSQL | MongoDB | CockroachDB |
|----------|--------|-----------|---------|-------------|
| ACID compliance | 25% | 10 | 6 | 10 |
| Ecosystem | 20% | 10 | 8 | 5 |
| Performance | 20% | 9 | 8 | 7 |
| Scalability | 15% | 7 | 9 | 10 |
| Cost | 10% | 9 | 7 | 4 |
| Team expertise | 10% | 9 | 5 | 3 |
| **Total** | | **9.1** | **7.2** | **6.8** |
`,
    issueIds: [],
  })

  artifacts.push({
    id: 'res-accessibility',
    workstream: 'ws-research',
    agentId: 'agent-research',
    filename: 'ws-research/accessibility-audit.md',
    kind: 'document',
    content: `# Accessibility Audit Report

## Scope
Evaluated all user-facing components against WCAG 2.1 AA criteria.

## Findings

### Critical
1. **Missing alt text on user avatars** — Screen readers announce "image" without context
2. **Form fields lack labels** — Several form inputs use placeholder only

### Major
3. **Insufficient color contrast** — Some text-on-background combinations fail 4.5:1 ratio
4. **Keyboard navigation gaps** — Modal dialogs don't trap focus
5. **Missing skip navigation** — No link to skip to main content

### Minor
6. **Missing landmark regions** — Pages lack proper header/main/nav landmarks
7. **Inconsistent focus styles** — Some interactive elements have no visible focus indicator

## Remediation Plan
| Priority | Issue | Effort | Sprint |
|----------|-------|--------|--------|
| P0 | Alt text | 2h | Current |
| P0 | Form labels | 4h | Current |
| P1 | Color contrast | 8h | Next |
| P1 | Focus trapping | 4h | Next |
| P2 | Skip navigation | 2h | Backlog |
| P2 | Landmarks | 3h | Backlog |
| P2 | Focus styles | 4h | Backlog |

## Tools Used
- axe DevTools (automated scanning)
- NVDA (manual screen reader testing)
- Lighthouse (performance + accessibility)
`,
    issueIds: [],
  })

  artifacts.push({
    id: 'res-ci-comparison',
    workstream: 'ws-research',
    agentId: 'agent-research',
    filename: 'ws-research/ci-comparison.md',
    kind: 'document',
    content: `# CI/CD Platform Comparison

## Platforms Evaluated
1. GitHub Actions (Selected)
2. GitLab CI
3. CircleCI
4. Jenkins

## GitHub Actions
**Pros:**
- Native GitHub integration
- Marketplace with 15,000+ actions
- Matrix builds for cross-platform testing
- Free tier generous for open source
- YAML-based configuration

**Cons:**
- Limited self-hosted runner management
- Debugging workflow runs can be tedious
- Concurrent job limits on free tier

## GitLab CI
**Pros:**
- Integrated with GitLab ecosystem
- Built-in container registry
- Auto DevOps for common patterns

**Cons:**
- Requires GitLab migration
- Higher operational cost for self-hosted

## Recommendation
**GitHub Actions** — best fit for our GitHub-based workflow. Team is already familiar with the YAML syntax and marketplace ecosystem. Estimated CI runtime: 4-6 minutes for full pipeline.
`,
    issueIds: [],
  })

  // === Additional clean distractors to reach 50 artifacts ===

  // +1 backend (12 total)
  artifacts.push({
    id: 'be-logger',
    workstream: 'ws-backend',
    agentId: 'agent-backend',
    filename: 'ws-backend/logger.ts',
    kind: 'code',
    content: `// Structured logger for the backend service
import { createWriteStream, WriteStream } from 'fs'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: Record<string, unknown>
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export class Logger {
  private level: LogLevel
  private stream: WriteStream | null = null

  constructor(level: LogLevel = 'info', logFile?: string) {
    this.level = level
    if (logFile) {
      this.stream = createWriteStream(logFile, { flags: 'a' })
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level]
  }

  private write(entry: LogEntry): void {
    const line = JSON.stringify(entry)
    if (this.stream) {
      this.stream.write(line + '\\n')
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) this.write({ timestamp: new Date().toISOString(), level: 'debug', message, context })
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('info')) this.write({ timestamp: new Date().toISOString(), level: 'info', message, context })
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) this.write({ timestamp: new Date().toISOString(), level: 'warn', message, context })
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('error')) this.write({ timestamp: new Date().toISOString(), level: 'error', message, context })
  }
}
`,
    issueIds: [],
  })

  // +1 frontend (10 total)
  artifacts.push({
    id: 'fe-theme',
    workstream: 'ws-frontend',
    agentId: 'agent-frontend',
    filename: 'ws-frontend/theme.ts',
    kind: 'code',
    content: `// Design system theme tokens

export const colors = {
  primary: {
    50: '#eff6ff',
    100: '#dbeafe',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    900: '#1e3a5f',
  },
  neutral: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    500: '#6b7280',
    700: '#374151',
    900: '#111827',
  },
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
} as const

export const spacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
} as const

export const typography = {
  fontFamily: {
    sans: '"Inter", system-ui, -apple-system, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", monospace',
  },
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
  },
} as const

export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const
`,
    issueIds: [],
  })

  // +1 infra (8 total)
  artifacts.push({
    id: 'inf-docker-compose',
    workstream: 'ws-infra',
    agentId: 'agent-infra',
    filename: 'ws-infra/docker-compose.yml',
    kind: 'config',
    content: `version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      DB_HOST: postgres
      DB_PORT: 5432
      REDIS_URL: redis://redis:6379/0
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./src:/app/src

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: app_dev
      POSTGRES_USER: app_user
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app_user"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
`,
    issueIds: [],
  })

  // +1 docs (10 total)
  artifacts.push({
    id: 'doc-architecture',
    workstream: 'ws-docs',
    agentId: 'agent-docs',
    filename: 'ws-docs/architecture.md',
    kind: 'document',
    content: `# Architecture Overview

## System Components

### Frontend
- React 18 with TypeScript
- Vite build toolchain
- State management via React Context + useReducer
- API communication via REST client

### Backend
- Express.js with TypeScript
- PostgreSQL for persistent storage
- Redis for caching and session management
- JWT-based authentication

### Infrastructure
- Docker containers on AWS ECS Fargate
- RDS for managed PostgreSQL
- ElastiCache for managed Redis
- CloudFront CDN for static assets

## Data Flow
\`\`\`
Client → CloudFront → ALB → ECS (Express) → PostgreSQL
                                          → Redis (cache)
\`\`\`

## Key Design Decisions
1. **Monorepo**: Single repository for frontend, backend, and infrastructure code
2. **REST API**: Simple, well-understood protocol for client-server communication
3. **PostgreSQL**: ACID compliance, JSONB support, mature ecosystem
4. **Redis caching**: Sub-millisecond latency for frequently accessed data
5. **Container-based deployment**: Reproducible environments, easy scaling
`,
    issueIds: [],
  })

  // +1 research (10 total)
  artifacts.push({
    id: 'res-error-handling',
    workstream: 'ws-research',
    agentId: 'agent-research',
    filename: 'ws-research/error-handling-patterns.md',
    kind: 'document',
    content: `# Error Handling Patterns Research

## Approach Comparison

### Try-Catch (Current)
Standard JavaScript error handling. Simple and well-understood.
\`\`\`typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  logger.error('Operation failed', { error })
  throw new AppError('OPERATION_FAILED', 500)
}
\`\`\`

### Result Type (Proposed)
Functional approach that makes errors explicit in the type system.
\`\`\`typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }

async function riskyOperation(): Promise<Result<Data>> {
  try {
    const data = await fetch('/api/data')
    return { ok: true, value: await data.json() }
  } catch (error) {
    return { ok: false, error: error as Error }
  }
}
\`\`\`

### Error Boundaries (React)
Component-level error catching for graceful UI degradation.

## Recommendation
- Use try-catch for I/O operations and external service calls
- Use Result type for business logic where errors are expected outcomes
- Use Error Boundaries for React component trees
- Create custom error classes with error codes for API responses

## Error Classification
| Code Range | Category | Example |
|-----------|----------|---------|
| 1xxx | Validation | Invalid email format |
| 2xxx | Authentication | Token expired |
| 3xxx | Authorization | Insufficient permissions |
| 4xxx | Not Found | Resource doesn't exist |
| 5xxx | Internal | Database connection failed |
`,
    issueIds: [],
  })

  return artifacts
}

// ---------------------------------------------------------------------------
// Ground truth definitions
// ---------------------------------------------------------------------------

interface GroundTruthIssue {
  id: number
  pairKey: string
  artifactIdA: string
  artifactIdB: string
  workstreamA: string
  workstreamB: string
  category: 'contradiction' | 'duplication' | 'gap' | 'dependency_violation'
  severity: 'warning' | 'low' | 'medium' | 'high' | 'critical'
  difficulty: 'easy' | 'medium' | 'hard'
  description: string
  expectedDetectionLayers: string[]
}

function makePairKey(a: string, b: string): string {
  return [a, b].sort().join(':')
}

function buildGroundTruth(): GroundTruthIssue[] {
  return [
    // Easy — embedding-detectable
    {
      id: 1,
      pairKey: makePairKey('be-utils', 'fe-helpers'),
      artifactIdA: 'be-utils',
      artifactIdB: 'fe-helpers',
      workstreamA: 'ws-backend',
      workstreamB: 'ws-frontend',
      category: 'duplication',
      severity: 'medium',
      difficulty: 'easy',
      description: '~90% identical utility files with minor variable renames (generateId vs createUniqueId, deepClone vs cloneDeep)',
      expectedDetectionLayers: ['layer1a'],
    },
    {
      id: 2,
      pairKey: makePairKey('be-validation', 'inf-validate'),
      artifactIdA: 'be-validation',
      artifactIdB: 'inf-validate',
      workstreamA: 'ws-backend',
      workstreamB: 'ws-infra',
      category: 'duplication',
      severity: 'medium',
      difficulty: 'easy',
      description: 'Same validation logic with minor naming differences (validateEmail vs checkEmail, ValidationResult vs CheckResult)',
      expectedDetectionLayers: ['layer1a'],
    },
    {
      id: 3,
      pairKey: makePairKey('be-env', 'inf-env'),
      artifactIdA: 'be-env',
      artifactIdB: 'inf-env',
      workstreamA: 'ws-backend',
      workstreamB: 'ws-infra',
      category: 'contradiction',
      severity: 'high',
      difficulty: 'easy',
      description: 'Same env var keys with different values: DB_PORT 5432 vs 5433, DB_HOST localhost vs db.internal.cluster, CORS_ORIGIN mismatch',
      expectedDetectionLayers: ['layer1a'],
    },
    // Medium — may need Layer 2 or thresholding
    {
      id: 4,
      pairKey: makePairKey('be-auth-handler', 'fe-api-client'),
      artifactIdA: 'be-auth-handler',
      artifactIdB: 'fe-api-client',
      workstreamA: 'ws-backend',
      workstreamB: 'ws-frontend',
      category: 'duplication',
      severity: 'low',
      difficulty: 'medium',
      description: 'Both contain parseJWT() (~50tok) buried in larger unrelated files. Embedding dilution lowers similarity.',
      expectedDetectionLayers: ['layer1a', 'layer2'],
    },
    {
      id: 5,
      pairKey: makePairKey('be-db-queries', 'inf-migration'),
      artifactIdA: 'be-db-queries',
      artifactIdB: 'inf-migration',
      workstreamA: 'ws-backend',
      workstreamB: 'ws-infra',
      category: 'duplication',
      severity: 'low',
      difficulty: 'medium',
      description: 'Both contain normalizeTimestamp(). Asymmetric file sizes compound embedding dilution.',
      expectedDetectionLayers: ['layer1a', 'layer2'],
    },
    {
      id: 6,
      pairKey: makePairKey('fe-form-utils', 'doc-examples'),
      artifactIdA: 'fe-form-utils',
      artifactIdB: 'doc-examples',
      workstreamA: 'ws-frontend',
      workstreamB: 'ws-docs',
      category: 'duplication',
      severity: 'low',
      difficulty: 'medium',
      description: 'Both contain validateEmail(). Cross-kind (code/document) pairing.',
      expectedDetectionLayers: ['layer1a', 'layer2'],
    },
    {
      id: 7,
      pairKey: makePairKey('res-caching', 'doc-perf-guide'),
      artifactIdA: 'res-caching',
      artifactIdB: 'doc-perf-guide',
      workstreamA: 'ws-research',
      workstreamB: 'ws-docs',
      category: 'duplication',
      severity: 'warning',
      difficulty: 'medium',
      description: 'Thematic overlap: both discuss Redis caching strategies with similar recommendations.',
      expectedDetectionLayers: ['layer1a', 'layer1c'],
    },
    {
      id: 8,
      pairKey: makePairKey('res-auth', 'doc-security'),
      artifactIdA: 'res-auth',
      artifactIdB: 'doc-security',
      workstreamA: 'ws-research',
      workstreamB: 'ws-docs',
      category: 'duplication',
      severity: 'warning',
      difficulty: 'medium',
      description: 'Both analyze OAuth vs JWT tradeoffs with similar conclusions.',
      expectedDetectionLayers: ['layer1a', 'layer1c'],
    },
    // Hard — LLM-only detectable
    {
      id: 9,
      pairKey: makePairKey('be-adr-003', 'fe-adr-001'),
      artifactIdA: 'be-adr-003',
      artifactIdB: 'fe-adr-001',
      workstreamA: 'ws-backend',
      workstreamB: 'ws-frontend',
      category: 'contradiction',
      severity: 'critical',
      difficulty: 'hard',
      description: 'Backend ADR chose REST with OpenAPI; Frontend ADR expects GraphQL with Apollo Client. Opposite API design conclusions.',
      expectedDetectionLayers: ['layer1c', 'layer2'],
    },
    {
      id: 10,
      pairKey: makePairKey('inf-adr-002', 'be-adr-004'),
      artifactIdA: 'inf-adr-002',
      artifactIdB: 'be-adr-004',
      workstreamA: 'ws-infra',
      workstreamB: 'ws-backend',
      category: 'contradiction',
      severity: 'high',
      difficulty: 'hard',
      description: 'Infrastructure deploys PostgreSQL 15; Backend assumes PostgreSQL 16 features (pg_stat_io, COPY DEFAULT).',
      expectedDetectionLayers: ['layer1c', 'layer2'],
    },
    {
      id: 11,
      pairKey: makePairKey('be-tsconfig', 'fe-tsconfig'),
      artifactIdA: 'be-tsconfig',
      artifactIdB: 'fe-tsconfig',
      workstreamA: 'ws-backend',
      workstreamB: 'ws-frontend',
      category: 'contradiction',
      severity: 'medium',
      difficulty: 'hard',
      description: 'Config drift: backend targets ES2022 with NodeNext module; frontend targets ES2020 with ESNext/bundler.',
      expectedDetectionLayers: ['layer1c', 'layer2'],
    },
    {
      id: 12,
      pairKey: makePairKey('be-eslint', 'fe-eslint'),
      artifactIdA: 'be-eslint',
      artifactIdB: 'fe-eslint',
      workstreamA: 'ws-backend',
      workstreamB: 'ws-frontend',
      category: 'contradiction',
      severity: 'medium',
      difficulty: 'hard',
      description: 'Contradictory ESLint rules: backend enforces semicolons ("always"), frontend forbids them ("never").',
      expectedDetectionLayers: ['layer1c', 'layer2'],
    },
    {
      id: 13,
      pairKey: makePairKey('res-scaling', 'doc-capacity'),
      artifactIdA: 'res-scaling',
      artifactIdB: 'doc-capacity',
      workstreamA: 'ws-research',
      workstreamB: 'ws-docs',
      category: 'duplication',
      severity: 'warning',
      difficulty: 'hard',
      description: 'Both independently conclude "need 3x more cache (4GB→12GB)" with different framing and analysis.',
      expectedDetectionLayers: ['layer1c'],
    },
    {
      id: 14,
      pairKey: makePairKey('be-api-spec', 'fe-api-types'),
      artifactIdA: 'be-api-spec',
      artifactIdB: 'fe-api-types',
      workstreamA: 'ws-backend',
      workstreamB: 'ws-frontend',
      category: 'contradiction',
      severity: 'high',
      difficulty: 'hard',
      description: 'Same endpoints, different response shapes: camelCase (userId, projectId) vs snake_case (user_id, project_id).',
      expectedDetectionLayers: ['layer1c', 'layer2'],
    },
    {
      id: 15,
      pairKey: makePairKey('fe-package', 'be-router'),
      artifactIdA: 'fe-package',
      artifactIdB: 'be-router',
      workstreamA: 'ws-frontend',
      workstreamB: 'ws-backend',
      category: 'dependency_violation',
      severity: 'high',
      difficulty: 'hard',
      description: 'Backend router imports @project/frontend/internal-state — backend depends on frontend internals.',
      expectedDetectionLayers: ['layer1c', 'layer2'],
    },
  ]
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

function main() {
  const rng = mulberry32(42)
  const outDir = path.resolve(__dirname)
  const artifacts = buildArtifacts(rng)

  // Write artifact files
  for (const artifact of artifacts) {
    const filePath = path.join(outDir, artifact.filename)
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, artifact.content, 'utf-8')
  }

  // Write manifest.json
  const manifest = {
    generatedAt: '2026-01-15T00:00:00.000Z',
    seed: 42,
    totalArtifacts: artifacts.length,
    totalIssues: 15,
    artifacts: artifacts.map(a => ({
      artifactId: a.id,
      workstream: a.workstream,
      agentId: a.agentId,
      filename: a.filename,
      kind: a.kind,
      estimatedTokens: estimateTokens(a.content),
      issueIds: a.issueIds,
    })),
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

  // Write ground-truth.json
  const groundTruth = { issues: buildGroundTruth() }
  fs.writeFileSync(path.join(outDir, 'ground-truth.json'), JSON.stringify(groundTruth, null, 2) + '\n', 'utf-8')

  console.log(`Generated ${artifacts.length} artifacts across 5 workstreams`)
  console.log(`Generated ${groundTruth.issues.length} ground truth issues`)
  console.log(`Output directory: ${outDir}`)
}

main()
