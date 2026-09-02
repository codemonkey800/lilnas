export interface AdminCheckResponse {
  isAdmin: boolean
}

/**
 * The forwarded identity Traefik's `lilnas-auth` ForwardAuth middleware puts
 * on a request (`X-Forwarded-User`/`X-Forwarded-User-Id`, see
 * `infra/proxy.yml`'s `authResponseHeaders`). App-agnostic on purpose - it is
 * the lilnas-wide identity shape, not any one service's. See
 * `apps/download/src/auth/forwarded-user.ts` for the trust model that decides
 * when these headers may be believed.
 */
export interface ForwardedUser {
  email: string
  userId: string
}

/** `GET /auth/whoami`'s response - the caller's identity plus admin status. */
export interface WhoamiResponse extends ForwardedUser {
  isAdmin: boolean
}
