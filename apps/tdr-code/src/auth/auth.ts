import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { env } from '@lilnas/utils/env'
import type { Account, GenericEndpointContext } from 'better-auth'
import { betterAuth } from 'better-auth'

import { sweepAccountlessUsers } from 'src/db/auth-sweep.repo'
import type { Db } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { EnvKeys } from 'src/env'

import { isCurrentUserGuildMember } from './guild-gate'

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

    // U3: guild-membership gate (R18, AE5) — SEAM = Option B
    // (`databaseHooks.account.create.before`), not Option A
    // (`hooks.before`). See guild-gate.ts's header comment for the full
    // file:line trace of why Option A is impossible (not merely costly):
    // `hooks.before` runs at better-auth/dist/api/dispatch.mjs's
    // `dispatchAuthEndpoint` BEFORE the callback endpoint closure that
    // performs the code→token exchange is ever invoked, so no seam at that
    // layer can see a Discord access token without a hand-rolled second
    // exchange. `databaseHooks.account.create.before` runs from
    // better-auth/dist/db/with-hooks.mjs's `createWithHooks`, called from
    // internal-adapter.mjs's `createOAuthUser` with the account payload
    // ALREADY containing the just-exchanged `accessToken` (set at
    // @better-auth/core's oauth2/link-account.mjs before that call) — this
    // is a genuine seam, not a workaround.
    //
    // This SAME hook also resolves the other TODO(U3) — token persistence.
    // Confirmed against 1.6.23's installed types
    // (@better-auth/core's types/init-options.d.mts): there is no
    // first-class "don't persist OAuth tokens" option — only
    // `account.encryptOAuthTokens` (encrypts at rest, but still persists)
    // or a databaseHooks seam that mutates the payload before insert. R18
    // is a SIGN-IN-ONLY check (D10) — nothing downstream of the guild gate
    // ever re-presents the Discord token — so there is no reason to retain
    // it even encrypted; nulling it in the hook that already runs on every
    // `account` create is one seam doing two jobs instead of two
    // independent half-measures. (This is data-minimization, not a
    // `get-session` leak fix: better-auth/dist/api/routes/session.mjs's
    // get-session handlers only ever call `parseUserOutput`/
    // `parseSessionOutput` on the `user`/`session` rows — the `account`
    // row's accessToken/refreshToken columns were never read or returned
    // by get-session in the first place, confirmed by reading that file in
    // full, so this hook is defense-in-depth for the stored row, not a fix
    // for an existing exposure.)
    databaseHooks: {
      account: {
        create: {
          before: async (
            account: Account,
            context: GenericEndpointContext | null,
          ) => {
            // Only Discord accounts carry a guild-membership question — a
            // future non-social provider (none configured today; `plugins`
            // above is empty and only the Discord social provider exists)
            // would have no Discord accessToken to check and no guild to
            // check it against, so this gate (and the token-nulling below)
            // is scoped to providerId 'discord' rather than assuming every
            // account row is one.
            if (account.providerId !== 'discord') return

            // Every path below that is NOT "confirmed member" must reject
            // AND sweep — including isCurrentUserGuildMember throwing
            // unexpectedly (it's designed not to per guild-gate.ts's own
            // fail-closed contract, but this hook does not trust that
            // contract blindly: an uncaught throw here would otherwise skip
            // straight past the sweep call below, silently reintroducing
            // the exact orphan-`user`-row leak the sweep exists to close).
            // try/catch here is the SAME "never allow on ambiguity"
            // principle lookupGuildMembership already applies to its own
            // fetch() call, just applied one layer up so a gate-internal
            // exception can't bypass the compensating cleanup either.
            let isMember: boolean
            try {
              // accessToken is optional on the Account type (some
              // providers/flows omit it) — treat a missing token as
              // fail-closed too: no token means no way to prove membership.
              isMember = account.accessToken
                ? await isCurrentUserGuildMember(account.accessToken)
                : false
            } catch (error) {
              context?.context.logger.error(
                'guild_gate_check_error: guild-membership check threw; treating as non-member (fail-closed)',
                error,
              )
              isMember = false
            }

            if (isMember) {
              // Allowed: let the INSERT proceed, but with the just-checked
              // Discord token replaced by null — R18 needed it only for
              // this one guild-membership check, which already happened
              // above; nothing later in the request (or any future
              // request) re-reads account.accessToken, so there's no
              // reason for it to land on disk at all. Per with-hooks.mjs's
              // createWithHooks: `if (typeof result === "object" && "data"
              // in result) actualData = { ...actualData, ...result.data }`
              // — this MERGES onto the original payload rather than
              // replacing it, so every other field (providerId, accountId,
              // scope, ...) is preserved unchanged.
              return {
                data: { accessToken: null, refreshToken: null },
              }
            }

            context?.context.logger.warn(
              'guild_gate_rejected: non-member sign-in rejected before account provisioning',
              { providerId: account.providerId },
            )

            // The sweep runs for EVERY non-member outcome reached above —
            // both the normal "Discord said no" path and the caught-throw
            // path — because both leave the exact same orphan-row shape
            // behind (see below) and neither should ever early-return past
            // this call.
            //
            // Returning `false` (per with-hooks.mjs's createWithHooks: `if
            // (result === false) return null`) makes the `account` INSERT
            // never happen — no account row, and internal-adapter.mjs's
            // handleOAuthUserInfo call chain (createOAuthUser -> "unable to
            // create user" error path) then never reaches createSession
            // either, so no session row and no session cookie. The one row
            // this CANNOT prevent is the paired `user` row: internal-
            // adapter.mjs's createOAuthUser runs createWithHooks(...,
            // "user", ...) and that INSERT commits BEFORE createWithHooks(
            // ..., "account", ...) — where this hook runs — is ever called.
            // That accountless `user` row is what auth-sweep.repo.ts's
            // sweepAccountlessUsers() cleans up immediately below, so
            // AE5's "no usable rows" holds: the row that survives has no
            // account and can never authenticate.
            const swept = sweepAccountlessUsers(db)
            context?.context.logger.warn(
              'guild_gate_sweep: accountless user rows deleted after guild-gate rejection',
              { rowsDeleted: swept },
            )

            return false
          },
        },
      },
    },
  })
}

export type Auth = ReturnType<typeof buildAuth>
