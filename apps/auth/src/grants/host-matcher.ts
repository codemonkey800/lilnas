import { env } from '@lilnas/utils/env'
import { z } from 'zod'

import { EnvKeys } from 'src/env'

// ──────────────────────────────────────────────────────────────────────────────
// Host matchers — what a grant's (and a pre-authorization's) `service_host`
// column actually holds. Either:
//
//   - a LITERAL host (`swole.lilnas.io`) — matches exactly that host, the
//     only shape that column held before access rules existed; or
//   - a PATTERN (`*.dev.lilnas.io`) — a single leading `*.` wildcard over a
//     suffix, matching every host strictly BELOW that suffix at any depth
//     (`foo.dev.lilnas.io`, `a.b.dev.lilnas.io`) but never the suffix itself
//     (`dev.lilnas.io`).
//
// Patterns share the literal hosts' tables, unique index and lifecycle on
// purpose — the only things that differ are how a matcher is compared
// against a host (matchesHost() below) and how it's validated on the way in
// (HostMatcherSchema). Nothing else in the grant/pre-authorization plumbing
// needs to know which kind it's holding.
//
// The pure helpers here never read env, so the admin UI can import them for
// client-side shape checks; only HostMatcherSchema reads
// REDIRECT_ALLOWED_SUFFIX, and only lazily, at parse time on the server.
// ──────────────────────────────────────────────────────────────────────────────

const PATTERN_PREFIX = '*.'

// One DNS label: alphanumerics and inner hyphens. The suffix of a pattern is
// one or more of these joined by dots — which is also what rejects any
// second `*` (`*.*.lilnas.io`, `foo-*.lilnas.io` never gets this far, see
// isValidHostPattern()).
const SUFFIX_RE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/

// Same trim + lowercase rule normalizeHost() applies to literal hosts (minus
// its port strip — a matcher is never a raw Host header), so a pattern typed
// as ` *.Dev.lilnas.io ` lands in the same keyspace as `*.dev.lilnas.io`.
export function normalizeHostMatcher(value: string): string {
  return value.trim().toLowerCase()
}

export function isHostPattern(value: string): boolean {
  return value.startsWith(PATTERN_PREFIX)
}

// `*.dev.lilnas.io` → `dev.lilnas.io`.
export function patternSuffix(pattern: string): string {
  return pattern.slice(PATTERN_PREFIX.length)
}

// Exact for literals; for a pattern, `host` must end with "." + suffix —
// WITH the leading dot, the same rule (and for the same lookalike-domain
// reason) as redirect.ts's isAllowedHostname(). Unlike that function, the
// bare suffix itself does NOT match: `*.dev.lilnas.io` means "anything under
// dev.lilnas.io", not dev.lilnas.io itself.
export function matchesHost(matcher: string, host: string): boolean {
  if (!isHostPattern(matcher)) {
    return matcher === host
  }
  return host.endsWith(`.${patternSuffix(matcher)}`)
}

// Shape check for an already-normalized pattern. With `allowedSuffix`, the
// pattern's suffix must also be that domain family (equal to it, or a
// subdomain of it) — the same check redirect.ts runs against
// REDIRECT_ALLOWED_SUFFIX, so `*.lilnas.io` (everything) and
// `*.dev.lilnas.io` pass while `*.example.com` does not. Without it, only the
// shape is checked — what the admin UI does client-side, leaving the suffix
// to the server.
export function isValidHostPattern(
  value: string,
  allowedSuffix?: string,
): boolean {
  if (!isHostPattern(value)) {
    return false
  }
  const suffix = patternSuffix(value)
  if (!SUFFIX_RE.test(suffix)) {
    return false
  }
  if (allowedSuffix === undefined) {
    return true
  }
  return suffix === allowedSuffix || suffix.endsWith(`.${allowedSuffix}`)
}

// A literal host or a valid pattern, normalized. A value with a `*` anywhere
// is treated as an attempted pattern and must pass isValidHostPattern() —
// so `foo-*.lilnas.io` is rejected here rather than slipping through as a
// "literal" that would then fail the registry check with a less useful
// message. Literal hosts are otherwise passed through as-is: whether they
// name a real service is AdminController's registry check, not this
// schema's.
export const HostMatcherSchema = z
  .string()
  .min(1)
  .transform(normalizeHostMatcher)
  .superRefine((value, ctx) => {
    if (value === '') {
      ctx.addIssue({ code: 'custom', message: 'serviceHost must not be blank' })
      return
    }
    if (!value.includes('*')) {
      return
    }
    const allowedSuffix = env(EnvKeys.REDIRECT_ALLOWED_SUFFIX)
    if (!isValidHostPattern(value, allowedSuffix)) {
      ctx.addIssue({
        code: 'custom',
        message: `"${value}" is not a valid access rule — use a single leading wildcard over ${allowedSuffix} or one of its subdomains, e.g. *.dev.${allowedSuffix}`,
      })
    }
  })
