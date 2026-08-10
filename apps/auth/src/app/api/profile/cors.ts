// Pure allowlist logic for GET /api/profile's cross-origin gate — no I/O,
// no env reads, unit-testable without constructing an HTTP request. Mirrors
// how src/auth/redirect.ts's resolveRedirectTarget() and
// src/admin/admin.guard.ts's isAdminEmail() each isolate their own
// security-relevant allowlist decision into a pure function.
//
// Comma-separated parsing matches ADMIN_EMAILS/WHITELIST's shape
// (admin.guard.ts), but comparison here is EXACT and case-SENSITIVE —
// origins are scheme+host, not email addresses, so this deliberately does
// NOT reuse normalizeEmail(). There is also no wildcard support: that is
// the exact trap src/auth/auth.ts's trustedOrigins fell into, where a
// `https://*.lilnas.io` entry silently matches nothing once cors@2.8.5's
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

  const allowlist = rawAllowlist
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)

  return allowlist.includes(requestOrigin) ? requestOrigin : null
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
