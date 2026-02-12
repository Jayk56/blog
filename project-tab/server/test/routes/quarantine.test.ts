import { beforeEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import express from 'express'

import { createQuarantineRouter } from '../../src/routes/quarantine'
import { quarantineEvent, clearQuarantine, getQuarantined } from '../../src/validation/quarantine'
import { ZodError } from 'zod'

let testPort = 9600

function createTestApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/quarantine', createQuarantineRouter())
  const port = testPort++
  const server = createServer(app as any)
  const baseUrl = `http://localhost:${port}`

  return {
    server,
    baseUrl,
    async start() {
      await new Promise<void>((resolve) => server.listen(port, resolve))
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function makeFakeError(message = 'Required'): ZodError {
  return new ZodError([
    {
      code: 'invalid_type',
      expected: 'string',
      received: 'undefined',
      path: ['runId'],
      message,
    },
  ])
}

describe('quarantine routes', () => {
  beforeEach(() => {
    clearQuarantine()
  })

  describe('GET /api/quarantine', () => {
    it('returns empty array when no events quarantined', async () => {
      const app = createTestApp()
      await app.start()
      try {
        const res = await fetch(`${app.baseUrl}/api/quarantine`)
        expect(res.status).toBe(200)
        const body = await res.json() as any
        expect(body).toEqual({ events: [] })
      } finally {
        await app.close()
      }
    })

    it('returns quarantined events', async () => {
      const app = createTestApp()
      await app.start()
      try {
        quarantineEvent({ sourceEventId: 'bad-1', event: { type: 'bogus' } }, makeFakeError())

        const res = await fetch(`${app.baseUrl}/api/quarantine`)
        expect(res.status).toBe(200)
        const body = await res.json() as any
        expect(body.events).toHaveLength(1)
        expect(body.events[0].raw.sourceEventId).toBe('bad-1')
        expect(body.events[0].quarantinedAt).toBeTypeOf('string')
      } finally {
        await app.close()
      }
    })

    it('returns multiple quarantined events', async () => {
      const app = createTestApp()
      await app.start()
      try {
        quarantineEvent({ bad: 1 }, makeFakeError())
        quarantineEvent({ bad: 2 }, makeFakeError())
        quarantineEvent({ bad: 3 }, makeFakeError())

        const res = await fetch(`${app.baseUrl}/api/quarantine`)
        expect(res.status).toBe(200)
        const body = await res.json() as any
        expect(body.events).toHaveLength(3)
      } finally {
        await app.close()
      }
    })
  })

  describe('DELETE /api/quarantine', () => {
    it('clears quarantined events', async () => {
      const app = createTestApp()
      await app.start()
      try {
        quarantineEvent({ bad: 1 }, makeFakeError())
        quarantineEvent({ bad: 2 }, makeFakeError())
        expect(getQuarantined()).toHaveLength(2)

        const res = await fetch(`${app.baseUrl}/api/quarantine`, { method: 'DELETE' })
        expect(res.status).toBe(200)
        const body = await res.json() as any
        expect(body).toEqual({ cleared: true })
        expect(getQuarantined()).toHaveLength(0)
      } finally {
        await app.close()
      }
    })

    it('succeeds even when quarantine is already empty', async () => {
      const app = createTestApp()
      await app.start()
      try {
        const res = await fetch(`${app.baseUrl}/api/quarantine`, { method: 'DELETE' })
        expect(res.status).toBe(200)
        const body = await res.json() as any
        expect(body).toEqual({ cleared: true })
      } finally {
        await app.close()
      }
    })
  })
})
