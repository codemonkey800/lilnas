import { env } from '@lilnas/utils/env'

import { EnvKeys } from './env'

export function buildLoggerOptions() {
  const isProduction = env(EnvKeys.NODE_ENV, 'development') === 'production'
  if (isProduction) {
    return { pinoHttp: { level: 'info' } }
  }
  return {
    pinoHttp: {
      transport: { target: 'pino-pretty' },
      level: 'debug',
    },
  }
}
