import { createApp } from './app.js'
import { connectDatabase, disconnectDatabase } from './config/database.js'
import { env } from './config/env.js'
import { logger } from './utils/logger.js'

async function bootstrap() {
  await connectDatabase(env.MONGODB_URI)

  const app = createApp()
  const server = app.listen(env.PORT, (error) => {
    // Express 5 passes listen errors (e.g. EADDRINUSE) to this callback instead of throwing.
    if (error) {
      const hint =
        'code' in error && error.code === 'EADDRINUSE'
          ? ` Port ${env.PORT} is already in use — change PORT in .env` +
            (env.PORT === 5000 ? ' (on macOS, AirPlay Receiver uses port 5000).' : '.')
          : ''
      logger.error(`Failed to start HTTP server: ${error.message}.${hint}`)
      void disconnectDatabase().finally(() => process.exit(1))
      return
    }
    logger.info(`E-Voting System API listening on http://localhost:${env.PORT}/api (${env.NODE_ENV})`)
  })

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`)
    server.close(async () => {
      await disconnectDatabase()
      process.exit(0)
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason)
  process.exit(1)
})

bootstrap().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : 'Failed to start server', error instanceof Error ? undefined : error)
  process.exit(1)
})
