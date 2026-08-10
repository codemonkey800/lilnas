// Pure allowlist logic for GET /api/profile's cross-origin gate — no I/O,
// no env reads, unit-testable without constructing an HTTP request. Mirrors
// how src/auth/redirect.ts's resolveRedirectTarget() and
// src/admin/admin.guard.ts's isAdminEmail() each isolate their own
// security-relevant allowlist decision into a pure function.
//
// Comma-separated parsing matches ADMIN_EMAILS/WHITELIST's shape
// (admin.guard.ts). Comparison is case-insensitive with a single trailing
// slash tolerated on allowlist entries — normalizeEmail()'s own
// `.trim().toLowerCase()` isn't reused directly (origins aren't emails, and
// this file has no reason to import from src/admin/), but the effect is the
// same trim+lowercase, plus a trailing-slash strip an email address has no
// equivalent of. This is entirely about forgiving how a HUMAN writes an
// allowlist entry in an env file (`https://Nexus-Code.lilnas.io`,
// `https://nexus-code.lilnas.io/` — both natural typos, neither matching
// anything before this normalization existed); a real browser Origin header
// is already lowercase, scheme+host-only, with no trailing slash, so actual
// traffic is unaffected either way. There is still no wildcard support:
// that is the exact trap src/auth/auth.ts's trustedOrigins fell into, where
// a `https://*.lilnas.io` entry silently matches nothing once cors@2.8.5's
// plain `origin === allowedOrigin` string comparison sees it (see that
// file's own comment). A literal wildcard entry here must therefore match
// nothing, not "everything" — tested explicitly in __tests__/cors.spec.ts.
export function resolveAllowedOrigin(
  requestOrigin: string | null,
  rawAllowlist: string,
): string | null {
  if (!requestOrigin) {
    return null
  }

  const normalizedRequestOrigin = requestOrigin.toLowerCase()

  const allowlist = rawAllowlist
    .split(',')
    .map(entry => entry.trim().toLowerCase().replace(/\/$/, ''))
    .filter(Boolean)

  // The request's OWN Origin header is returned verbatim (never the
  // normalized form, never the matched allowlist entry): the browser
  // compares Access-Control-Allow-Origin against the exact header it sent.
  return allowlist.includes(normalizedRequestOrigin) ? requestOrigin : null
}

// Bundles the three CORS response headers as one record so route.ts can
// spread it into every response uniformly (2xx, 401, 5xx alike). Returns an
// empty object for a null allowedOrigin so an unlisted or absent Origin
// never emits a bare/incorrect Access-Control-Allow-Origin — and never `*`,
// which is incompatible with `credentials: 'include'`.
export function corsHeaders(
  allowedOrigin: string | null,
): Record<string, string> {
  if (!allowedOrigin) {
    return {}
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  }
}
