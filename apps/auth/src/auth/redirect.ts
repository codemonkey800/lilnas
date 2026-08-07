// Parse-then-check redirect validation.
//
// The one property every check below exists to protect: no crafted
// `redirect` value can send a signed-in user to an origin outside this
// deployment's own domain family. The technique is "parse with new URL(),
// then compare structured fields" — never substring/prefix matching on the
// raw string, which is exactly the class of bug a userinfo prefix
// (`https://auth.lilnas.io@evil.com`) or a lookalike domain
// (`evil-lilnas.io`) is designed to exploit. See __tests__/redirect.spec.ts
// for the concrete bypass classes this defeats.
//
// Pure function, no I/O, no env reads inside this module — every value
// that varies by deployment (the auth host, the allowed domain suffix, the
// fallback destination) is passed in by the caller as `config`. This is
// deliberate, not incidental: this module is imported from
// src/app/login/page.tsx, a Next.js Server Component that reads real
// `process.env` values at REQUEST time on the server and passes them in.
// If this module read env vars itself, importing it from anywhere Next
// treats as client code would silently see an empty `process.env` in the
// browser bundle instead of a loud failure — keeping it pure sidesteps
// that trap entirely, and makes every test below a plain input/output
// assertion with no env mocking required.
export type RedirectValidationConfig = {
  // The domain family a redirect candidate's hostname is allowed to
  // target — e.g. "lilnas.io" in production, "localhost" for pure local
  // dev (see .env.example's REDIRECT_ALLOWED_SUFFIX). A hostname matches
  // when it equals this value exactly (the apex, e.g. "lilnas.io" itself)
  // OR ends with "." + this value (e.g. "swole.lilnas.io"). The leading
  // dot is load-bearing — see isAllowedHostname's own comment. This is
  // configuration, not a literal in code, so a *.dev.lilnas.io
  // externally-exposed dev instance (docs/lilnas-expose.md) is covered for
  // free: it is already a nested subdomain of "lilnas.io" and needs no
  // separate carve-out.
  allowedSuffix: string

  // This app's own origin — scheme + host, no path, no trailing slash
  // (the exact shape EnvKeys.AUTH_HOST documents in src/env.ts). Used for
  // two checks: (1) the loop guard — a candidate whose hostname equals
  // this origin's hostname is rejected, since redirecting a just-signed-in
  // user back to the login host makes no sense as a destination and risks
  // a sign-in loop; and (2) the scheme every candidate must use is DERIVED
  // from this origin's own protocol rather than hardcoded — see the
  // resolveRedirectTarget's own comment for why.
  authHost: string

  // Returned whenever the candidate is absent, malformed, or fails any
  // check below. Configuration rather than a literal inside this module
  // because different callers want different fallbacks — e.g. a
  // same-origin relative "/" from the login page, versus a fully-qualified
  // "https://<AUTH_HOST>/..." Location target from a future server-side
  // redirect builder.
  defaultDestination: string
}

// The suffix check the whole validator exists to get right. `hostname ===
// suffix` covers the apex case ("lilnas.io" itself, no subdomain).
// `hostname.endsWith('.' + suffix)` — WITH the leading dot — covers every
// subdomain. The leading dot is what makes "evil-lilnas.io" fail even
// though the raw string ends with the substring "lilnas.io": as a suffix
// check, "." + "lilnas.io" is ".lilnas.io", and "evil-lilnas.io" does not
// end with that (it ends with "-lilnas.io"). Drop the dot and this becomes
// exactly the well-known `.endsWith(suffix)` bug this file's tests exist to
// catch.
function isAllowedHostname(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`)
}

// Resolves an untrusted `redirect` candidate (typically a raw query-string
// value) to a destination this app is willing to send a signed-in user to.
//
// Never throws on a bad CANDIDATE — every failure mode (not a non-empty
// string, unparseable, wrong scheme, the auth host itself, or outside the
// allowed domain family) falls back to `config.defaultDestination` rather
// than propagating an error, so a crafted or malformed value can only ever
// degrade to "send them somewhere safe," never crash the login flow. A bad
// CONFIG (a malformed `authHost`) is a different matter and is allowed to
// throw — see the inline comment below.
//
// `candidate` is typed `unknown`, not `string | undefined`: Next.js's
// searchParams hands back a `string[]` for a repeated query key, and this
// function is written to be safe to call with whatever a caller happens to
// have on hand without a separate type-narrowing step first.
export function resolveRedirectTarget(
  candidate: unknown,
  config: RedirectValidationConfig,
): string {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return config.defaultDestination
  }

  // Step 1: parse, don't string-match. A protocol-relative candidate
  // ("//evil.com") has no scheme and throws here with no base URL to
  // resolve against — confirmed directly in __tests__/redirect.spec.ts
  // rather than assumed.
  let target: URL
  try {
    target = new URL(candidate)
  } catch {
    return config.defaultDestination
  }

  // authHost is trusted deployment configuration (EnvKeys.AUTH_HOST), not
  // user input — if it is malformed, this throws immediately rather than
  // silently falling back, the same fail-fast posture env() itself takes
  // for a missing key (see @lilnas/utils/env). A bad AUTH_HOST is a
  // deploy-time bug that should be loud, not a reason to quietly reject
  // every redirect candidate this process ever sees.
  const authOrigin = new URL(config.authHost)

  // Step 2: scheme must match THIS DEPLOYMENT'S OWN configured scheme,
  // derived from authOrigin's protocol rather than a hardcoded "https:" —
  // dev domains here are plain http://*.localhost (root CLAUDE.md's Domain
  // Configuration section) with no TLS entrypoint at all, so a hardcoded
  // "https:" would reject every legitimate dev redirect, not just
  // malicious ones.
  //
  // Mirrors the exact pattern src/auth/auth.ts already established for the
  // analogous prod-vs-dev scheme question (the Secure cookie attribute):
  // derive the required scheme from AUTH_HOST's own configured protocol,
  // decided once per deployment, rather than a fixed literal or a second
  // env var. AUTH_HOST is `https://auth.lilnas.io` in production and
  // `http://auth.localhost` in dev (see .env.example), so this one value
  // already encodes "this deployment's own scheme," and requiring every
  // candidate to match it gives exactly: https-only in production,
  // http-allowed in dev, with no new configuration surface to keep in sync
  // with AUTH_HOST. A genuinely downgraded candidate (http under an
  // https-configured deployment) is still rejected — see
  // __tests__/redirect.spec.ts's "scheme downgrade" case, run against a
  // fixture where authHost itself is https, which is the configuration
  // this rejection is meant to hold under. This same comparison also
  // catches every non-http(s) scheme (javascript:, data:, mailto:, ...) in
  // one check, since none of them will ever equal "http:" or "https:".
  if (target.protocol !== authOrigin.protocol) {
    return config.defaultDestination
  }

  // Step 3: loop guard. Never send a just-signed-in user back to the auth
  // host itself. Checked before the domain-family check because the auth
  // host is itself within the allowed suffix and would otherwise pass it.
  if (target.hostname === authOrigin.hostname) {
    return config.defaultDestination
  }

  // Step 4: the actual domain-family check.
  if (!isAllowedHostname(target.hostname, config.allowedSuffix)) {
    return config.defaultDestination
  }

  // Returned VERBATIM (the original string), not target.href — the
  // contract is "the exact URL the caller asked for, proven safe," not a
  // reserialized/normalized equivalent that might differ in ways a caller
  // doesn't expect (e.g. trailing-slash or percent-encoding
  // normalization).
  return candidate
}
