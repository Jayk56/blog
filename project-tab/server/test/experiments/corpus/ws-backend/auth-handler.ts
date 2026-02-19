// Authentication handler for the backend API
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


export function parseJWT(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT format')
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  return { header, payload }
}


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
  return `${header}.${body}.signature-placeholder`
}


export function flatten<T>(arr: T[][]): T[] { return arr.reduce((acc, val) => acc.concat(val), []) }

export function omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) delete result[key]
  return result as Omit<T, K>
}

export function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, i) => start + i)
}