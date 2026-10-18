import express, { type Express } from 'express'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFound } from './middleware/notFound.js'
import { requestLogger } from './middleware/requestLogger.js'
import { apiRateLimiter, corsMiddleware, helmetMiddleware } from './middleware/security.js'
import apiRoutes from './routes/index.js'

export function createApp(): Express {
  const app = express()

  app.disable('x-powered-by')
  // Trust X-Forwarded-For only from the configured number of proxy hops, never blindly.
  app.set('trust proxy', env.TRUST_PROXY)

  app.use(helmetMiddleware)
  app.use(corsMiddleware)
  app.use(requestLogger)
  app.use(express.json({ limit: '100kb' }))
  app.use(express.urlencoded({ extended: false, limit: '100kb' }))

  app.use('/api', apiRateLimiter, apiRoutes)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
