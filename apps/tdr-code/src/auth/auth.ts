import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { env } from '@lilnas/utils/env'
import type { Account, GenericEndpointContext } from 'better-auth'
import { APIError, betterAuth } from 'better-auth'

import { loadMasterKey } from 'src/crypto/master-key'
import { sweepAccountlessUsers } from 'src/db/auth-sweep.repo'
import type { Db } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { EnvKeys } from 'src/env'
import { getBackendLogger } from 'src/logging/backend-logger'
import { LOG_EVENTS } from 'src/logging/log-events'

import { devLoginPlugin, isDevLoginEnabled } from './dev-login.plugin'
import { handleGithubAccountUpsert } from './github-account-hook'
import { isCurrentUserGuildMember } from './guild-gate'

// buildAuth(db) is a plain factory invoked once at app bootstrap, not an
// @Injectable() — no DI seam exists inside the databaseHooks closure below.
// getBackendLogger() (src/logging/backend-logger.ts, fetched AT LOG TIME
// inside the hook below, never at module-eval time) is ADDITIVE alongside
// the existing `context?.context.logger.*` calls in the hook below, not a
// replacement: those calls may be relied on by Better Auth's own internal
// request tracing, and `context` can be null, which would silently drop the
// event entirely if this logger weren't also recording it independently
// into the app's own redacted, shared log file. This is a DELIBERATE,
// KEPT double-log (not removed/consolidated) — see the plan's "auth.ts
// dual-logger" decision. The `context?.context.logger.*` calls themselves
// are Better Auth's own framework logger and are NEVER migrated to
// getBackendLogger() — left byte-for-byte unchanged.

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

  // GitHub-linking plan (U2): the AES-256-GCM master key the GitHub
  // account-link hook needs to encrypt a just-exchanged token. Lazily loaded
  // and memoized on first actual use (NOT called eagerly here at the top of
  // buildAuth(), unlike env()'s calls below) — auth-mount.spec.ts's
  // `describe('buildAuth() env validation (fail fast at boot)')` block calls
  // `buildAuth(testDb.db)` directly, asserting a SPECIFIC "<KEY> not
  // defined" throw message per missing Better-Auth/Discord env key, with no
  // TDR_CODE_MASTER_KEY_FILE ever set in that spec file and no request ever
  // driven through the resulting instance (hooks never fire). An eager
  // loadMasterKey() call here would make every one of those assertions fail
  // for the wrong reason (a master-key-file error, not the env-key error
  // under test) even though the master key is never actually needed by that
  // suite. Loading it lazily, only when a real GitHub account event reaches
  // the hook below, preserves that test's fail-fast-on-env-keys assertions
  // while still failing loudly (loadMasterKey()'s own fail-fast checks) the
  // first time a GitHub link genuinely needs the key in any REAL boot.
  let masterKey: Buffer | undefined
  function getMasterKey(): Buffer {
    if (!masterKey) masterKey = loadMasterKey()
    return masterKey
  }

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

    // Every OAuth-flow error (guild-gate rejection, a failed token exchange,
    // an unlinked-account conflict, ...) redirects here instead of Better
    // Auth's own generic error page. Confirmed against 1.6.23's installed
    // source that this is a GLOBAL default, not a per-call override: every
    // site that builds an error redirect (dist/api/routes/callback.mjs,
    // dist/oauth2/state.mjs, dist/oauth2/link-account.mjs, the generic-oauth
    // and oidc-provider plugins) resolves the same
    // `options.onAPIError?.errorURL || \`${baseURL}/error\`` fallback chain —
    // so leaving this unset silently sends every OAuth failure to
    // `${baseURL}/error` (i.e. `/api/auth/error`, Better Auth's bare HTML
    // page) instead of the styled `/login?error=<code>` banner U6 built
    // (src/app/login/page.tsx's ERROR_COPY). redirectOnError
    // (dist/oauth2/errors.mjs) appends `?error=<code>` (or `&error=<code>`
    // if errorURL already has a query string) unconditionally, so this only
    // needs to be the bare page path — never build the query string here.
    onAPIError: { errorURL: `${betterAuthUrl}/login` },

    // Keep the default `database` state strategy (do NOT set
    // storeStateStrategy: 'cookie') — with a `database` adapter configured,
    // better-auth's own default is already 'database' (OAuth state lives in
    // the `verification` table keyed by the URL query param), which sidesteps
    // the state_mismatch-via-rewrite hazard a cookie round-trip would
    // reintroduce under the /api-stripping rewrite. Left unset intentionally.

    // GitHub-linking plan (U3, R13): disables Better Auth's own stock
    // `POST /unlink-account` and `GET /list-accounts` endpoints. Both bypass
    // this app's revoke-then-delete flow entirely — Better Auth's built-in
    // unlinkAccount handler only calls internalAdapter.deleteAccount, never
    // touching github_credential and never calling GitHub's revoke endpoint,
    // so a caller reaching that stock route would delete the `account` row
    // while leaving a live, un-revoked, still-decryptable token orphaned in
    // github_credential (U1's inner join makes it invisible as "linked," but
    // the token itself remains valid at GitHub indefinitely). Only
    // DELETE /git/github and DELETE /git/github/:userId
    // (github-link.controller.ts) are reachable unlink paths after this.
    //
    // EXACT STRING FORMAT — empirically confirmed, not assumed from static
    // reading (see github-link.service.spec.ts's
    // "Better Auth stock unlink-account/list-accounts routes are disabled"
    // describe block, which drives a REAL request through a REAL
    // buildAuth(db) instance's handler and asserts a 404 for the disabled
    // routes vs. a working control route). Confirmed against installed
    // better-auth@1.6.23 source (better-auth/dist/api/index.mjs's `router`
    // function): `const basePath = new URL(ctx.baseURL).pathname` — this is
    // baseURL's OWN pathname ('/api/auth', this app's PUBLIC_AUTH_PATH_
    // SEGMENT), NOT the betterAuth({ basePath: ... }) config option above
    // (a confusingly-similarly-named but different value: this app sets
    // that to INTERNAL_AUTH_BASE_PATH, '/auth'). `normalizePathname(req.url,
    // basePath)` (@better-auth/core's utils/url.mjs) then strips that
    // baseURL-pathname prefix from the incoming request's own pathname
    // before comparing against `disabledPaths`. Empirically, a request that
    // reaches this handler at '/api/auth/unlink-account' (this app's full
    // public path) normalizes to '/unlink-account' — i.e. disabledPaths
    // entries carry NO '/api/auth' prefix and NO leading basePath segment
    // at all, just the bare endpoint path exactly as createAuthEndpoint
    // registers it ('/unlink-account', '/list-accounts').
    disabledPaths: ['/unlink-account', '/list-accounts'],

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

      // GitHub-linking plan (R5, R6): a LINKABLE provider only — GitHub is
      // never a sign-in provider in this app (no "Login with GitHub" button;
      // only the Discord guild-gated sign-in above authenticates a session).
      // Users link this from an already-authenticated session via
      // authClient.linkSocial({ provider: 'github', ... }).
      github: {
        clientId: env(EnvKeys.GITHUB_CLIENT_ID),
        clientSecret: env(EnvKeys.GITHUB_CLIENT_SECRET),
        // Better Auth's GitHub provider already defaults to
        // ['read:user', 'user:email'] and CONCATENATES (not replaces) any
        // `scope` array onto that default (confirmed against the provider
        // source, same behavior as the Discord provider above) — this only
        // needs the two scopes Plan B's per-turn `gh`/push enforcement will
        // use. Deliberately NOT `delete_repo` (R6) — this app never deletes
        // repos on a user's behalf.
        scope: ['repo', 'workflow'],
      },
    },

    // Only the Discord social provider by default — no admin/org/
    // multi-session/list-accounts plugins, so the mounted handler's public
    // route set stays limited to sign-in / callback / sign-out / get-session
    // (no public-by-construction routes from a plugin). The one conditional
    // exception is devLoginPlugin() (see dev-login.plugin.ts / PLAN.md),
    // which adds POST /dev-login ONLY when isDevLoginEnabled() returns true
    // — itself gated on NODE_ENV !== 'production', a feature flag, and a
    // configured secret, and evaluated here (at buildAuth() call time) so a
    // misconfigured prod host (TDR_CODE_DEV_LOGIN=1 with
    // NODE_ENV=production) throws at boot instead of silently mounting the
    // route. When the gate is off, the array is simply `[]` — the endpoint
    // is structurally absent (404), not merely rejected.
    plugins: isDevLoginEnabled() ? [devLoginPlugin()] : [],

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
    // This SAME hook also resolves the other TODO(U3) — token persistence —
    // for the FIRST sign-in only (`create`, not `update`; see the sibling
    // `account.updateAccountOnSignIn: false` option below for the re-login
    // write path this hook alone cannot see, added after a re-review found
    // Better Auth re-persisting the token on every RETURNING sign-in).
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

    // Closes the re-login gap the comment above calls out. Confirmed against
    // 1.6.23's installed source (@better-auth/core's oauth2/link-account.mjs,
    // handleOAuthUserInfo's "account already linked" branch — i.e. every
    // sign-in AFTER the first, which never reaches databaseHooks.account
    // .create.before above at all since it's not a create): `const
    // freshTokens = options.account?.updateAccountOnSignIn !== false ? {
    // accessToken, refreshToken, ... } : {}`, followed unconditionally by
    // `internalAdapter.updateAccount(linkedAccount.id, freshTokens)` once
    // `freshTokens` is non-empty — so by DEFAULT (option unset), Better Auth
    // re-persists the live Discord accessToken/refreshToken in plaintext on
    // every returning member's sign-in, even though the create-hook above
    // already nulled them on the first. Since R18's guild check is sign-in-
    // only (D10) and nothing downstream ever re-reads either token (same
    // rationale as the create-hook), setting this false makes `freshTokens`
    // always `{}`, so `updateAccount` is skipped entirely — no re-persist to
    // race against, rather than a second `databaseHooks.account.update
    // .before` hook nulling it after the fact.
    account: {
      updateAccountOnSignIn: false,
    },

    databaseHooks: {
      account: {
        create: {
          before: async (
            account: Account,
            context: GenericEndpointContext | null,
          ) => {
            // GitHub-linking plan (U2, R5-R8): a first-time "Link GitHub"
            // reaches this SAME create.before hook (linkSocial's callback
            // route calls internalAdapter.createAccount when no existing
            // (providerId: 'github', accountId) row matches). Checked BEFORE
            // the `!== 'discord'` early-exit below — this is now a
            // two-branch dispatcher (Discord, GitHub), not a single-provider
            // guard; see this file's interaction-graph note in the plan's
            // System-Wide Impact section. handleGithubAccountUpsert is a
            // no-op (returns undefined) for any non-GitHub event, so it's
            // safe to call unconditionally rather than gating on
            // account.providerId === 'github' twice.
            const githubResult = await handleGithubAccountUpsert(
              account,
              context,
              db,
              getMasterKey,
            )
            if (githubResult) return githubResult

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
              getBackendLogger().error(
                {
                  event: LOG_EVENTS.guildCheckError,
                  providerId: account.providerId,
                  err: error,
                },
                'Guild-membership check threw; treating as non-member (fail-closed)',
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
            getBackendLogger().warn(
              { event: LOG_EVENTS.guildDenied, providerId: account.providerId },
              'Non-member sign-in rejected before account provisioning',
            )

            // The sweep runs for EVERY non-member outcome reached above —
            // both the normal "Discord said no" path and the caught-throw
            // path — because both leave the exact same orphan-row shape
            // behind (see below) and neither should ever early-return past
            // this call.
            //
            // The paired `user` row is unavoidably orphaned by the time we
            // get here regardless of how we reject below: internal-
            // adapter.mjs's createOAuthUser runs createWithHooks(...,
            // "user", ...) and that INSERT commits BEFORE createWithHooks(
            // ..., "account", ...) — where this hook runs — is ever called.
            // That accountless `user` row is what auth-sweep.repo.ts's
            // sweepAccountlessUsers() cleans up immediately below, so
            // AE5's "no usable rows" holds: the row that survives has no
            // account and can never authenticate. Scoped to THIS rejection's
            // own account.userId (already populated here — internal-
            // adapter.mjs's createOAuthUser merges `userId: createdUser.id`
            // onto the account payload before this hook ever runs) rather
            // than a blanket sweep of every accountless user row: an
            // unscoped sweep can delete a DIFFERENT, concurrently in-flight
            // member's own not-yet-linked user row (the same "user row
            // briefly exists without an account" window this file's header
            // comment documents), FK-failing their sign-in. Scoping to this
            // exact id makes that cross-request blast radius structurally
            // impossible while still cleaning up the one row this rejection
            // actually orphaned.
            const swept = sweepAccountlessUsers(db, account.userId)
            context?.context.logger.warn(
              'guild_gate_sweep: accountless user rows deleted after guild-gate rejection',
              { rowsDeleted: swept },
            )
            getBackendLogger().warn(
              {
                event: LOG_EVENTS.guildSweep,
                rowsDeleted: swept,
                userId: account.userId,
              },
              'Accountless user rows deleted after guild-gate rejection',
            )

            // THROW an APIError here — do NOT `return false`. This was
            // fixed after `return false` was proven to crash the request
            // with a raw 500 instead of the intended redirect-to-/login
            // rejection. Full trace of why `return false` is broken,
            // verified against the installed better-auth@1.6.23 source
            // (kept in full so a future "simplification" back to `return
            // false` doesn't reintroduce this bug):
            //
            // `return false` only tells with-hooks.mjs's createWithHooks
            // (`if (result === false) return null`) to skip the `account`
            // INSERT — it does NOT abort the REQUEST. internal-adapter.mjs's
            // createOAuthUser then resolves to `{ user: <the already-
            // committed row>, account: null }` (a resolved value, not a
            // rejection) and returns normally to its caller,
            // @better-auth/core's link-account.mjs's handleOAuthUserInfo.
            // That function destructures `{ user: createdUser, account:
            // createdAccount }`, sets `user = createdUser` unconditionally,
            // and NEVER checks `createdAccount` for null before falling
            // through past its `if (!user) return {error: "unable to create
            // user", ...}` guard (which passes, since `user` is the real
            // row) straight to `const session = await
            // c.context.internalAdapter.createSession(user.id)`. But the
            // sweep two lines above already deleted THAT EXACT `user.id`
            // row (at the moment it ran, the row had no `account` yet —
            // that's the very row being rejected — so
            // sweepAccountlessUsers()'s own `NOT EXISTS (SELECT 1 FROM
            // account ...)` correctly matched and deleted it). schema.ts's
            // `session.userId` has `onDelete: 'cascade'` and
            // database.module.ts turns on `foreign_keys = ON`, so
            // createSession's INSERT throws a raw
            // SqliteError{code:'SQLITE_CONSTRAINT_FOREIGNKEY'} — which
            // dist/api/routes/callback.mjs's own try/catch around
            // handleOAuthUserInfo does NOT handle (it only special-cases
            // `isAPIError(e)` before re-throwing), so it surfaces as an
            // uncaught 500 instead of AE5's intended redirect.
            //
            // Throwing an APIError instead works because
            // handleOAuthUserInfo wraps its ENTIRE createOAuthUser(...)
            // call (not just the account-hook piece) in its own try/catch
            // that DOES check `isAPIError(e)`:
            //   } catch (e) {
            //     if (isAPIError(e)) return { error: e.message, data: null,
            //       isRegister: false }
            //     return { error: "unable to create user", ... }
            //   }
            // That catch sits ABOVE (wraps) the later `createSession` call
            // in the same function — so when createOAuthUser throws instead
            // of resolving with `account: null`, execution never reaches
            // the `if (!user)` guard or `createSession` at all; it returns
            // `{ error: e.message, data: null, isRegister: false }`
            // straight away. callback.mjs then does:
            //   if (result.error) {
            //     redirectOnError(c, resolvedErrorURL,
            //       result.error.split(" ").join("_"))
            //   }
            // — a clean redirect, not a crash. `result.error` is exactly
            // `e.message` off our thrown APIError, and `better-call`'s base
            // APIError constructor sets `this.message` straight from
            // `body.message` (confirmed in better-call/dist/error.mjs:
            // `super(body?.message, ...)`), so the three-word, space-
            // separated message below becomes, after
            // `.split(" ").join("_")`, byte-identical to the login page's
            // `not_guild_member` LoginErrorCode
            // (src/app/login/page.tsx) — this is not a coincidence to
            // re-derive; the exact string 'not guild member' below is
            // load-bearing.
            throw new APIError('FORBIDDEN', { message: 'not guild member' })
          },
        },

        // GitHub-linking plan (U2, R5-R8): re-linking an ALREADY-linked
        // GitHub account does not reach create.before above at all.
        // Confirmed by reading better-auth's installed source directly:
        // linkSocial's callback route (`callback.mjs`'s `link` branch) calls
        // `internalAdapter.findAccountByProviderId` first, and only calls
        // `createAccount` (-> create.before) when NO existing
        // (providerId: 'github', accountId) row matches; when one already
        // does (a re-link — after a revoke-and-relink, a double-click, or a
        // retried request), it calls `internalAdapter.updateAccount` instead
        // (-> update.before), which is NOT gated by
        // account.updateAccountOnSignIn above (that flag only guards the
        // sign-in handleOAuthUserInfo path, which linkSocial never uses).
        // Without this hook, a re-link would write a fresh plaintext token
        // straight into Better Auth's own account.accessToken column — the
        // exact outcome R7 forbids and the one regression this whole unit
        // exists to prevent. Discord NEVER reaches this hook in this app
        // (updateAccountOnSignIn: false above means Discord's own
        // updateAccount call site — the sign-in "already linked" branch —
        // never fires; Discord has no linkSocial flow either), so no
        // Discord-specific logic belongs here — see
        // github-account-hook.ts's own header comment for the full trace of
        // why this hook's payload cannot reliably carry
        // account.providerId/userId/accountId the way create.before's does,
        // and how handleGithubAccountUpsert resolves them itself instead.
        update: {
          before: async (
            account: Partial<Account> & Record<string, unknown>,
            context: GenericEndpointContext | null,
          ) => {
            return handleGithubAccountUpsert(account, context, db, getMasterKey)
          },
        },
      },
    },
  })
}

export type Auth = ReturnType<typeof buildAuth>
