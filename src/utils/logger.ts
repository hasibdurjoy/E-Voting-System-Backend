type Level = 'info' | 'warn' | 'error' | 'debug'

function log(level: Level, message: string, meta?: unknown) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()}: ${message}`
  const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  if (meta === undefined) writer(line)
  else writer(line, meta)
}

export const logger = {
  info: (message: string, meta?: unknown) => log('info', message, meta),
  warn: (message: string, meta?: unknown) => log('warn', message, meta),
  error: (message: string, meta?: unknown) => log('error', message, meta),
  debug: (message: string, meta?: unknown) => {
    if (process.env.NODE_ENV === 'development') log('debug', message, meta)
  },
}
