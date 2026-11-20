import type { ForwardedUser } from '@lilnas/utils/auth/types'
import { env } from '@lilnas/utils/env'
import { Logger } from '@nestjs/common'
import type { IncomingHttpHeaders } from 'http'

import { EnvKeys } from 'src/env'

// Set by Traefik's `lilnas-auth` ForwardAuth middleware on requests that
// arrive via Traefik on port 8080 and are proxied by the frontend container.
// Every Nest route lives on 8081, which has no Traefik router and is reachable
// by any other container on the shared lilnas Docker network, so these headers
// are trusted on the same basis as apps/download's: the Docker network is the
// trust boundary, not Traefik.
export type { ForwardedUser } from '@lilnas/utils/auth/types'

const logger = new Logger('ForwardedUser')

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

// Takes `{ headers }` rather than express's `Request` so the WebSocket
// handshake (a raw `http.IncomingMessage`) can pass its request straight in.
export function getForwardedUser(req: {
  headers: IncomingHttpHeaders
}): ForwardedUser | undefined {
  const email = firstHeaderValue(req.headers['x-forwarded-user'])
  const userId = firstHeaderValue(req.headers['x-forwarded-user-id'])
  if (!email || !userId) {
    return undefined
  }
  return { email, userId }
}

// Dev-only fallback identity, for browser traffic in dev (which has no
// lilnas-auth in front of it and cannot set X-Forwarded-User itself). Two
// independent conditions, both required:
//   1. NODE_ENV !== 'production': the runtime image sets it to production, so
//      this is false in every deployed container.
//   2. DEV_USER_EMAIL and DEV_USER_ID are both set: production never defines
//      them, so this stays inert even if NODE_ENV were ever wrong.
export function resolveForwardedUser(req: {
  headers: IncomingHttpHeaders
}): ForwardedUser | undefined {
  const real = getForwardedUser(req)
  if (real) return real

  if (env(EnvKeys.NODE_ENV, 'development') === 'production') {
    return undefined
  }

  const email = env(EnvKeys.DEV_USER_EMAIL, '')
  const userId = env(EnvKeys.DEV_USER_ID, '')
  if (!email || !userId) {
    return undefined
  }

  logger.warn(
    { action: 'resolveForwardedUser', email },
    'No X-Forwarded-User headers present: using DEV_USER_EMAIL/DEV_USER_ID fallback identity',
  )

  return { email, userId }
}
