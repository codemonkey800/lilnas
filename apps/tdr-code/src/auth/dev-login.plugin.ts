import { timingSafeEqual } from 'node:crypto'

import type { BetterAuthPlugin } from 'better-auth'
import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
} from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'

import { EnvKeys } from 'src/env'
import { getBackendLogger } from 'src/logging/backend-logger'
import { LOG_EVENTS } from 'src/logging/log-events'

// Dev-only agent login — see PLAN.md at the app root for the full design and
// threat model. A Better Auth PLUGIN (not a NestJS controller) exposing
// POST /dev-login, included in buildAuth()'s `plugins` array (auth.ts) only
// when isDevLoginEnabled() below returns true. It mirrors exactly how Better
// Auth's own signInEmail mints a session (installed
// better-auth/dist/api/routes/sign-in.mjs:
// `internalAdapter.createSession(user.id, dontRememberMe)` then
// `setSessionCookie(ctx, { session, user })`) — this endpoint does the same
// two calls for a fixed synthetic user instead of a real credential check,
// so the resulting session is byte-for-byte what AuthGuard's
// auth.api.getSession() already accepts.
//
// Deliberately calls internalAdapter.createUser() directly — never
// createOAuthUser() or anything that inserts an `account` row.
// auth.ts's databaseHooks.account.create.before guild-gate hook only fires
// on an `account` model create (see guild-gate.ts's own header comment,
// traced against with-hooks.mjs's createWithHooks call sites); a bare `user`
// row with no paired `account` row never reaches that hook, by construction.
// That is what makes this endpoint safe to add without touching the guild
// gate at all — it cannot accidentally satisfy or bypass a check that only
// ever runs for a different code path.

// Exported so dev-login.plugin.spec.ts asserts against this exact value
// rather than a second, hand-typed literal that could silently drift.
export const SYNTHETIC_USER = {
  // Deterministic email so repeated logins find-or-create ONE row, and so
  // it's trivially greppable in the DB/logs. The '.invalid' TLD (RFC 2606)
  // mirrors auth.ts's own synthetic-email convention for Discord accounts
  // with no public email (see mapProfileToUser in auth.ts) — same shape, so
  // a reviewer scanning the `user` table for synthetic rows only needs to
  // recognize one pattern instead of two.
  email: 'agent@dev.tdr-code.invalid',
  name: 'Dev Agent',
} as const

function secretMatches(
  presented: string | undefined,
  expected: string,
): boolean {
  if (!presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// True only when ALL THREE gates hold: not production, the feature flag is
// exactly '1', and a secret is configured. Throws (rather than returning
// false) when the flag is set in production — auth.ts's buildAuth()
// evaluates this synchronously while constructing betterAuth()'s own options
// object, so a misconfigured prod host fails to boot instead of silently
// shipping the door closed-but-present.
export function isDevLoginEnabled(): boolean {
  const flag = process.env[EnvKeys.TDR_CODE_DEV_LOGIN] === '1'
  const isProd = process.env[EnvKeys.NODE_ENV] === 'production'
  if (flag && isProd) {
    throw new Error(
      'TDR_CODE_DEV_LOGIN must never be set in production (NODE_ENV=production).',
    )
  }
  const hasSecret = !!process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET]
  return flag && !isProd && hasSecret
}

// Only ever constructed by auth.ts when isDevLoginEnabled() has already
// returned true, so expectedSecret below is guaranteed non-empty by the time
// any request can reach this endpoint.
export function devLoginPlugin(): BetterAuthPlugin {
  const expectedSecret = process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET] ?? ''

  return {
    id: 'tdr-code-dev-login',
    endpoints: {
      devLogin: createAuthEndpoint(
        '/dev-login',
        {
          method: 'POST',
          // Better Auth's router already runs originCheckMiddleware on every
          // path (installed better-auth/dist/api/index.mjs's router()), but
          // that base check only force-validates Origin when the request
          // carries a Cookie header (dist/api/middlewares/origin-check.mjs's
          // validateOrigin: `if (!(forceValidate || useCookies)) return`) —
          // useless for THIS endpoint's very first call, which by definition
          // has no session cookie yet. formCsrfMiddleware is the same guard
          // signInEmail uses for its own unauthenticated, session-minting
          // POST: it force-validates whenever an Origin/Referer header is
          // present at all, and separately blocks a Sec-Fetch-Site:
          // cross-site + Sec-Fetch-Mode: navigate combination outright —
          // exactly the drive-by/DNS-rebind shape PLAN.md's guardrail #5
          // calls out, using Better Auth's own vetted trustedOrigins check
          // instead of a hand-rolled one.
          use: [formCsrfMiddleware],
        },
        async ctx => {
          const presented = ctx.headers?.get('x-dev-login-secret') ?? undefined
          if (!secretMatches(presented, expectedSecret)) {
            getBackendLogger().warn(
              { event: LOG_EVENTS.devLoginRejected },
              'dev-login rejected: bad or missing secret',
            )
            // THROW, don't `return ctx.json(body, { status: 403 })` — that
            // status override is a no-op for a normal router-dispatched HTTP
            // request (confirmed in installed better-call@1.3.7's
            // context.mjs: `json: (json, routerResponse) => { if
            // (!context.asResponse) return json; ... }` — asResponse is
            // false at this layer for a real request, so `routerResponse`
            // is silently discarded and the response falls back to its
            // implicit 200). Throwing an APIError is the pattern every
            // other rejection in this codebase's Better Auth surface uses
            // (signInEmail's UNAUTHORIZED throws, auth.ts's own guild-gate
            // 'not guild member' throw) — better-call's toResponse() maps a
            // caught APIError's `statusCode` onto the real HTTP status.
            throw new APIError('FORBIDDEN', { message: 'forbidden' })
          }

          const ia = ctx.context.internalAdapter
          const existing = await ia.findUserByEmail(SYNTHETIC_USER.email)
          const user =
            existing?.user ??
            (await ia.createUser({
              email: SYNTHETIC_USER.email,
              name: SYNTHETIC_USER.name,
              emailVerified: false,
            }))

          const session = await ia.createSession(user.id, false)
          await setSessionCookie(ctx, { session, user })

          getBackendLogger().warn(
            { event: LOG_EVENTS.devLoginMinted, userId: user.id },
            'dev-login minted a session for the synthetic agent user',
          )
          return ctx.json({ ok: true })
        },
      ),
    },
  }
}
