import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { env } from '@lilnas/utils/env'
import { betterAuth } from 'better-auth'

import type { Db } from 'src/db/database.module'
import * as schema from 'src/db/schema'
import { EnvKeys } from 'src/env'

// The one path segment the browser, Next's rewrite, NestJS's mount gate,
// and Better Auth's own internal router all have to agree on.
//
// UNLIKE apps/tdr-code/src/auth/auth.ts (required reading for this file),
// there is only ONE constant here, not two. tdr-code splits an
// INTERNAL_AUTH_BASE_PATH ('/auth', what NestJS sees post-strip) from a
// PUBLIC_AUTH_PATH_SEGMENT ('/api/auth', what the browser/Discord Developer
// Portal see) because its app-wide Next rewrite ('/api/:path*' -> ':path*')
// strips the '/api' prefix before NestJS ever sees the request — so NestJS
// and the browser genuinely see two different paths, and a req.url-
// rewriting `middleware` hook (auth.module.ts's `rewriteAuthRequestUrl`) is
// what reconciles them.
//
// This app's next.config.js rewrite for '/api/auth/:path*' PRESERVES the
// prefix instead of stripping it (see that file's own comment) — so NestJS
// receives the exact same '/api/auth/...' path the browser sent. There is
// one path, not two, and therefore one constant, not two, and no rewriting
// middleware hook (see auth.module.ts). This is verified, not assumed —
// see __tests__/auth-mount.spec.ts's basePath/baseURL invariant test,
// confirmed against a live curl check through the real Next dev server +
// rewrite.
export const AUTH_PATH_SEGMENT = '/api/auth'

// Builds the betterAuth() instance on the app's shared DB client (no second
// better-sqlite3 handle, matching apps/tdr-code/src/auth/auth.ts's
// identical Two-writer-WAL rationale).
//
// This config is deliberately LEAN — "sign in with Google, get a
// cross-subdomain cookie" only. None of tdr-code's guild-gate,
// GitHub-linking, dev-login, or disabledPaths machinery applies here: this
// app has no guild/membership concept, no second linkable provider, and no
// dev-only bypass. Don't port that complexity into an app that doesn't have
// the problem it solves.
export function buildAuth(db: Db) {
  const authHost = env(EnvKeys.AUTH_HOST)
  // Parsed once and reused below for trustedOrigins' scheme prefix —
  // AUTH_HOST is trusted deployment config, not user input, so a malformed
  // value throwing here at buildAuth() time is the same fail-fast posture
  // env() itself takes, not a reason to defer parsing.
  const authOrigin = new URL(authHost)

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
      // better-sqlite3 is synchronous; Better Auth's transaction callback
      // is async. The adapter's own default is already `false` (confirmed
      // against the installed @better-auth/drizzle-adapter@1.6.23's
      // compiled dist/index.mjs: `config.transaction ?? false`) — set
      // explicitly rather than relied-upon, matching
      // apps/tdr-code/src/auth/auth.ts's identical rationale and citation
      // style.
      transaction: false,
    }),

    // Both the instance's own `basePath` (read directly by @thallesp's own
    // mount gate — its `matchesBasePath`, confirmed against the installed
    // @thallesp/nestjs-better-auth@2.6.1's dist/index.mjs) AND baseURL's
    // own URL pathname (read by Better Auth's OWN internal router to derive
    // its match/strip prefix and its generated OAuth redirect_uri —
    // confirmed against installed better-auth@1.6.23's
    // dist/api/routes/sign-in.mjs) must agree, and must equal the path
    // NestJS actually receives requests at. See AUTH_PATH_SEGMENT's own
    // comment above for why one literal correctly satisfies both here.
    basePath: AUTH_PATH_SEGMENT,
    baseURL: `${authHost}${AUTH_PATH_SEGMENT}`,
    secret: env(EnvKeys.BETTER_AUTH_SECRET),

    // This app's login page does NOT only ever pass a same-origin relative
    // `callbackURL` — src/auth/redirect.ts's resolveRedirectTarget() can
    // return a validated CROSS-SUBDOMAIN absolute URL (e.g.
    // `https://swole.lilnas.io/...`), which is the whole point of
    // returning a user to the originally requested URL post-sign-in.
    // Better Auth's own origin-check middleware (confirmed against
    // installed better-auth@1.6.23's dist/api/middlewares/origin-check.mjs)
    // validates `callbackURL` against `trustedOrigins` independently of
    // whatever this app's own redirect.ts already decided — without an
    // entry here, a real cross-subdomain callbackURL that redirect.ts
    // correctly approved would still be REJECTED by Better Auth itself
    // with `INVALID_CALLBACK_URL`, silently breaking that for its actual
    // primary case (a user always starts on a DIFFERENT subdomain than the
    // auth host — that is what forward-auth means).
    //
    // Both entries are FULL ORIGINS (scheme + host, no wildcard on the
    // apex; `*.` prefix on the host segment for subdomains), not bare
    // hostnames — confirmed empirically (not just read from source) that a
    // bare-hostname pattern never matches here: installed
    // better-auth@1.6.23's dist/auth/trusted-origins.mjs's
    // matchesOriginPattern() only enters its host-only wildcard-matching
    // branch when the pattern itself contains `*`/`?`; a plain apex pattern
    // with neither (e.g. just `"lilnas.io"`) falls through to
    // `pattern === getOrigin(url)`, comparing a bare hostname string
    // against a full `scheme://host` origin, which can never be equal. A
    // first attempt at this fix used bare hostnames for both entries and
    // its own test below ("allows the bare apex") caught the resulting
    // 403 — left as a cautionary note since the bug is easy to
    // reintroduce by pattern-matching redirect.ts's `isAllowedHostname`
    // too literally instead of this library's actual (differently-shaped)
    // matching rules.
    //
    // The scheme prefix is authOrigin.protocol (not hardcoded), mirroring
    // redirect.ts's own scheme-parity derivation, so a dev instance's
    // trustedOrigins are http:// and a prod instance's are https://,
    // consistent with which scheme resolveRedirectTarget would have
    // approved in the first place.
    //
    // Sourced from the SAME `REDIRECT_ALLOWED_SUFFIX` env var redirect.ts's
    // caller (src/app/login/page.tsx) already reads, not a second copy of
    // the domain-family config.
    //
    // baseURL's own origin is separately, unconditionally trusted regardless
    // of this array (dist/context/helpers.mjs: `if (baseURL)
    // trustedOrigins.push(new URL(baseURL).origin)`), so AUTH_HOST itself
    // does not need its own entry here.
    trustedOrigins: [
      `${authOrigin.protocol}//${env(EnvKeys.REDIRECT_ALLOWED_SUFFIX)}`,
      `${authOrigin.protocol}//*.${env(EnvKeys.REDIRECT_ALLOWED_SUFFIX)}`,
    ],

    // @thallesp's AuthModule.configure() also reads trustedOrigins to drive
    // its own automatic app-wide CORS setup — harmless here (this app is a
    // same-origin Next+Nest pair; no cross-origin fetch ever needs to reach
    // this API), so not a reason to avoid setting the option above. Don't
    // cargo-cult tdr-code's ALLOWED_ORIGIN pattern;
    // it solves a problem this app doesn't have.
    //
    // AMENDED: the paragraph above was true when written; it no longer is.
    // nexus-code (infra/nexus-code.yml, infra/nexus-code-mbp.yml) is now an
    // external browser consumer that reads the signed-in user's name and
    // avatar cross-origin. That need is served by
    // src/app/api/profile/route.ts, which owns its own narrowly-scoped CORS
    // at the Next layer — NOT by widening trustedOrigins here, since this
    // array is Better Auth's CSRF trust boundary and widening it would also
    // hand app-wide Nest CORS (see below) to the same origins.
    //
    // That app-wide Nest CORS is still real, and its effective allowlist is
    // narrower than trustedOrigins itself suggests: @thallesp's
    // AuthModule.configure() calls this Express app's own `enableCors({
    // origin: trustedOrigins, credentials: true })` unscoped (not limited to
    // /api/auth), but installed cors@2.8.5 matches array entries with plain
    // `origin === allowedOrigin` string equality and never enters its
    // wildcard-matching branch on the Express path (that branch is
    // Fastify-only). So the literal `https://*.${REDIRECT_ALLOWED_SUFFIX}`
    // entry above matches nothing at this layer — only the bare
    // `https://${REDIRECT_ALLOWED_SUFFIX}` entry (e.g. exactly
    // "https://lilnas.io") ever does, even though Better Auth's OWN
    // origin-check middleware (the actual reason both entries exist) DOES
    // honor that wildcard. Do not "fix" cross-origin CORS by adding a
    // wildcard here expecting it to widen this Nest-level allowlist — it
    // won't; that is exactly the gap src/app/api/profile/route.ts's own
    // allowlist was built to fill instead.

    advanced: {
      // The whole point of this app's auth setup: a session cookie valid
      // across every *.lilnas.io host (dev: *.localhost). domain is
      // configurable (COOKIE_DOMAIN), never hardcoded '.lilnas.io' in code,
      // because dev sign-in testing runs on *.localhost.
      crossSubDomainCookies: {
        enabled: true,
        domain: env(EnvKeys.COOKIE_DOMAIN),
      },
      // disableOriginCheck: false, set EXPLICITLY rather than left unset.
      // Its own JSDoc (@better-auth/core's dist/types/init-options.d.mts)
      // documents a `@default false` and warns that `true` disables
      // callbackURL/redirectTo/errorCallbackURL/newUserCallbackURL
      // validation against trustedOrigins — exactly the open-redirect
      // surface src/auth/redirect.ts exists to close, so this must never be
      // `true`.
      //
      // Found while testing the trustedOrigins fix below, not merely read
      // from a type declaration: the DOCUMENTED default is NOT the actual
      // runtime default when this option is left unset. Confirmed against
      // installed better-auth@1.6.23's dist/context/create-context.mjs:
      // `skipOriginCheck: options.advanced?.disableOriginCheck !== void 0 ?
      // options.advanced.disableOriginCheck : isTest() ? true : false` —
      // i.e. leaving this unset makes origin/CSRF checking silently
      // conditional on `isTest()` (@better-auth/core's env helper:
      // `NODE_ENV === 'test' || toBoolean(env.TEST)`), NOT unconditionally
      // `false`. Two consequences, both closed by setting this explicitly:
      // (1) a misconfigured production deploy with a stray NODE_ENV=test
      //     would silently disable ALL origin/CSRF validation — a real
      //     security regression this app should never be one env var away
      //     from;
      // (2) every test in __tests__/auth-mount.spec.ts runs under Jest's own
      //     NODE_ENV=test, so origin-check was SILENTLY SKIPPED in every
      //     test exercising a real POST through the mount until this line
      //     was added — including the "trustedOrigins covers
      //     cross-subdomain callbackURLs" tests below, which could not have
      //     actually proven anything before this fix (they would have
      //     passed identically with an empty trustedOrigins array). Setting
      //     this explicitly makes both production and the test suite
      //     exercise the SAME real code path.
      disableOriginCheck: false,
      // useSecureCookies is also left unset. Confirmed against installed
      // better-auth@1.6.23's dist/cookies/index.mjs: with it unset, the
      // Secure attribute is derived from whether the STATIC `baseURL`
      // string starts with 'https://' (`baseURLString.startsWith(
      // "https://")`) — i.e. from AUTH_HOST's own configured scheme,
      // decided once at buildAuth() time — NOT from the incoming request's
      // scheme or X-Forwarded-Proto. That is the behavior this app wants:
      // Traefik terminates TLS and forwards plain http to this container in
      // production, so a per-request-scheme rule would wrongly compute
      // `secure: false` in prod; keying off AUTH_HOST (https:// in prod,
      // http:// in dev) gives the right answer in both environments without
      // this app ever needing to trust a forwarded-proto header for it.
      // Verified directly (not assumed) — see
      // __tests__/auth-mount.spec.ts's "Secure cookie attribute" block.
    },

    onAPIError: {
      // Every OAuth-flow failure redirects to this app's own login page
      // with ?error=<code> instead of Better Auth's bare
      // `${baseURL}/error` HTML page (default, confirmed against installed
      // @better-auth/core's dist/types/init-options.d.mts: `@default -
      // "/api/auth/error"`). src/app/login/page.tsx renders a message keyed
      // off that query param. Same mechanism as
      // apps/tdr-code/src/auth/auth.ts's identical option; confirmed there
      // (and unchanged in this installed version) that redirectOnError
      // appends `?error=<code>` unconditionally
      // (dist/oauth2/errors.mjs), so this only needs to be the bare page
      // path.
      errorURL: `${authHost}/login`,
    },

    user: {
      additionalFields: {
        // Round-trips schema.ts's user.blockedAt through the adapter so it
        // survives reads/writes via the Better Auth API surface, not just
        // raw Drizzle queries. Shape confirmed against installed
        // @better-auth/core's dist/db/type.d.mts DBFieldAttribute: { type,
        // required, input, ... }.
        blockedAt: {
          type: 'date',
          // Not required — most users are never blocked.
          required: false,
          // Not settable via user input (sign-up body, profile update,
          // etc.) — this field is admin-only, written by the admin
          // block/unblock endpoint (users.service.ts) directly through the
          // repo layer, never by Better Auth's own user-facing routes.
          input: false,
        },
      },
    },

    // Generous and ABSOLUTE. /verify is zero-I/O by design — "no rolling
    // session refresh from /verify" — it will never call anything that
    // rolls this forward via `updateAge`, so there is no UI-path traffic
    // compensating for a short TTL the way there is in a design where
    // every authenticated request refreshes the session.
    //
    // 30 days here, NOT apps/tdr-code's 12h — that number comes from a
    // materially different threat model: tdr-code's session gates a
    // Discord guild-membership check performed ONLY at sign-in, so a
    // kicked/compromised member keeps access to an RCE-equivalent surface
    // (an agent console) until the session expires; a short absolute TTL is
    // the compensating control for that specific risk. This app's session
    // gates access to a per-service grants table (block/unblock is
    // enforced independently at /verify, on every request, not via session
    // expiry) for a homelab-scale set of trusted household/friend accounts
    // — there is no equivalent "session outlives a revoked authorization"
    // gap to compensate for, since revocation already works out-of-band.
    // 30 days trades "a stolen session cookie is valid for longer" against
    // "every family member re-authenticates with Google multiple times a
    // day" — the right tradeoff for this app's actual risk profile, not a
    // number copied from a different one. Judgment call.
    //
    // No `updateAge` override: the library default (1 day rolling refresh)
    // only matters for UI-path session reads (Better Auth's own
    // get-session handler can still roll it forward there); /verify itself
    // never calls anything that would trigger it, per the zero-I/O design
    // above. No stated requirement either way beyond that, so this is left
    // at the library default rather than invented.
    session: {
      expiresIn: 60 * 60 * 24 * 30,
    },

    socialProviders: {
      google: {
        clientId: env(EnvKeys.GOOGLE_CLIENT_ID),
        clientSecret: env(EnvKeys.GOOGLE_CLIENT_SECRET),
        // No extra scopes, no mapProfileToUser. Google's provider already
        // defaults to ['email', 'profile', 'openid'] (confirmed against
        // installed @better-auth/core's src/social-providers/google.ts),
        // which is sufficient — this app has no guild-gate or
        // Discord-style membership check needing a wider scope. Google
        // always returns a real, verified email (unlike Discord, which
        // apps/tdr-code/src/auth/auth.ts has to work around with a
        // synthesized placeholder), so no mapProfileToUser override is
        // needed either.
      },
    },

    // No plugins, no databaseHooks, no disabledPaths — none of tdr-code's
    // guild-gate / GitHub-linking / dev-login machinery applies to this
    // app. Keep this config exactly as lean as "sign in with Google, get a
    // cross-subdomain cookie" requires.
  })
}

export type Auth = ReturnType<typeof buildAuth>
