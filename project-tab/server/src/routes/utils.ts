import type { Request, Response } from 'express'
import type { ZodSchema } from 'zod'

/**
 * Parses and validates a request body against a Zod schema.
 */
export function parseBody<T>(req: Request, res: Response, schema: ZodSchema<T>): T | null {
  const parsed = schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.issues
    })
    return null
  }

  return parsed.data
}
