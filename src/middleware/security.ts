import cors from 'cors'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { env, isTest } from '../config/env.js'

export const helmetMiddleware = helmet()

export const corsMiddleware = cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
})

/**
 * Global API rate limit — 100 requests per IP per 15 minutes by default, tunable with
 * RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS. The per-route limits on login, registration and
 * voting are much tighter and are not affected by this setting.
 *
 * Disabled under test, where a suite legitimately makes hundreds of requests from one
 * address; the limiter's own behaviour is covered by its dedicated test instead.
 */
export const apiRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
  skip: () => isTest,
})
