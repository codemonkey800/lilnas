export const EnvKeys = {
  BACKEND_PORT: 'BACKEND_PORT',
  DATABASE_PATH: 'DATABASE_PATH',
  NODE_ENV: 'NODE_ENV',
  // A full ORIGIN — scheme + host, NO path, NO trailing slash (e.g.
  // `http://auth.localhost` in dev, `https://auth.lilnas.io` in prod —
  // renamed from `login.lilnas.io` once forward-auth was retired). Reused
  // verbatim wherever this app needs its own hostname: redirect.ts's
  // own-host loop guard, and /verify's absolute `https://<AUTH_HOST>/...`
  // Location headers (Traefik's `preserveLocationHeader` requires an
  // absolute URL, not a path). Keep this shape — origin only — so those
  // call sites don't each re-derive it differently.
  AUTH_HOST: 'AUTH_HOST',
  GOOGLE_CLIENT_ID: 'GOOGLE_CLIENT_ID',
  GOOGLE_CLIENT_SECRET: 'GOOGLE_CLIENT_SECRET',
  BETTER_AUTH_SECRET: 'BETTER_AUTH_SECRET',
  // Cookie `Domain` attribute for advanced.crossSubDomainCookies — NOT
  // hardcoded to `.lilnas.io` in code, since dev sign-in testing runs on
  // `*.localhost` (`.localhost` in dev, `.lilnas.io` in prod).
  COOKIE_DOMAIN: 'COOKIE_DOMAIN',
  // The domain family src/auth/redirect.ts's resolveRedirectTarget() will
  // allow a post-sign-in `redirect` candidate to target — a candidate
  // hostname must equal this value OR end with "." + this value. NOT
  // hardcoded to `lilnas.io` in code so a *.dev.lilnas.io
  // externally-exposed dev instance (docs/lilnas-expose.md) and a pure
  // local `*.localhost` dev instance can each configure their own family
  // without a code change.
  //   dev:  localhost
  //   prod: lilnas.io (set directly in .env.prod) — this single value
  //         already covers *.dev.lilnas.io too, since it is a nested
  //         subdomain of lilnas.io.
  REDIRECT_ALLOWED_SUFFIX: 'REDIRECT_ALLOWED_SUFFIX',
  // SSE keepalive interval for the pending page's live channel, same
  // convention as apps/tdr-code/src/sse/sse.controller.ts's identical var.
  SSE_KEEPALIVE_MS: 'SSE_KEEPALIVE_MS',
  // Comma-separated admin allowlist, with TWO independent consumers that
  // deliberately read it differently. AdminGuard checks a signed-in
  // session's email against this list ALONE — it never reads the grants
  // table, so an admin's own access to the admin UI can't be revoked by
  // anything in that table, including a corrupted or fully-empty one. It
  // reads this value fresh via env(EnvKeys.ADMIN_EMAILS) on every request
  // and THROWS if unset — acceptable there since an unset value only ever
  // breaks the narrow /admin surface. VerifyService reads it ONCE at
  // construction, defaulted to '' (never throws — /verify is the hot path
  // for every protected host, so a throwing constructor there would take
  // the whole box down), and grants an ADMIN_EMAILS address unconditional
  // access to EVERY host on /verify, with no per-host grant required —
  // including while that account is blocked. Matching is
  // case/whitespace-insensitive in both consumers (see admin.guard.ts's
  // isAdminEmail() and verify.service.ts's isAdminBypassEmail(), two
  // separate functions sharing the same normalizeEmail() leaf — kept
  // separate to avoid a circular import between the two files, not
  // duplicated by accident) since email casing isn't a security boundary
  // and a stray space in this env var shouldn't silently lock an admin out.
  ADMIN_EMAILS: 'ADMIN_EMAILS',
  // src/app/api/profile/route.ts's own CORS allowlist — comma-separated,
  // same parsing shape as ADMIN_EMAILS above, but NOT an
  // app-wide CORS knob. Deliberately prefixed PROFILE_ rather than CORS_:
  // it gates exactly one route (GET /api/profile, a slim {name, email,
  // image} projection of /me built for nexus-code to read cross-origin),
  // never the Nest API surface. Entries are exact origins (scheme + host)
  // with NO wildcard support — see src/auth/auth.ts's trustedOrigins
  // comment for the trap a `*.lilnas.io`-style entry falls into with a
  // plain string-equality matcher; this env var's own parser
  // (src/app/api/profile/cors.ts's resolveAllowedOrigin()) is exactly that
  // kind of matcher, on purpose. Read with a '' default so an unset value
  // fails closed (no cross-origin access) rather than throwing — same
  // reasoning as VerifyService's own ADMIN_EMAILS default above: this path
  // should degrade to "cross-origin callers get nothing," never take the
  // route down.
  PROFILE_ALLOWED_ORIGINS: 'PROFILE_ALLOWED_ORIGINS',
} as const
