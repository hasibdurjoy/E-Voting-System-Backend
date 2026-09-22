import cors from 'cors'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { env } from '../config/env.js'

export const helmetMiddleware = helmet()

export const corsMiddleware = cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
})

/** Global API rate limit: 100 requests per IP per 15 minutes. */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
})
