import type { RequestHandler } from 'express'
import type { z } from 'zod'
import { ApiError } from '../utils/ApiError.js'

interface RequestSchemas {
  body?: z.ZodType
  params?: z.ZodType
  query?: z.ZodType
}

/**
 * Validates request body/params/query against Zod schemas.
 * Parsed values are stored on `res.locals.validated` (Express 5 makes `req.query` read-only).
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, res, next) => {
    const validated: Record<string, unknown> = {}
    for (const key of ['body', 'params', 'query'] as const) {
      const schema = schemas[key]
      if (!schema) continue
      const result = schema.safeParse(req[key])
      if (!result.success) {
        return next(
          ApiError.badRequest(
            `Invalid request ${key}`,
            result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          ),
        )
      }
      validated[key] = result.data
    }
    res.locals.validated = validated
    next()
  }
}
