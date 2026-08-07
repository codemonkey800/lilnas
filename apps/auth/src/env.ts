export const EnvKeys = {
  BACKEND_PORT: 'BACKEND_PORT',
  DATABASE_PATH: 'DATABASE_PATH',
  NODE_ENV: 'NODE_ENV',
  // U3: Google OAuth + Better Auth session config.
  //
  // AUTH_HOST is a full ORIGIN — scheme + host, NO path, NO trailing slash
  // (e.g. `http://auth.localhost` in dev, `https://auth.lilnas.io` in
  // prod — renamed from `login.lilnas.io` once U11's cutover retired
  // thomseddon/traefik-forward-auth). This exact shape is deliberately
  // reused verbatim by later units: U4's redirect validation needs it for
  // its own-host loop guard, and U5's /verify needs it to build absolute
  // `https://<AUTH_HOST>/...` Location headers (Traefik's
  // `preserveLocationHeader` finding from U1). Keep this shape — origin
  // only — so those units don't each re-derive it differently.
  AUTH_HOST: 'AUTH_HOST',
  GOOGLE_CLIENT_ID: 'GOOGLE_CLIENT_ID',
  GOOGLE_CLIENT_SECRET: 'GOOGLE_CLIENT_SECRET',
  BETTER_AUTH_SECRET: 'BETTER_AUTH_SECRET',
  // Cookie `Domain` attribute for advanced.crossSubDomainCookies — NOT
  // hardcoded to `.lilnas.io` in code, since dev sign-in testing runs on
  // `*.localhost` (`.localhost` in dev, `.lilnas.io` in prod).
  COOKIE_DOMAIN: 'COOKIE_DOMAIN',
  // U4: the domain family src/auth/redirect.ts's resolveRedirectTarget()
  // will allow a post-sign-in `redirect` candidate to target — a candidate
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
  // U6: SSE keepalive interval for the pending page's live channel, same
  // convention as apps/tdr-code/src/sse/sse.controller.ts's identical var.
  SSE_KEEPALIVE_MS: 'SSE_KEEPALIVE_MS',
  // U7 (R17): comma-separated admin allowlist, with TWO independent
  // consumers. AdminGuard checks a signed-in session's email against this
  // list ALONE — it never reads the grants table, which is the whole point
  // of R17 (an admin's own access to the admin UI cannot be revoked by
  // anything in that table, including a corrupted or fully-empty one). It
  // reads this value fresh via env(EnvKeys.ADMIN_EMAILS) on every request
  // and THROWS if unset — acceptable there since an unset value only ever
  // breaks the narrow /admin surface. VerifyService (U-admin-bypass) reads
  // it ONCE at construction, defaulted to '' (never throws — /verify is the
  // hot path for every protected host, so a throwing constructor there
  // would take the whole box down), and grants an ADMIN_EMAILS address
  // unconditional access to EVERY host on /verify, with no per-host grant
  // required — including while that account is blocked. Matching is
  // case/whitespace-insensitive in both consumers (see admin.guard.ts's
  // isAdminEmail() and verify.service.ts's isAdminBypassEmail(), two
  // separate functions sharing the same normalizeEmail() leaf — kept
  // separate to avoid a circular import between the two files, not
  // duplicated by accident) since email casing isn't a security boundary
  // and a stray space in this env var shouldn't silently lock an admin out.
  ADMIN_EMAILS: 'ADMIN_EMAILS',
} as const
