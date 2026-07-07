const backendPort = process.env.BACKEND_PORT ?? '8082'

module.exports = {
  output: 'standalone',
  // better-sqlite3: native addon, can't survive bundling.
  // pino: frontend-server-logger.ts hands it a worker-thread `transport`
  // (pino-pretty/pino-file) — thread-stream locates its worker.js via
  // `__dirname` at runtime, which bundling rewrites to a synthetic root,
  // crashing the server the instant that module evaluates. See
  // next-config.spec.ts for the regression guard.
  serverExternalPackages: ['better-sqlite3', 'pino'],

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `http://localhost:${backendPort}/:path*`,
      },
    ]
  },

  // Frame protection for every Next-served page (login + the full console).
  // U2's `helmet()` wraps ONLY the Nest app (:8082, reached exclusively
  // through the '/api' rewrite) — it never sees a request for a page route,
  // so without this, everything Next serves on :8080 (login, live, sessions,
  // config, git-identity, events) is embeddable in a third-party iframe with
  // zero clickjacking defense. `X-Frame-Options: DENY` is the legacy/
  // broadly-supported header; `frame-ancestors 'none'` (via CSP) is the
  // modern equivalent recommended alongside it (per Next's own docs: "CSP's
  // frame-ancestors is a more modern alternative", kept as a supplement here
  // rather than a replacement for maximum browser coverage). Neither header
  // restricts what THIS page can navigate TO or embed ITSELF — only whether
  // ANOTHER page can embed this one — so the Discord OAuth top-level
  // redirect (this app -> Discord -> back) is unaffected.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'",
          },
        ],
      },
      // SSE push (R13/U8): NestJS's @Sse() already sets this header on the
      // /api/stream response itself (verified against the installed
      // @nestjs/core sse-stream.js), and nginx's own /api/stream location
      // (deploy/nginx.conf) explicitly disables proxy_buffering — this
      // entry is the third, Next-layer leg of that same defense-in-depth
      // chain (browser -> Traefik -> nginx -> this rewrite -> NestJS), for
      // the chained-proxy header-stripping trap the plan calls out. Scoped
      // to the whole /api/:path* prefix (matching the rewrite's own scope
      // below) rather than just /api/stream — harmless on the other JSON
      // routes (the header is simply ignored by non-streaming responses)
      // and keeps this list independent of the SSE path staying at exactly
      // "/stream" if it ever moves.
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'X-Accel-Buffering',
            value: 'no',
          },
        ],
      },
    ]
  },
}
