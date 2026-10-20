module.exports = {
  output: 'standalone',

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
      // OIDC discovery at the issuer root. The issuer is the bare origin
      // (AUTH_HOST, no path) so relying parties like Penpot, which fetch
      // `<issuer>/.well-known/openid-configuration`, find it; the provider
      // plugin only answers them at that root path (its onRequest hook
      // matches the full pathname; under /api/auth they 404), so the
      // destination keeps the path unchanged and Nest's
      // OidcWellKnownController hands it to Better Auth. NON-stripping.
      {
        source: '/.well-known/openid-configuration',
        destination: 'http://localhost:8081/.well-known/openid-configuration',
      },
      {
        source: '/.well-known/oauth-authorization-server',
        destination:
          'http://localhost:8081/.well-known/oauth-authorization-server',
      },
      {
        source: '/api/sse/:path*',
        destination: 'http://localhost:8081/sse/:path*',
      },
    ]
  },
}
