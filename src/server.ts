import { createApp } from './app.js'
import { connectDatabase, disconnectDatabase } from './config/database.js'
import { env } from './config/env.js'
import { isRelayerAuthorized } from './services/relayer.service.js'
import { startEventListener, stopEventListener } from './services/events.service.js'
import { isContractConfigured, isWalletConfigured } from './blockchain/index.js'
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

    // The chain is authoritative, so the cache is reconciled continuously rather than only
    // when a request happens to touch it.
    startEventListener()

    // A relayer without RELAYER_ROLE fails every write. Saying so at startup beats
    // discovering it when the first voter tries to register.
    if (isContractConfigured() && isWalletConfigured()) {
      void isRelayerAuthorized().then((authorized) => {
        if (!authorized) {
          logger.warn(
            'The backend signer does not hold RELAYER_ROLE: registrations, votes and admin ' +
              'writes will all revert. Grant the role (see the contracts INTEGRATION guide §1).',
          )
        }
      })
    }
  })

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`)
    stopEventListener()
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
