import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { env } from '@lilnas/utils/env'
import { betterAuth } from 'better-auth'

import type { Db } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { EnvKeys } from 'src/env'

// Discord profile shape relevant to email synthesis — Better Auth passes the
// raw provider profile to mapProfileToUser; we only touch `email`/`id`.
interface DiscordProfile {
  id: string
  email?: string | null
}

// Same origin-config source the console controllers' requireSameOrigin()
// checks use (config.controller.ts / git-identity.controller.ts /
// lifecycle.controller.ts) — keeps all four origin-config points (that env
// var, Better Auth baseURL/trustedOrigins, the Discord portal redirect URI,
// and the client baseURL) in sync per the plan's "Origin-config parity" note.
const ALLOWED_ORIGIN =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'

// INTERNAL mount path — what NestJS sees on req.url after Next's rewrite
// strips '/api' (next.config.js: '/api/:path*' -> ':path*'). Exported so
// auth.module.ts's basePath-gate config and its req.url rewrite (see that
// file's long comment for why the rewrite exists) both reference this one
// literal instead of two independently-typed copies that could drift.
export const INTERNAL_AUTH_BASE_PATH = '/auth'

// PUBLIC path segment — what the browser/Discord Developer Portal see,
// nested under Next's '/api' rewrite prefix so requests actually reach
// NestJS at all. Also exported for auth.module.ts's rewrite.
export const PUBLIC_AUTH_PATH_SEGMENT = '/api/auth'

// Builds the betterAuth() instance on the app's shared DB client (no second
// better-sqlite3 handle — see the Two-writer WAL note in the plan).
//
// Public/internal path split — CORRECTED from the plan's initial sketch
// (verified against actual source, not assumed; the discrepancy is
// load-bearing enough to spell out in full):
//
// The plan assumed the instance's own `basePath` field would make Better
// Auth's HANDLER match the internal, post-strip path (`/auth/*`) while
// `baseURL` independently carried the public path for link generation. This
// is only HALF true. Two separate layers consult basePath differently:
//
//   1. @thallesp's OWN gate (matchesBasePath in dist/index.mjs:643-645,
//      driven by `this.basePath = this.options.auth.options.basePath` at
//      dist/index.mjs:773-775) DOES read the instance's `basePath` field
//      directly, and correctly matches '/auth/*' when basePath is '/auth'.
//   2. Better Auth's OWN internal router (better-auth/dist/api/index.mjs:152:
//      `const basePath = new URL(ctx.baseURL).pathname`) does NOT consult
//      `options.basePath` for matching AT ALL — it derives its match/strip
//      prefix, and the redirect_uri it generates
//      (better-auth/dist/api/routes/sign-in.mjs:133:
//      `${c.context.baseURL}/callback/${provider.id}`), BOTH from baseURL's
//      own URL pathname. `basePath` is only consulted as a fallback when
//      `baseURL` is unset entirely (better-auth/dist/auth/base.mjs:19-20).
//
// Empirically verified (calling auth.handler() directly, and via
// @thallesp's real toNodeHandler plumbing): with baseURL carrying
// '/api/auth', the handler matches ONLY '/api/auth/*' and 404s on
// '/auth/*' — even though the instance's basePath is '/auth' and
// @thallesp's OWN gate correctly passes the request through to the
// handler. Gate (1) passing is necessary but not sufficient; the handler
// itself (2) still rejects it.
//
// Given the app's fixed request-path reality (Browser -> Traefik -> nginx
// -> Next :8080 -> '/api' rewrite (STRIPS '/api', unconditionally, for
// every route) -> NestJS :8082), NestJS only ever sees the post-strip
// '/auth/*' form — there is no way to make a browser-initiated request
// literally arrive at NestJS as '/api/auth/*' without changing that
// rewrite (next.config.js, out of scope for this unit — U6's file). And
// baseURL must carry '/api/auth' for the redirect_uri to be
// byte-identical to what's registered in the Discord Developer Portal
// (https://tdr-code.lilnas.io/api/auth/callback/discord) — the Discord
// redirect goes straight to that PUBLIC URL, which only reaches NestJS at
// all because Next's rewrite recognizes the '/api' prefix; a bare
// '/auth/callback/discord' redirect_uri would 404 from Next.js itself,
// never reaching the backend.
//
// Resolution (implemented in auth.module.ts, not here): baseURL keeps the
// public, '/api/auth'-prefixed value (correct redirect_uri + correct
// internal router matching once the path is corrected); the instance's
// basePath stays '/auth' (for @thallesp's gate to pass post-strip
// requests through); and auth.module.ts's `middleware` hook re-prepends
// '/api' onto req.url right before Better Auth's own handler runs, so the
// handler sees a path consistent with baseURL's pathname. This
// reconciles the mismatch entirely within this unit's own files.
export function buildAuth(db: Db) {
  const betterAuthUrl = env(EnvKeys.BETTER_AUTH_URL)

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
      // Do NOT set transaction: true — better-sqlite3 is synchronous and
      // Better Auth's transaction callback is async; the adapter's own
      // default is already `false` (confirmed in
      // @better-auth/drizzle-adapter's dist/index.d.mts), so this is
      // explicit rather than relied-upon.
      transaction: false,
    }),

    basePath: INTERNAL_AUTH_BASE_PATH,
    baseURL: `${betterAuthUrl}${PUBLIC_AUTH_PATH_SEGMENT}`,
    secret: env(EnvKeys.BETTER_AUTH_SECRET),

    // String array, not a function — @thallesp's AuthModule.configure()
    // throws at boot if trustedOrigins is set and is not an array
    // (dist/index.mjs:838-841: "Function-based trustedOrigins not supported
    // in NestJS"), even though better-auth's own type permits a function
    // form. Sourced from the same env var the console controllers'
    // requireSameOrigin() checks use, so this can't drift from them.
    trustedOrigins: [ALLOWED_ORIGIN],

    // Keep the default `database` state strategy (do NOT set
    // storeStateStrategy: 'cookie') — with a `database` adapter configured,
    // better-auth's own default is already 'database' (OAuth state lives in
    // the `verification` table keyed by the URL query param), which sidesteps
    // the state_mismatch-via-rewrite hazard a cookie round-trip would
    // reintroduce under the /api-stripping rewrite. Left unset intentionally.

    // Session TTL is a security knob here, not a library default: sign-in-
    // only guild checking (U3) means a kicked/compromised member keeps full
    // access to an RCE-equivalent surface until the session expires.
    //   expiresIn: 60*60*12 (12h)  — absolute session lifetime, in seconds
    //     (better-auth default is 7 days; this overrides it down).
    //   updateAge: 60*60 (1h)     — rolling refresh window, in seconds: the
    //     session's expiry is extended by another 12h once at least 1h has
    //     elapsed since it was last refreshed, so an active user's session
    //     keeps rolling forward while an abandoned one still hits the 12h
    //     ceiling. Field names/units confirmed against
    //     @better-auth/core's init-options type (`session.expiresIn`/
    //     `session.updateAge`, both documented in seconds).
    session: {
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
    },

    socialProviders: {
      discord: {
        clientId: env(EnvKeys.DISCORD_CLIENT_ID),
        clientSecret: env(EnvKeys.DISCORD_CLIENT_SECRET),
        // Better Auth's Discord provider already defaults to
        // ['identify', 'email'] and CONCATENATES (not replaces) any `scope`
        // array onto that default (confirmed against the provider source),
        // so this only needs the one addition the guild gate (U3) will use.
        scope: ['guilds.members.read'],
        // Discord does not always return an email (depends on
        // scope/consent) — synthesize a stable placeholder so Better Auth's
        // NOT NULL `user.email` column never fails the insert. Returning
        // `email` here overrides the provider's own `profile.email` value
        // (the library spreads mapProfileToUser's return after the base
        // assignment), and `emailVerified: false` avoids ever claiming a
        // synthetic address is a verified one.
        mapProfileToUser: (profile: DiscordProfile) => {
          if (profile.email) return {}
          return {
            email: `discord-${profile.id}@users.noreply.tdr-code.invalid`,
            emailVerified: false,
          }
        },
      },
    },

    // Only the Discord social provider — no admin/org/multi-session/
    // list-accounts plugins, so the mounted handler's public route set stays
    // limited to sign-in / callback / sign-out / get-session (no
    // public-by-construction routes from a plugin).
    plugins: [],

    // TODO(U3): wire the guild-membership gate here. The seam (request-level
    // `hooks.before` on the callback path vs `databaseHooks.account.create
    // .before`) is decided by U3's own runtime probe against a real Discord
    // OAuth as a non-member — see the plan's "Guild-gate seam decision
    // matrix". Do not add `hooks` or `databaseHooks` keys speculatively here;
    // U3 owns that decision and the seam wiring.

    // TODO(U3): token persistence. Better Auth's `account` table stores
    // accessToken/refreshToken by default (confirmed: no first-class "don't
    // persist" option exists in 1.6.23 — the closest typed seam is
    // `databaseHooks.account.create.before`/`update.before` returning
    // `{ data: { ...account, accessToken: null, refreshToken: null } }`, or
    // `account.encryptOAuthTokens: true` which encrypts at rest but still
    // persists). R18 is a sign-in-only check, so U3 should decide whether to
    // null the tokens out via that hook or accept encryption-at-rest instead
    // of guessing at partial config here.
  })
}

export type Auth = ReturnType<typeof buildAuth>
