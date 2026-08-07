// S4: the ONE service-host normalization rule every consumer of a
// serviceHost value must share, so the grant keyspace (AccessCacheService's
// grantsByUser Set<string> of serviceHost values) has exactly one
// representation per host. Zero-import leaf module — mirrors
// src/admin/normalize-email.ts's identical cycle-avoidance precedent, so
// any file can depend on this without risking a circular module edge.
//
// WHY THIS EXISTS: Traefik's Host(`...`) rule matches case-insensitively
// (hostnames are case-insensitive per RFC 4343), so a client presenting
// `Host: SWOLE.lilnas.io` still reaches the same backend as
// `swole.lilnas.io`. Before this, verify.controller.ts passed the raw
// X-Forwarded-Host header straight through to AccessCacheService.hasGrant()
// — a case-sensitive Set lookup — while requests.controller.ts's
// parseServiceHost() derived the host via `new URL(redirect).hostname`,
// which happens to lowercase already (a URL's hostname is normalized by
// the WHATWG URL spec) but never stripped a port. Grants are always
// written in lowercase (service-registry.service.ts's own hosts are
// parsed from hand-written, lowercase Traefik labels), so a differently-
// cased X-Forwarded-Host would silently miss an existing grant and bounce
// an already-granted user to /pending — even though the SAME request's
// `/requests/status` check (going through parseServiceHost's incidental
// lowercasing) would have reported them as already granted. Routing both
// call sites through this one explicit, tested function turns that
// agreement from an accident of two independently-arrived-at
// implementations into an enforced invariant.
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().split(':')[0] ?? ''
}
