import mongoose from 'mongoose'
import { logger } from '../utils/logger.js'

/** Strips credentials from a MongoDB URI so it is safe to log. */
function redactUri(uri: string): string {
  return uri.replace(/\/\/[^@/]+@/, '//***:***@')
}

export async function connectDatabase(uri: string): Promise<typeof mongoose> {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'))
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'))
  mongoose.connection.on('error', (error) => logger.error('MongoDB connection error', error))

  try {
    const connection = await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 })
    logger.info(`MongoDB connected: ${connection.connection.host}/${connection.connection.name}`)
    return connection
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to connect to MongoDB at ${redactUri(uri)}: ${reason}\n` +
        '  Make sure MongoDB is running and MONGODB_URI in .env is correct.',
      { cause: error },
    )
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect()
  logger.info('MongoDB connection closed')
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected
}
