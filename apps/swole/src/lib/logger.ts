import { env } from '@lilnas/utils/env'
import { type LoggerOptions, pino } from 'pino'

import { EnvKeys } from 'src/env'

const REDACT_PATHS = [
  // pino-http shaped records (forward-compat if Next.js middleware ever binds req)
  'req.headers.authorization',
  'req.headers.cookie',
  // bare-logger shapes
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'cookie',
]

function buildOptions(): LoggerOptions {
  const isProduction = env(EnvKeys.NODE_ENV, 'development') === 'production'

  if (isProduction) {
    return {
      level: 'info',
      redact: REDACT_PATHS,
    }
  }

  const logFilePath = env(EnvKeys.LOG_FILE_PATH, '')

  if (logFilePath) {
    return {
      level: 'debug',
      redact: REDACT_PATHS,
      transport: {
        targets: [
          { target: 'pino-pretty', options: { destination: 1 } },
          {
            target: 'pino-pretty',
            options: { destination: logFilePath, mkdir: true },
          },
        ],
      },
    }
  }

  return {
    level: 'debug',
    redact: REDACT_PATHS,
    transport: { target: 'pino-pretty' },
  }
}

export const logger = pino(buildOptions())
