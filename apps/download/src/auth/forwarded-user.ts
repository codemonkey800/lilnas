import { env } from '@lilnas/utils/env'
import { Logger } from '@nestjs/common'
import type { IncomingHttpHeaders } from 'http'

import { EnvKeys } from 'src/env'

// Set by Traefik's `lilnas-auth` ForwardAuth middleware
// (infra/proxy.yml's authResponseHeaders=X-Forwarded-User,X-Forwarded-User-Id)
// on requests that arrive via Traefik on port 8080. Traefik is NOT the only
// path to this container, though — every NestJS route (including this one)
// lives on 8081, which has no Traefik router and is reachable directly by
// any other container on the shared lilnas Docker network. These headers
// are trusted here on the same basis as `apps/auth`'s own `/admin/check`
// and `/verify`: the lilnas Docker network itself is the trust boundary,
// not Traefik. What Traefik's ForwardAuth actually buys is that a *real*
// human identity lands on this header before a browser request ever
// reaches the network — it is not what restricts who can set it once a
// request is already inside.
export interface ForwardedUser {
  email: string
  userId: string
}

const logger = new Logger('ForwardedUser')

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

// Widened to `{ headers: IncomingHttpHeaders }` (rather than express's
// `Request`) — this only ever touches `.headers`, and the widened shape lets
// the WS handshake path (`DownloadGateway.handleConnection`, which receives a
// raw `http.IncomingMessage`) pass its request straight through with no
// cast.
//
// Pure extraction — both ForwardedUserGuard and @CurrentUser() call this
// directly rather than one trusting request mutation from the other, so
// either can be used ALONE and still correctly reject missing identity.
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

// Dev-only fallback identity, gated by TWO independent conditions (defense
// in depth, not redundancy):
//   1. NODE_ENV !== 'production' — set to 'production' by
//      lilnas-node-runtime.Dockerfile (inherited by lilnas-nextjs-runtime),
//      so this is false in every deployed container regardless of what
//      else is misconfigured.
//   2. DEV_USER_EMAIL/DEV_USER_ID are both actually set — .env.prod on the
//      deploy host never defines these, so this independently stays inert
//      even if NODE_ENV were ever wrong.
// Without this, exercising attribution in dev (which has no lilnas-auth —
// see infra/proxy.yml) requires setting the X-Forwarded-User headers by hand
// on every request, per docs/features/download/backend.md's Verification
// section. This is a convenience so browser traffic — which can't set those
// headers — is attributed too.
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
    'No X-Forwarded-User headers present — using DEV_USER_EMAIL/DEV_USER_ID fallback identity',
  )

  return { email, userId }
}
