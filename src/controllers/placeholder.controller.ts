import type { RequestHandler } from 'express'
import { ApiError } from '../utils/ApiError.js'

/** Temporary handler for modules that will be implemented in a later phase. */
export const notImplemented =
  (moduleName: string): RequestHandler =>
  (_req, _res, next) => {
    next(ApiError.notImplemented(`${moduleName} API is not implemented yet`))
  }
