import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { isProduction } from '../config/env.js'
import type { ApiResponse } from '../types/api.js'
import { ApiError } from '../utils/ApiError.js'
import { logger } from '../utils/logger.js'

/** Centralized error handler — every error reaching Express ends up here and is logged. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let statusCode = 500
  let message = 'Internal server error'
  let errors: unknown

  if (err instanceof ApiError) {
    statusCode = err.statusCode
    message = err.message
    errors = err.details
  } else if (err instanceof ZodError) {
    statusCode = 400
    message = 'Validation failed'
    errors = err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
  } else if (err?.type === 'entity.parse.failed') {
    statusCode = 400
    message = 'Malformed JSON in request body'
  } else if (err?.type === 'entity.too.large') {
    statusCode = 413
    message = 'Request body too large'
  } else if (!isProduction && err instanceof Error) {
    message = err.message
  }

  const operational = err instanceof ApiError || err instanceof ZodError || statusCode < 500
  if (!operational) {
    // Unexpected error: log with stack trace.
    logger.error(`${req.method} ${req.originalUrl} -> ${statusCode}`, err)
  } else if (statusCode >= 500) {
    logger.warn(`${req.method} ${req.originalUrl} -> ${statusCode}: ${message}`)
  } else {
    logger.debug(`${req.method} ${req.originalUrl} -> ${statusCode}: ${message}`)
  }

  const body: ApiResponse = { success: false, message }
  if (errors !== undefined) body.errors = errors
  res.status(statusCode).json(body)
}
