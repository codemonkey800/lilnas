module.exports = {
  output: 'standalone',

  // Scope next build's own built-in ESLint pass to the actual Next-owned
  // code. Without this, `next build` lints the WHOLE src/ tree (including
  // the Nest backend, db/, health/, and every __tests__ dir) redundantly —
  // the dedicated `pnpm lint` script (eslint src, run separately in CI and
  // by hand) already covers all of that. Discovered because the default,
  // unscoped behavior made `next build` fail on a pre-existing formatting
  // issue in apps/auth/src/verify/__tests__/forwardauth-contract.spec.ts
  // (a U1 file this unit was told not to modify) — scoping to src/app is the
  // correct fix on its own merits (Next has no business linting backend/test
  // code), not a workaround specific to that one file.
  eslint: {
    dirs: ['src/app'],
  },

  // better-sqlite3 is a native addon and can't survive being bundled by
  // Next's server compiler (matches apps/swole/next.config.ts and
  // apps/tdr-code/next.config.js, which hit this same requirement). Nothing
  // under src/app/ touches the DB yet in this unit, but the pending/admin
  // pages U6+ add will, so this is set up ahead of time.
  serverExternalPackages: ['better-sqlite3'],

  // U3: the ONLY rewrite this app has. Deliberately NON-stripping — the
  // '/api/auth' prefix is PRESERVED in the destination, unlike
  // apps/download's app-wide '/api/:path*' -> ':path*' shape (which strips
  // it). This is the one place this app's design deliberately differs from
  // every other app's rewrite in this repo: because nothing strips the
  // prefix, NestJS receives requests at the exact same '/api/auth/...' path
  // the browser sent, so `basePath === new URL(baseURL).pathname ===
  // '/api/auth'` holds for both the betterAuth() instance's own `basePath`
  // option AND its internally-derived router prefix (see
  // src/auth/auth.ts's AUTH_PATH_SEGMENT comment) — with no req.url-
  // rewriting middleware needed to reconcile a stripped vs. public path the
  // way apps/tdr-code/src/auth/auth.module.ts's `rewriteAuthRequestUrl`
  // hook has to. Verified empirically (not just reasoned about) — see
  // src/auth/__tests__/auth-mount.spec.ts and this unit's final report for
  // the live curl check.
  //
  // U6: a second, equally non-stripping rewrite for the pending page's SSE
  // connection — the browser opens this directly (EventSource can't be
  // driven from a Server Component), so it needs the same :8080 -> :8081
  // bridge the auth mount does. The `/requests/*` status/re-request calls
  // do NOT need a rewrite: the pending page's Server Component/Server
  // Action call them with a plain server-side `fetch('http://localhost:8081/requests/...')`,
  // entirely inside this one container, never through the browser.
  async rewrites() {
    return [
      {
        source: '/api/auth/:path*',
        destination: 'http://localhost:8081/api/auth/:path*',
      },
      {
        source: '/api/sse/:path*',
        destination: 'http://localhost:8081/sse/:path*',
      },
    ]
  },
}
