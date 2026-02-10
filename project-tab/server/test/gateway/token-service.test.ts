import { describe, expect, it } from 'vitest'

import { TokenService } from '../../src/gateway/token-service'

const TEST_SECRET = new Uint8Array(32).fill(42)

function makeService(overrides: {
  ttlMs?: number
  nowFn?: () => number
} = {}) {
  return new TokenService({
    secret: TEST_SECRET,
    defaultTtlMs: overrides.ttlMs ?? 60_000, // 1 minute for fast tests
    issuer: 'test',
    nowFn: overrides.nowFn,
  })
}

describe('TokenService', () => {
  describe('issueToken', () => {
    it('returns a JWT string and expiration date', async () => {
      const service = makeService()
      const result = await service.issueToken('agent-1')

      expect(typeof result.token).toBe('string')
      expect(result.token.split('.')).toHaveLength(3) // JWT format: header.payload.signature
      expect(typeof result.expiresAt).toBe('string')
      // Should be a valid ISO date
      expect(new Date(result.expiresAt).toISOString()).toBe(result.expiresAt)
    })

    it('sets expiration based on default TTL', async () => {
      const now = Date.parse('2026-02-10T12:00:00.000Z')
      const service = makeService({
        ttlMs: 3600_000, // 1 hour
        nowFn: () => now,
      })

      const result = await service.issueToken('agent-1')
      const expiresAt = new Date(result.expiresAt)

      // Should expire in 1 hour
      expect(expiresAt.getTime()).toBe(now + 3600_000)
    })

    it('respects custom TTL', async () => {
      const now = Date.parse('2026-02-10T12:00:00.000Z')
      const service = makeService({ nowFn: () => now })

      const result = await service.issueToken('agent-1', undefined, 120_000)
      const expiresAt = new Date(result.expiresAt)

      // Should expire in 2 minutes
      expect(expiresAt.getTime()).toBe(now + 120_000)
    })

    it('includes sandboxId in token when provided', async () => {
      const service = makeService()
      const result = await service.issueToken('agent-1', 'sandbox-abc')

      const claims = await service.validateToken(result.token)
      expect(claims.agentId).toBe('agent-1')
      expect(claims.sandboxId).toBe('sandbox-abc')
    })

    it('issues unique tokens for different agents', async () => {
      const service = makeService()

      const t1 = await service.issueToken('agent-1')
      const t2 = await service.issueToken('agent-2')

      expect(t1.token).not.toBe(t2.token)
    })
  })

  describe('validateToken', () => {
    it('validates a correctly issued token', async () => {
      const service = makeService()
      const { token } = await service.issueToken('agent-1', 'sandbox-xyz')

      const claims = await service.validateToken(token)

      expect(claims.agentId).toBe('agent-1')
      expect(claims.sandboxId).toBe('sandbox-xyz')
      expect(claims.sub).toBe('agent-1')
      expect(claims.iss).toBe('test')
    })

    it('rejects expired tokens', async () => {
      let now = Date.parse('2026-02-10T12:00:00.000Z')
      const service = makeService({
        ttlMs: 60_000, // 1 minute
        nowFn: () => now,
      })

      const { token } = await service.issueToken('agent-1')

      // Advance time past expiration
      now += 120_000 // 2 minutes later

      await expect(service.validateToken(token)).rejects.toThrow()
    })

    it('rejects tokens with wrong secret', async () => {
      const service1 = new TokenService({
        secret: new Uint8Array(32).fill(1),
        issuer: 'test',
      })
      const service2 = new TokenService({
        secret: new Uint8Array(32).fill(2),
        issuer: 'test',
      })

      const { token } = await service1.issueToken('agent-1')

      await expect(service2.validateToken(token)).rejects.toThrow()
    })

    it('rejects tampered tokens', async () => {
      const service = makeService()
      const { token } = await service.issueToken('agent-1')

      // Tamper with the payload
      const parts = token.split('.')
      parts[1] = parts[1] + 'X'
      const tampered = parts.join('.')

      await expect(service.validateToken(tampered)).rejects.toThrow()
    })

    it('rejects malformed strings', async () => {
      const service = makeService()

      await expect(service.validateToken('not-a-jwt')).rejects.toThrow()
      await expect(service.validateToken('')).rejects.toThrow()
    })

    it('allows tokens within clock tolerance', async () => {
      let now = Date.parse('2026-02-10T12:00:00.000Z')
      const service = makeService({
        ttlMs: 60_000,
        nowFn: () => now,
      })

      const { token } = await service.issueToken('agent-1')

      // Advance time to just past expiration but within 5s tolerance
      now += 62_000 // 62 seconds (2 seconds past TTL, within 5s tolerance)

      const claims = await service.validateToken(token)
      expect(claims.agentId).toBe('agent-1')
    })
  })

  describe('renewToken', () => {
    it('issues a new token with fresh TTL for the same agent', async () => {
      let now = Date.parse('2026-02-10T12:00:00.000Z')
      const service = makeService({
        ttlMs: 60_000,
        nowFn: () => now,
      })

      const original = await service.issueToken('agent-1', 'sandbox-abc')

      // Advance time to 80% of TTL (48 seconds)
      now += 48_000

      const renewed = await service.renewToken(original.token, 'agent-1')

      expect(renewed.token).not.toBe(original.token)
      // New token should expire 60s from now (48s + 60s = 108s from start)
      expect(new Date(renewed.expiresAt).getTime()).toBe(now + 60_000)
    })

    it('preserves sandboxId through renewal', async () => {
      const service = makeService()
      const original = await service.issueToken('agent-1', 'sandbox-abc')

      const renewed = await service.renewToken(original.token, 'agent-1')
      const claims = await service.validateToken(renewed.token)

      expect(claims.agentId).toBe('agent-1')
      expect(claims.sandboxId).toBe('sandbox-abc')
    })

    it('rejects renewal with mismatched agentId', async () => {
      const service = makeService()
      const { token } = await service.issueToken('agent-1')

      await expect(
        service.renewToken(token, 'agent-2')
      ).rejects.toThrow('agentId mismatch')
    })

    it('rejects renewal with expired token', async () => {
      let now = Date.parse('2026-02-10T12:00:00.000Z')
      const service = makeService({
        ttlMs: 60_000,
        nowFn: () => now,
      })

      const { token } = await service.issueToken('agent-1')

      // Advance past expiration + tolerance
      now += 300_000 // 5 minutes

      await expect(
        service.renewToken(token, 'agent-1')
      ).rejects.toThrow()
    })

    it('rejects renewal with invalid token', async () => {
      const service = makeService()

      await expect(
        service.renewToken('garbage-token', 'agent-1')
      ).rejects.toThrow()
    })
  })

  describe('constructor defaults', () => {
    it('generates random secret when none provided', async () => {
      const s1 = new TokenService()
      const s2 = new TokenService()

      // Different services should have different secrets
      const t1 = await s1.issueToken('agent-1')
      await expect(s2.validateToken(t1.token)).rejects.toThrow()
    })

    it('uses 1-hour default TTL', async () => {
      const now = Date.parse('2026-02-10T12:00:00.000Z')
      const service = new TokenService({
        secret: TEST_SECRET,
        nowFn: () => now,
      })

      const { expiresAt } = await service.issueToken('agent-1')
      const diff = new Date(expiresAt).getTime() - now

      expect(diff).toBe(3600_000) // 1 hour
    })
  })
})
