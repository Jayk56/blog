// Database query helpers
import { Pool, QueryResult } from 'pg'

interface QueryOptions {
  timeout?: number
  retries?: number
}


export function normalizeTimestamp(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input)
  if (isNaN(date.getTime())) throw new Error('Invalid timestamp')
  return date.toISOString()
}


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
    const rows = await this.query<T>(`SELECT * FROM ${table} WHERE id = $1`, [id])
    return rows[0] ?? null
  }

  async insert<T>(table: string, data: Record<string, unknown>): Promise<T> {
    const keys = Object.keys(data)
    const values = Object.values(data)
    const placeholders = keys.map((_, i) => `$${i + 1}`)
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`
    const rows = await this.query<T>(sql, values)
    return rows[0]
  }

  async update<T>(table: string, id: string, data: Record<string, unknown>): Promise<T | null> {
    const keys = Object.keys(data)
    const values = Object.values(data)
    const sets = keys.map((k, i) => `${k} = $${i + 2}`)
    const sql = `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1 RETURNING *`
    const rows = await this.query<T>(sql, [id, ...values])
    return rows[0] ?? null
  }
}


export function unique<T>(arr: T[]): T[] { return [...new Set(arr)] }

export function isEmpty(obj: Record<string, unknown>): boolean { return Object.keys(obj).length === 0 }

export function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
  return result
}

export function flatten<T>(arr: T[][]): T[] { return arr.reduce((acc, val) => acc.concat(val), []) }

export function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, i) => start + i)
}