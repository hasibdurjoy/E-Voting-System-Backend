import morgan from 'morgan'
import { isProduction, isTest } from '../config/env.js'

export const requestLogger = morgan(isProduction ? 'combined' : 'dev', {
  skip: () => isTest,
})
