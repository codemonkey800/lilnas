import type { Request } from 'express'

// Set by Traefik's `lilnas-auth` ForwardAuth middleware
// (infra/proxy.yml's authResponseHeaders=X-Forwarded-User,X-Forwarded-User-Id)
// on every request that reaches this container — Traefik's ForwardAuth is
// the ONLY network path into apps/download (deploy.yml's
// traefik.http.routers.download.middlewares=lilnas-auth), so these two
// headers are trusted at the app layer for the same reason Grafana's own
// native auth-proxy config trusts X-Forwarded-User.
export interface ForwardedUser {
  email: string
  userId: string
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

// Pure extraction — both ForwardedUserGuard and @CurrentUser() call this
// directly rather than one trusting request mutation from the other, so
// either can be used ALONE and still correctly reject missing identity.
export function getForwardedUser(req: Request): ForwardedUser | undefined {
  const email = firstHeaderValue(req.headers['x-forwarded-user'])
  const userId = firstHeaderValue(req.headers['x-forwarded-user-id'])
  if (!email || !userId) {
    return undefined
  }
  return { email, userId }
}
