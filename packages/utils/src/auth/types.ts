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

/**
 * A Discord account as auth last observed it. Snowflakes exceed
 * `Number.MAX_SAFE_INTEGER`, so `discordUserId` is always a string (auth
 * validates it against `/^\d{17,20}$/`). `displayName` is Discord's
 * `globalName`, which is nullable on Discord's own API.
 */
export interface DiscordIdentity {
  discordUserId: string
  username: string
  displayName: string | null
}

/** The lilnas account a Discord identity resolves to, once linked. */
export interface DiscordLinkedUser {
  userId: string
  email: string
  name: string
}

/**
 * Exactly one key must be supplied; auth answers `GET /internal/discord-link`
 * with a 400 when zero or two-or-more are present.
 */
export type DiscordLinkLookupParams =
  | { discordUserId: string }
  | { userId: string }
  | { email: string }

/**
 * `GET /internal/discord-link`'s response.
 *
 * Both halves are independently nullable: an observed-but-unlinked account has
 * an `identity` and no `user`; a snowflake auth has never seen has neither.
 *
 * - unseen snowflake -> `{ identity: null, user: null }` at HTTP **200**, not a
 *   404. Keeping "unknown" a 200 means an old auth deploy returning 404 stays
 *   distinguishable from a genuine "not linked", so callers that fail open can
 *   tell a deploy skew apart from an answer.
 * - observed but unlinked -> `{ identity: {...}, user: null }`.
 * - linked -> both present.
 *
 * The envelope is two-part rather than a single `link` field because callers
 * need both halves and should not pay for two round trips: `user` carries the
 * resolved lilnas identity when linked, while `identity` carries the current
 * Discord handle, which is what an *unlinked* Discord job renders.
 */
export interface DiscordLinkLookupResponse {
  identity: DiscordIdentity | null
  user: DiscordLinkedUser | null
}
